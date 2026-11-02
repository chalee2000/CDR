import { useCallback, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { ECharts } from 'echarts/core';
import type { LayoutKind, LinkLayout, Point } from '../lib/analysis/linkLayout';
import { boxOf, clampDelta, pickInRect, unionBox, type Box } from '../lib/analysis/linkMove';
import type { Network } from '../lib/analysis/network';
import { linkFrame, type LinkTool } from './linkChartOption';

/**
 * Picking and moving numbers on a link chart by hand, as in an investigation
 * chart: drag a box over empty space to pick numbers, drag one of them to move
 * them all, right-drag (or middle-drag) to move the view. Moves are kept per
 * layout until the network changes.
 */

// A display preference, like the theme: which tool dragging empty space uses.
const TOOL_KEY = 'cdr-analyzer:link-tool';
const toolListeners = new Set<() => void>();
let toolPref: LinkTool | undefined;

function readTool(): LinkTool {
  if (toolPref) return toolPref;
  let t: LinkTool = 'select';
  try {
    const v = localStorage.getItem(TOOL_KEY);
    if (v === 'select' || v === 'pan') t = v;
    // A finger drags the view by default: a box is hard to draw by touch.
    else if (window.matchMedia?.('(pointer: coarse)').matches) t = 'pan';
  } catch {
    /* storage unavailable: start with the box */
  }
  toolPref = t;
  return t;
}

function writeTool(t: LinkTool) {
  toolPref = t;
  try {
    localStorage.setItem(TOOL_KEY, t);
  } catch {
    /* storage unavailable: the choice lasts until the page closes */
  }
  for (const l of toolListeners) l();
}

function subscribeTool(l: () => void) {
  toolListeners.add(l);
  return () => toolListeners.delete(l);
}

/** The chart's own copy of where each number is drawn (ECharts internals, guarded). */
interface GraphData {
  getItemLayout(i: number): number[] | undefined;
  setItemLayout(i: number, p: number[]): void;
  getItemGraphicEl(i: number): unknown;
}
interface ZrEl {
  x: number;
  y: number;
  draggable?: unknown;
  parent?: ZrEl;
  __hostTarget?: ZrEl;
  trigger(name: string, e: unknown): void;
  updateTransform?(): void;
}
interface ZrEvent {
  target?: ZrEl;
  offsetX: number;
  offsetY: number;
  event?: MouseEvent;
}

function graphData(c: ECharts): GraphData | undefined {
  try {
    return (c as unknown as { getModel(): { getSeriesByIndex(i: number): { getData(): GraphData } | undefined } }).getModel().getSeriesByIndex(0)?.getData();
  } catch {
    return undefined;
  }
}

/** A press on a number (or its label) drags it; anything else is empty space or a link. */
function onNumber(el: ZrEl | undefined): boolean {
  for (let e = el; e; e = e.__hostTarget ?? e.parent) if (e.draggable) return true;
  return false;
}

const at = (p: number[] | undefined): Point | undefined => (p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? { x: p[0], y: p[1] } : undefined);

const NO_MOVES = new Map<LayoutKind, Map<string, Point>>();
const NO_GROUP = new Set<string>();

interface Args {
  network: Network;
  layout: LinkLayout;
  layoutMode: LayoutKind;
  view?: { w: number; h: number };
  compact?: boolean;
  /** The box drawn while dragging over empty space. */
  marquee: RefObject<HTMLDivElement | null>;
}

export function useLinkTool({ network, layout, layoutMode, view, compact, marquee }: Args) {
  const tool = useSyncExternalStore(subscribeTool, readTool, () => 'select' as LinkTool);
  const fixed = layoutMode !== 'force';

  // Both belong to one network: a new one (other filters, focus) starts afresh.
  const [moves, setMoves] = useState<{ network: Network; byMode: Map<LayoutKind, Map<string, Point>> }>(() => ({ network, byMode: NO_MOVES }));
  const byMode = moves.network === network ? moves.byMode : NO_MOVES;
  const moved = fixed ? byMode.get(layoutMode) : undefined;
  const [picked, setPicked] = useState<{ network: Network; layoutMode: LayoutKind; ids: Set<string> }>(() => ({ network, layoutMode, ids: NO_GROUP }));
  const group = picked.network === network && picked.layoutMode === layoutMode ? picked.ids : NO_GROUP;

  const setGroup = useCallback((ids: Set<string>) => setPicked({ network, layoutMode, ids }), [network, layoutMode]);
  const clearGroup = useCallback(() => setPicked({ network, layoutMode, ids: NO_GROUP }), [network, layoutMode]);
  const toggleInGroup = useCallback(
    (id: string) => {
      const next = new Set(group);
      if (!next.delete(id)) next.add(id);
      setGroup(next);
    },
    [group, setGroup],
  );
  const commitMoves = useCallback(
    (updates: Map<string, Point>) =>
      setMoves((prev) => {
        const base = prev.network === network ? prev.byMode : NO_MOVES;
        const next = new Map(base);
        const mine = new Map(base.get(layoutMode));
        for (const [id, p] of updates) mine.set(id, p);
        next.set(layoutMode, mine);
        return { network, byMode: next };
      }),
    [network, layoutMode],
  );
  const resetMoves = useCallback(
    () =>
      setMoves((prev) => {
        if (prev.network !== network) return prev;
        const next = new Map(prev.byMode);
        next.delete(layoutMode);
        return { network, byMode: next };
      }),
    [network, layoutMode],
  );

  // The chart's event handlers are attached once; they read the latest state here.
  const live = useRef({ network, fixed, tool, group, frame: undefined as Box | undefined, setGroup, commitMoves });
  live.current = { network, fixed, tool, group, frame: fixed ? linkFrame(layout, view, compact, moved) : undefined, setGroup, commitMoves };

  const attach = useCallback(
    (c: ECharts) => {
      const zr = c.getZr();
      let drag: { network: Network; target: ZrEl; el: ZrEl; idx: number; members: number[]; start: Map<number, Point>; box: Box; frame: Box; moved: boolean } | undefined;
      let box: { x0: number; y0: number; x1: number; y1: number; add: boolean; active: boolean } | undefined;
      let pan: { x: number; y: number; moved: boolean } | undefined;

      const hideBox = () => {
        const el = marquee.current;
        if (!el) return;
        el.style.display = 'none';
        el.parentElement?.classList.remove('is-boxing');
      };

      // Dragging a number: the chart moves it; the rest of its group follows.
      zr.on('dragstart', (e: ZrEvent) => {
        drag = undefined;
        const s = live.current;
        const data = graphData(c);
        if (!s.fixed || !s.frame || !data || !e.target) return;
        // The press lands on a number's icon; its parent is the number drawn by the chart.
        const els = new Map<unknown, number>();
        s.network.nodes.forEach((_, i) => els.set(data.getItemGraphicEl(i), i));
        let el: ZrEl | undefined = e.target;
        while (el && !els.has(el)) el = el.parent;
        const idx = el ? els.get(el)! : -1;
        if (!el || idx < 0) return;
        const index = new Map(s.network.nodes.map((node, i) => [node.id, i]));
        const members = s.group.size > 1 && s.group.has(s.network.nodes[idx].id) ? [...s.group].map((id) => index.get(id)).filter((i): i is number => i !== undefined) : [idx];
        const start = new Map<number, Point>();
        for (const i of members) {
          const p = at(data.getItemLayout(i));
          if (p) start.set(i, p);
        }
        const groupBox = boxOf(start.values());
        if (!start.has(idx) || !groupBox) return;
        drag = { network: s.network, target: e.target, el, idx, members: [...start.keys()], start, box: groupBox, frame: unionBox(s.frame, groupBox), moved: false };
      });
      zr.on('drag', (e: ZrEvent) => {
        const d = drag;
        if (!d || e.target !== d.target) return;
        try {
          const data = graphData(c);
          const now = at(data?.getItemLayout(d.idx));
          const s0 = d.start.get(d.idx)!;
          if (!data || !now) return;
          const rawX = now.x - s0.x;
          const rawY = now.y - s0.y;
          // Numbers stay on the chart's frame, so keeping the move never refits the view.
          const [dx, dy] = clampDelta(d.box, d.frame, rawX, rawY);
          d.moved ||= dx !== 0 || dy !== 0;
          if (d.members.length === 1 && dx === rawX && dy === rawY) return;
          for (const i of d.members) {
            const p = d.start.get(i)!;
            data.setItemLayout(i, [p.x + dx, p.y + dy]);
          }
          d.el.x = s0.x + dx;
          d.el.y = s0.y + dy;
          // The chart's own drag handler redraws the numbers and their links.
          d.el.trigger('drag', e);
          // The next pointer move continues from here, not from where the pointer went.
          d.el.updateTransform?.();
        } catch {
          /* chart internals changed: the one number still moves on its own */
        }
      });
      zr.on('dragend', () => {
        const d = drag;
        drag = undefined;
        const s = live.current;
        const data = graphData(c);
        if (!d || !d.moved || !data || s.network !== d.network) return;
        const updates = new Map<string, Point>();
        for (const i of d.members) {
          const p = at(data.getItemLayout(i));
          const id = s.network.nodes[i]?.id;
          if (p && id) updates.set(id, p);
        }
        if (updates.size) s.commitMoves(updates);
      });

      // Empty space: a box to pick numbers (left button), or move the view (right or middle).
      zr.on('mousedown', (e: ZrEvent) => {
        box = undefined;
        pan = undefined;
        hideBox();
        const s = live.current;
        if (onNumber(e.target)) return;
        const button = e.event?.button ?? 0;
        if (button === 1 || button === 2) {
          pan = { x: e.offsetX, y: e.offsetY, moved: false };
          // No auto-scroll from the middle button.
          if (button === 1) e.event?.preventDefault();
          return;
        }
        if (button !== 0 || !s.fixed || s.tool !== 'select') return;
        box = { x0: e.offsetX, y0: e.offsetY, x1: e.offsetX, y1: e.offsetY, add: !!e.event?.shiftKey, active: false };
      });
      zr.on('mousemove', (e: ZrEvent) => {
        if (pan) {
          const dx = e.offsetX - pan.x;
          const dy = e.offsetY - pan.y;
          if (!pan.moved && Math.hypot(dx, dy) < 3) return;
          pan.moved = true;
          pan.x = e.offsetX;
          pan.y = e.offsetY;
          c.dispatchAction({ type: 'graphRoam', seriesIndex: 0, dx, dy });
          return;
        }
        if (!box) return;
        const w = c.getWidth();
        const h = c.getHeight();
        box.x1 = Math.max(0, Math.min(w, e.offsetX));
        box.y1 = Math.max(0, Math.min(h, e.offsetY));
        if (!box.active && Math.hypot(box.x1 - box.x0, box.y1 - box.y0) <= 4) return;
        box.active = true;
        const el = marquee.current;
        if (!el) return;
        el.style.display = 'block';
        el.parentElement?.classList.add('is-boxing');
        el.style.left = `${Math.min(box.x0, box.x1)}px`;
        el.style.top = `${Math.min(box.y0, box.y1)}px`;
        el.style.width = `${Math.abs(box.x1 - box.x0)}px`;
        el.style.height = `${Math.abs(box.y1 - box.y0)}px`;
      });
      zr.on('mouseup', () => {
        pan = undefined;
        const b = box;
        box = undefined;
        hideBox();
        if (!b?.active) return;
        const s = live.current;
        const data = graphData(c);
        if (!data) return;
        try {
          const a = c.convertFromPixel({ seriesIndex: 0 }, [b.x0, b.y0]) as number[];
          const z = c.convertFromPixel({ seriesIndex: 0 }, [b.x1, b.y1]) as number[];
          const points: [string, Point][] = [];
          s.network.nodes.forEach((n, i) => {
            const p = at(data.getItemLayout(i));
            if (p) points.push([n.id, p]);
          });
          const ids = pickInRect(points, { x: a[0], y: a[1] }, { x: z[0], y: z[1] });
          s.setGroup(new Set(b.add ? [...s.group, ...ids] : ids));
        } catch {
          /* nothing picked */
        }
      });
    },
    [marquee],
  );

  return { tool, setTool: writeTool, fixed, moved, group, setGroup, clearGroup, toggleInGroup, resetMoves, attach };
}
