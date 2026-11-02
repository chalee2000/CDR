import type { EChartsCoreOption } from 'echarts/core';
import { MIN_GAP, pairKey, type LayoutKind, type LinkLayout, type Point } from '../lib/analysis/linkLayout';
import { boxOf, chartFrame, unionBox, type Box } from '../lib/analysis/linkMove';
import { routeOrg, routeTree } from '../lib/analysis/linkRoute';
import type { NetEdge, NetNode, Network } from '../lib/analysis/network';
import { PEER_KIND_TH } from '../lib/labels';
import { CHROME, slotColor, type ThemeMode } from '../lib/palette';
import { personName, recordLines, type PersonProfile, type ProfileMap } from '../lib/profiles';
import { fmtDate } from '../lib/time';
import { fmtInt } from '../lib/util';
import { chrome } from './Chart';
import { escapeHtml } from './download';
import { iconUrl, type Glyph, type IconSpec } from './linkIcons';

/** hub = Peacock; packed, hierarchy and organization are fixed layouts too; force moves. */
export type LinkLayoutMode = LayoutKind;
export type LinkColorBy = 'role' | 'community';
export type LinkSelection = { type: 'node'; id: string } | { type: 'edge'; source: string; target: string };
/** What dragging on empty space does: draw a box to pick numbers, or move the view. */
export type LinkTool = 'select' | 'pan';

export interface LinkChartInput {
  network: Network;
  layout: LinkLayout;
  mode: ThemeMode;
  layoutMode: LinkLayoutMode;
  colorBy: LinkColorBy;
  communitySlots: Map<number, number>;
  profiles: ProfileMap;
  /** Unit of the link weight, e.g. "ครั้ง". */
  unit: string;
  allLabels: boolean;
  allEdgeLabels: boolean;
  selection?: LinkSelection;
  compact?: boolean;
  yearStyle: 'ce' | 'be';
  /** Size of the drawing area in px (icons shrink when a dense chart must fit). */
  view?: { w: number; h: number };
  /** Where the user has moved numbers to (chart coordinates), over the layout's. */
  moved?: Map<string, Point>;
  /** Numbers picked with the selection box, moved together. */
  group?: Set<string>;
  tool?: LinkTool;
}

/** Theme constants beyond the chart chrome (match the CSS tokens). */
export const LINK_THEME = {
  light: { accent: '#256abf', danger: '#b83232', nodeFill: '#ffffff', glyph: '#52514e', link: 0.55, group: '#d4a72c' },
  dark: { accent: '#3987e5', danger: '#e66767', nodeFill: '#2a2a28', glyph: '#d6d5cf', link: 0.65, group: '#d4a72c' },
} as const;

const AUTO_ALL = 40;
const TOP_LABELS_PER_TARGET = 5;
const TOP_EDGE_LABELS = 30;

export const edgeKey = pairKey;

/** Space kept around the chart for labels, in px. */
function chartPad(compact?: boolean) {
  return { x: compact ? 64 : 48, y: compact ? 26 : 44 };
}

/** The area the chart is fitted into, in px. */
export function drawBox(view: { w: number; h: number } | undefined, compact?: boolean): { w: number; h: number } | undefined {
  if (!view) return undefined;
  const pad = chartPad(compact);
  return { w: view.w - 2 * pad.x, h: view.h - 2 * pad.y - 8 };
}

/**
 * What a fixed-layout chart is fitted to: the layout widened to the drawing
 * area, and any numbers moved beyond it. Holding it still while numbers move
 * keeps the picture from jumping when a move is kept.
 */
export function linkFrame(layout: LinkLayout, view: { w: number; h: number } | undefined, compact?: boolean, moved?: Map<string, Point>): Box {
  return unionBox(chartFrame(layout.bounds, drawBox(view, compact)), moved?.size ? boxOf(moved.values()) : undefined);
}

/** Ids of the two invisible points that hold the frame. */
export const FRAME_IDS = ['__link-frame-0', '__link-frame-1'] as const;

/** Rich-text safe label text (braces and bars delimit ECharts rich styles). */
function labelText(s: string, max = 30): string {
  const t = s.replace(/[{}|]/g, '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function glyphOf(kind: NetNode['kind'], person: boolean): Glyph {
  if (person) return 'person';
  switch (kind) {
    case 'target':
    case 'mobile':
      return 'mobile';
    case 'landline':
      return 'landline';
    case 'intl':
      return 'globe';
    case 'shortcode':
    case 'alpha':
      return 'service';
    default:
      return 'other';
  }
}

/** Slots of the targets each contact is linked to, in fixed slot order. */
export function linkedSlots(net: Network): Map<string, number[]> {
  const slotOf = new Map(net.nodes.filter((n) => n.isTarget).map((n) => [n.id, n.slot ?? 99]));
  const out = new Map<string, number[]>();
  for (const e of net.edges) {
    for (const [x, y] of [
      [e.source, e.target],
      [e.target, e.source],
    ]) {
      if (slotOf.has(x) || !slotOf.has(y)) continue;
      if (!out.has(x)) out.set(x, []);
      out.get(x)!.push(slotOf.get(y)!);
    }
  }
  for (const v of out.values()) v.sort((a, b) => a - b);
  return out;
}

/** Icon for one node, shared by the chart, the legend and the details panel. */
export function nodeIcon(n: Pick<NetNode, 'isTarget' | 'slot' | 'kind' | 'community'>, opts: { mode: ThemeMode; size: number; slots?: number[]; profile?: PersonProfile; colorBy?: LinkColorBy; communitySlots?: Map<number, number> }): IconSpec {
  const { mode, size } = opts;
  const t = LINK_THEME[mode];
  const ch = CHROME[mode];
  const person = !!personName(opts.profile) || !!opts.profile?.photo;
  const glyph = glyphOf(n.kind, person);
  const badge = recordLines(opts.profile).length > 0 ? { fill: t.danger, ink: '#ffffff', edge: ch.surface } : undefined;
  const photo = opts.profile?.photo;
  if (opts.colorBy === 'community') {
    const slot = opts.communitySlots?.get(n.community);
    const c = slot !== undefined ? slotColor(slot, mode) : ch.other;
    return { glyph, size, fill: c, ink: '#ffffff', ring: [c], ringWidth: 2, halo: n.isTarget ? ch.surface : undefined, badge, photo };
  }
  if (n.isTarget) {
    const c = slotColor(n.slot ?? 99, mode);
    return { glyph, size, fill: c, ink: '#ffffff', ring: [c], ringWidth: 3, halo: ch.surface, badge, photo };
  }
  const ring = (opts.slots?.length ? opts.slots : [99]).map((s) => slotColor(s, mode));
  return { glyph, size, fill: t.nodeFill, ink: t.glyph, ring, ringWidth: ring.length > 1 ? 4 : 3, badge, photo };
}

export function buildLinkOption(input: LinkChartInput): EChartsCoreOption {
  const { network: net, layout, mode, profiles, unit, selection, compact } = input;
  const ch = chrome(mode);
  const t = LINK_THEME[mode];
  const slots = linkedSlots(net);
  const targetIds = new Set(net.nodes.filter((n) => n.isTarget).map((n) => n.id));
  const byId = new Map(net.nodes.map((n) => [n.id, n]));
  const maxW = Math.max(1, ...net.nodes.filter((n) => !n.isTarget).map((n) => n.weightedDegree));
  const maxE = Math.max(1, ...net.edges.map((e) => e.weight));
  const autoAll = net.nodes.length <= AUTO_ALL;
  const y = input.yearStyle;
  const { x: padX, y: padY } = chartPad(compact);
  const fixed = input.layoutMode !== 'force';

  // ECharts fits the layout into the box but draws icons at fixed pixel
  // sizes; scale them with the fit so dense charts do not pile up. Layout
  // spacing (MIN_GAP 62) leaves room for icons up to ~1.3x the fitted gap.
  const b = layout.bounds;
  const fit = input.view ? Math.min((input.view.w - 2 * padX) / Math.max(1, b.maxX - b.minX), (input.view.h - 2 * padY - 8) / Math.max(1, b.maxY - b.minY)) : 1;
  const nodeScale = Math.max(0.42, Math.min(1, fit * 1.3));
  const dense = nodeScale < 0.75;
  // No contact icon may outgrow the room the layout gives it on screen, not
  // even a named person's, or neighbours pile on top of each other.
  const room = Math.max(14, MIN_GAP * fit * 1.25);

  // Labels shown without hovering: targets, shared, named, strongest per target.
  const topContacts = new Set<string>();
  for (const id of targetIds) {
    net.edges
      .filter((e) => (e.source === id && !targetIds.has(e.target)) || (e.target === id && !targetIds.has(e.source)))
      .sort((a, b) => b.weight - a.weight)
      // A dense chart keeps fan labels for hovering: they would only collide.
      .slice(0, dense ? 0 : TOP_LABELS_PER_TARGET)
      .forEach((e) => topContacts.add(e.source === id ? e.target : e.source));
  }
  const strongEdges = new Set(
    [...net.edges]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, dense ? 10 : TOP_EDGE_LABELS)
      .map((e) => edgeKey(e.source, e.target)),
  );

  let focusNodes: Set<string> | undefined;
  let focusEdges: Set<string> | undefined;
  if (selection?.type === 'node' && byId.has(selection.id)) {
    focusNodes = new Set([selection.id]);
    focusEdges = new Set();
    for (const e of net.edges) {
      if (e.source !== selection.id && e.target !== selection.id) continue;
      focusNodes.add(e.source);
      focusNodes.add(e.target);
      focusEdges.add(edgeKey(e.source, e.target));
    }
  } else if (selection?.type === 'edge') {
    focusNodes = new Set([selection.source, selection.target]);
    focusEdges = new Set([edgeKey(selection.source, selection.target)]);
  }
  const selectedId = selection?.type === 'node' ? selection.id : undefined;

  const nameOf = (n: NetNode) => personName(profiles[n.id]) ?? (n.isTarget && n.label !== n.id ? n.label : undefined);
  const sizeOf = (n: NetNode) => {
    if (n.isTarget) return Math.round((compact ? 50 : 58) * Math.max(nodeScale, 0.6));
    const p = profiles[n.id];
    const base = 30 + 16 * Math.sqrt(n.weightedDegree / maxW);
    // Shared and identified people stay easy to spot even when shrunk.
    const keyNode = n.shared || !!personName(p) || !!p?.photo;
    return Math.round(Math.min(room, Math.max(base * nodeScale, keyNode ? 40 * Math.max(nodeScale, 0.7) : 0, p?.photo ? 44 * Math.max(nodeScale, 0.75) : 0, 14)));
  };

  const data = net.nodes.map((n) => {
    const p = profiles[n.id];
    const size = sizeOf(n);
    const name = nameOf(n);
    const pos = (fixed && input.moved?.get(n.id)) || layout.pos.get(n.id) || { x: 0, y: 0 };
    const dim = focusNodes && !focusNodes.has(n.id);
    const picked = !!input.group?.has(n.id);
    const glow =
      n.id === selectedId ? t.accent : picked ? t.group : mode === 'dark' && n.isTarget && input.colorBy === 'role' ? slotColor(n.slot ?? 99, mode) : undefined;
    const show = !dim && (input.allLabels || autoAll || n.isTarget || n.shared || !!name || topContacts.has(n.id) || !!focusNodes?.has(n.id));
    return {
      id: n.id,
      name: n.id,
      x: pos.x,
      y: pos.y,
      value: n.weightedDegree,
      symbol: `image://${iconUrl(nodeIcon(n, { mode, size, slots: slots.get(n.id), profile: p, colorBy: input.colorBy, communitySlots: input.communitySlots }))}`,
      symbolSize: size,
      itemStyle: {
        opacity: dim ? 0.16 : 1,
        ...(glow ? { shadowBlur: n.id === selectedId ? 24 : picked ? 20 : 16, shadowColor: glow } : {}),
      },
      label: {
        show,
        position: layout.labelSide?.get(n.id) ?? 'bottom',
        distance: layout.labelLower?.has(n.id) ? (dense ? 16 : 19) : 4,
        formatter: name ? `{n|${labelText(name)}}\n{d|${labelText(n.id, 24)}}` : `{d|${labelText(n.id, 24)}}`,
        rich: {
          n: { fontSize: n.isTarget ? 12.5 : dense ? 10.5 : 11.5, fontWeight: 600, color: ch.ink, lineHeight: dense ? 13 : 15 },
          d: { fontSize: n.isTarget ? 12 : dense ? 10 : 11, fontWeight: n.isTarget && !name ? 650 : 400, color: name ? ch.ink2 : ch.ink, lineHeight: dense ? 12 : 14 },
        },
        textBorderColor: ch.surface,
        textBorderWidth: 3,
      },
      // Keep the data needed by the tooltip and click handlers.
      node: n,
    };
  });

  // How each link looks, whether drawn straight or in right-angled pieces.
  const routed = input.layoutMode === 'hierarchy' || input.layoutMode === 'organization';
  const styleOf = (e: NetEdge) => {
    const key = edgeKey(e.source, e.target);
    const tt = targetIds.has(e.source) && targetIds.has(e.target);
    const owner = targetIds.has(e.source) ? e.source : e.target;
    const colour = tt ? ch.ink2 : input.colorBy === 'community' ? ch.other : slotColor(byId.get(owner)?.slot ?? 99, mode);
    const focused = !!focusEdges?.has(key);
    const dim = !!focusEdges && !focused;
    // Links between targets matter but should not dominate the picture; a
    // hierarchy keeps its lines thin, as an investigation chart does.
    const ratio = Math.log1p(e.weight) / Math.log1p(maxE);
    const width = (routed ? 1.1 + 3 * ratio : 1.2 + 4.8 * ratio + (tt ? 0.6 : 0)) + (focused ? 1 : 0);
    const ends = [byId.get(e.source), byId.get(e.target)];
    const keyEnd = ends.some((n) => n && !n.isTarget && (n.shared || profiles[n.id]));
    const important = tt || (!dense && keyEnd);
    // A dense chart labels only links that lead somewhere worth reading:
    // fan links' counts would sit on top of the fan's contacts.
    const strong = strongEdges.has(key) && (!dense || keyEnd);
    const showLabel = !dim && (input.allEdgeLabels || net.edges.length <= AUTO_ALL || important || strong || focused);
    return { tt, colour, focused, dim, width, showLabel };
  };
  const linkLabel = (e: NetEdge, show: boolean, colour: string) => ({
    show,
    formatter: fmtInt(e.weight),
    fontSize: dense ? 9.5 : 10.5,
    color: ch.ink,
    backgroundColor: ch.surface,
    borderColor: colour,
    borderWidth: 1,
    borderRadius: 8,
    padding: [1, 5],
    // Centred on the line like a link label in an investigation chart.
    distance: 0,
    verticalAlign: 'middle',
  });

  // Two invisible points at the frame's corners fix what the chart is fitted to.
  const frame = fixed ? linkFrame(layout, input.view, compact, input.moved) : undefined;
  const hidden = (id: string, x: number, y: number) => ({
    id,
    name: id,
    x,
    y,
    value: 0,
    symbol: 'none',
    symbolSize: 0,
    draggable: false,
    label: { show: false },
    tooltip: { trigger: 'none' },
    emphasis: { disabled: true },
  });
  const anchors = frame
    ? [
        [frame.minX, frame.minY],
        [frame.maxX, frame.maxY],
      ].map(([fx, fy], i) => hidden(FRAME_IDS[i], fx, fy))
    : [];

  let links: object[];
  let bends: object[] = [];
  if (routed) {
    // Right-angled links: invisible corner points, and each link in straight
    // pieces between them (worked out again whenever numbers are moved).
    const at = new Map(net.nodes.map((n) => [n.id, (fixed && input.moved?.get(n.id)) || layout.pos.get(n.id) || { x: 0, y: 0 }]));
    const routes = input.layoutMode === 'organization' ? routeOrg(net, at, layout.combs ?? new Map()) : routeTree(net, at);
    const clamp = (v: number, lo = -Infinity, hi = Infinity) => Math.max(lo, Math.min(hi, v));
    bends = [...routes.bends].map(([id, p]) => hidden(id, clamp(p.x, frame?.minX, frame?.maxX), clamp(p.y, frame?.minY, frame?.maxY)));
    const byKey = new Map(net.edges.map((e) => [edgeKey(e.source, e.target), e]));
    links = routes.pieces.map((p) => {
      const focused = !!focusEdges && p.edges.some((k) => focusEdges!.has(k));
      const dim = !!focusEdges && !focused;
      if (p.kind === 'bus') {
        // A trunk or bus shared by a target's links: thin, in the target's colour.
        const colour = input.colorBy === 'community' ? ch.other : slotColor(byId.get(p.owner ?? '')?.slot ?? 99, mode);
        return {
          source: p.source,
          target: p.target,
          symbol: ['none', 'none'],
          lineStyle: { color: colour, width: focused ? 2.4 : 1.4, opacity: dim ? 0.06 : focused ? 0.95 : t.link, curveness: 0 },
          label: { show: false },
          tooltip: { trigger: 'none' },
          emphasis: { disabled: true },
        };
      }
      const e = byKey.get(p.edges[0])!;
      const st = styleOf(e);
      // On the short drop into a number the count stands upright just above
      // it (a label in the middle would turn with the line); a level stub
      // keeps it in the middle.
      const drop = routes.bends.has(p.source) && !routes.bends.has(p.target);
      const from = routes.bends.get(p.source);
      const to = at.get(p.target);
      const upright = drop && !!from && !!to && Math.abs(to.y - from.y) > Math.abs(to.x - from.x);
      const arrowSize = Math.min(10, 5 + st.width) * Math.max(nodeScale, 0.7);
      const label = { ...linkLabel(e, !!p.label && st.showLabel, st.colour), ...(upright ? { position: 'end', distance: -24 - 17 * (p.stack ?? 0) } : {}) };
      return {
        source: p.source,
        target: p.target,
        value: e.weight,
        // A drop always ends at the icon's edge (an invisible dot where there is
        // no arrow; ECharts runs a bare line to the centre), so its count sits
        // the same way above every number.
        symbol: [p.arrows?.[0] ? 'arrow' : 'none', p.arrows?.[1] ? 'arrow' : drop ? 'circle' : 'none'],
        symbolSize: [arrowSize, p.arrows?.[1] || !drop ? arrowSize : 0.1],
        lineStyle: { color: st.colour, width: st.width, opacity: st.dim ? 0.06 : st.focused ? 0.95 : st.tt ? 0.75 : t.link, curveness: 0 },
        label,
        emphasis: { label: { show: !!p.label }, lineStyle: { width: st.width + 1, opacity: 1 } },
        edge: e,
      };
    });
  } else {
    links = net.edges.map((e) => {
      const st = styleOf(e);
      return {
        source: e.source,
        target: e.target,
        value: e.weight,
        symbol: [e.ba > 0 ? 'arrow' : 'none', e.ab > 0 ? 'arrow' : 'none'],
        symbolSize: Math.min(11, 6 + st.width) * Math.max(nodeScale, 0.7),
        // Links between two targets bow out so they never run through the
        // shared contacts placed on the straight line between them; packed
        // discs keep a clear corridor for them instead.
        lineStyle: { color: st.colour, width: st.width, opacity: st.dim ? 0.06 : st.focused ? 0.95 : st.tt ? 0.75 : t.link, curveness: st.tt && input.layoutMode !== 'packed' ? 0.22 : 0 },
        label: linkLabel(e, st.showLabel, st.colour),
        emphasis: { label: { show: true }, lineStyle: { width: st.width + 1, opacity: 1 } },
        edge: e,
      };
    });
  }

  const n = net.nodes.length;
  return {
    textStyle: ch.textStyle,
    animationDurationUpdate: 260,
    tooltip: {
      ...ch.tooltip,
      // Hidden while a selection box is drawn over the numbers.
      className: 'link-tip',
      formatter: (p: { dataType?: string; data?: { node?: NetNode; edge?: NetEdge } }) => {
        if (p.dataType === 'edge' && p.data?.edge) return edgeTooltip(p.data.edge, byId, profiles, unit, y);
        if (p.dataType === 'node' && p.data?.node) return nodeTooltip(p.data.node, net, profiles, y);
        return '';
      },
    },
    // No ECharts thumbnail (minimap): in 6.1 it cannot draw image symbols.
    series: [
      {
        type: 'graph',
        id: 'link',
        layout: input.layoutMode === 'force' ? 'force' : 'none',
        // With the selection box, dragging empty space picks numbers: the
        // wheel and pinch still zoom, and the view moves with a right drag.
        roam: fixed && input.tool === 'select' ? 'scale' : true,
        draggable: true,
        nodeScaleRatio: 0.55,
        top: padY,
        bottom: padY + 8,
        left: padX,
        right: padX,
        // Keep the layout's proportions (ECharts 6 stretches it to the box otherwise).
        preserveAspect: 'contain',
        force:
          input.layoutMode === 'force'
            ? {
                repulsion: Math.max(80, Math.min(360, 1600 / Math.sqrt(n || 1))),
                edgeLength: n > 60 ? [70, 170] : [90, 200],
                gravity: n > 60 ? 0.06 : 0.05,
                friction: 0.25,
                layoutAnimation: n > 150,
              }
            : undefined,
        labelLayout: { hideOverlap: true },
        // A hierarchy's links are pieces: fading all but the hovered one's
        // neighbours would cut its lines short.
        emphasis: { focus: routed ? 'none' : 'adjacency', scale: 1.1, label: { show: true } },
        blur: { itemStyle: { opacity: 0.14 }, lineStyle: { opacity: 0.05 }, label: { opacity: 0.1 } },
        edgeLabel: { show: false },
        data: [...data, ...anchors, ...bends],
        links,
      },
    ],
  };
}

function nodeTooltip(n: NetNode, net: Network, profiles: ProfileMap, y: 'ce' | 'be'): string {
  const p = profiles[n.id];
  const name = personName(p) ?? (n.isTarget && n.label !== n.id ? n.label : undefined);
  const kind = n.isTarget ? 'เป้าหมาย' : n.shared ? `ผู้ติดต่อร่วม · ${PEER_KIND_TH[n.kind as keyof typeof PEER_KIND_TH] ?? ''}` : (PEER_KIND_TH[n.kind as keyof typeof PEER_KIND_TH] ?? '');
  const lines = [`<div style="font-weight:650">${escapeHtml(name ?? n.id)}</div>`];
  if (name) lines.push(`<div style="opacity:.8">${escapeHtml(n.id)}</div>`);
  lines.push(`<div style="opacity:.75">${escapeHtml(kind)}</div>`);
  const mine = net.edges.filter((e) => e.source === n.id || e.target === n.id).sort((a, b) => b.events - a.events);
  for (const e of mine.slice(0, 5)) {
    const other = e.source === n.id ? e.target : e.source;
    const out = e.source === n.id ? e.ab : e.ba;
    const inn = e.source === n.id ? e.ba : e.ab;
    lines.push(`<div style="margin-top:2px">↔ ${escapeHtml(other)}: <strong>${escapeHtml(fmtInt(e.events))}</strong> ครั้ง (ออก ${escapeHtml(fmtInt(out))} · เข้า ${escapeHtml(fmtInt(inn))}) · ${escapeHtml(fmtDate(e.firstTs, y))}–${escapeHtml(fmtDate(e.lastTs, y))}</div>`);
  }
  if (mine.length > 5) lines.push(`<div style="opacity:.7">และอีก ${mine.length - 5} เส้น</div>`);
  const rec = recordLines(p);
  if (rec.length) {
    lines.push(`<div style="margin-top:4px;font-weight:600">ประวัติคดี ${rec.length} รายการ</div>`);
    for (const r of rec.slice(0, 3)) lines.push(`<div>• ${escapeHtml(r.length > 70 ? `${r.slice(0, 69)}…` : r)}</div>`);
  }
  if (p?.address) lines.push(`<div style="margin-top:4px;opacity:.8">${escapeHtml(p.address.split('\n')[0].slice(0, 80))}</div>`);
  return `<div style="max-width:340px;white-space:normal">${lines.join('')}</div>`;
}

function edgeTooltip(e: NetEdge, byId: Map<string, NetNode>, profiles: ProfileMap, unit: string, y: 'ce' | 'be'): string {
  const who = (id: string) => personName(profiles[id]) ?? (byId.get(id)?.isTarget && byId.get(id)!.label !== id ? byId.get(id)!.label : undefined);
  const name = (id: string) => (who(id) ? `${who(id)} (${id})` : id);
  const rows = [
    `<div style="font-weight:650">${escapeHtml(name(e.source))} ↔ ${escapeHtml(name(e.target))}</div>`,
    `<div>${escapeHtml(e.source)} → ${escapeHtml(e.target)}: <strong>${escapeHtml(fmtInt(e.ab))}</strong> ครั้ง</div>`,
    `<div>${escapeHtml(e.target)} → ${escapeHtml(e.source)}: <strong>${escapeHtml(fmtInt(e.ba))}</strong> ครั้ง</div>`,
    `<div>โทร ${escapeHtml(fmtInt(e.calls))} · สนทนา ${escapeHtml(fmtInt(Math.round(e.talkSec / 60)))} นาที · SMS ${escapeHtml(fmtInt(e.sms))}</div>`,
    `<div style="opacity:.75">${escapeHtml(fmtDate(e.firstTs, y))} – ${escapeHtml(fmtDate(e.lastTs, y))} · น้ำหนักเส้น ${escapeHtml(fmtInt(e.weight))} ${escapeHtml(unit)}</div>`,
  ];
  return `<div style="max-width:360px;white-space:normal">${rows.join('')}</div>`;
}
