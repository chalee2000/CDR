import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ECharts } from 'echarts/core';
import { hubLayout } from '../lib/analysis/linkLayout';
import type { Network } from '../lib/analysis/network';
import type { ThemeMode } from '../lib/palette';
import type { ProfileMap } from '../lib/profiles';
import { EChart } from './Chart';
import { buildLinkOption, type LinkColorBy, type LinkLayoutMode, type LinkSelection } from './linkChartOption';
import { onPhotoLoad } from './photo';

interface Props {
  network: Network;
  mode: ThemeMode;
  profiles: ProfileMap;
  unit: string;
  yearStyle: 'ce' | 'be';
  label: string;
  height: number | string;
  layoutMode?: LinkLayoutMode;
  colorBy?: LinkColorBy;
  communitySlots?: Map<number, number>;
  allLabels?: boolean;
  allEdgeLabels?: boolean;
  selection?: LinkSelection;
  onSelect?: (sel: LinkSelection | undefined) => void;
  compact?: boolean;
  /** Changing it redraws from scratch (fit to view, re-run the layout). */
  resetKey?: unknown;
  onReady?: (chart: ECharts) => void;
  /** Double click shows this chart full screen; again (or Esc) goes back. */
  expandable?: boolean;
  /** Double click does this instead (e.g. a full-screen view of a whole card). */
  onDoubleClick?: () => void;
}

/** native: the Fullscreen API; css: a fixed overlay where the API is missing (iPhone). */
type Full = 'off' | 'native' | 'css';

/** How long a click waits for a second one before it counts as a click. */
const DBL_WAIT_MS = 250;

const NO_COMMUNITIES = new Map<number, number>();

/** Investigation-style link chart (icons, direction arrows, counts on links). */
export function LinkChart({
  network,
  mode,
  profiles,
  unit,
  yearStyle,
  label,
  height,
  layoutMode = 'hub',
  colorBy = 'role',
  communitySlots = NO_COMMUNITIES,
  allLabels = false,
  allEdgeLabels = false,
  selection,
  onSelect,
  compact,
  resetKey,
  onReady,
  expandable,
  onDoubleClick,
}: Props) {
  const layout = useMemo(() => hubLayout(network), [network]);
  // Photos decode asynchronously; redraw (keeping the view) once they are ready.
  const [photoTick, setPhotoTick] = useState(0);
  useEffect(() => onPhotoLoad(() => setPhotoTick((t) => t + 1)), []);
  // Icons are sized in screen pixels, so the drawing area decides how big they
  // can be before a dense chart overlaps itself.
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<{ w: number; h: number }>();
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.clientWidth / 40) * 40;
      const h = Math.round(el.clientHeight / 40) * 40;
      setView((v) => (v && v.w === w && v.h === h ? v : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [full, setFull] = useState<Full>('off');
  const exitFull = useCallback(() => {
    if (wrap.current && document.fullscreenElement === wrap.current) void document.exitFullscreen().catch(() => undefined);
    setFull('off');
  }, []);
  const enterFull = () => {
    const el = wrap.current;
    if (!el) return;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => setFull('css'));
    else setFull('css');
  };
  useEffect(() => {
    const el = wrap.current;
    const on = () => setFull((f) => (el && document.fullscreenElement === el ? 'native' : f === 'native' ? 'off' : f));
    document.addEventListener('fullscreenchange', on);
    return () => {
      document.removeEventListener('fullscreenchange', on);
      // Leaving the page (e.g. the drawer closes) ends full screen too.
      if (el && document.fullscreenElement === el) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    if (full === 'off') return;
    // Capture phase: Esc leaves full screen only, not the drawer around the chart.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      exitFull();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [full, exitFull]);

  // With a double-click action, a click on a number or link waits briefly so
  // that double-clicking one does not also open it.
  const dblAction = onDoubleClick ?? (expandable ? () => (full === 'off' ? enterFull() : exitFull()) : undefined);
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(pending.current), []);

  const option = useMemo(
    () => buildLinkOption({ network, layout, mode, layoutMode, colorBy, communitySlots, profiles, unit, allLabels, allEdgeLabels, selection, compact, yearStyle, view }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [network, layout, mode, layoutMode, colorBy, communitySlots, profiles, unit, allLabels, allEdgeLabels, selection, compact, yearStyle, view, photoTick],
  );
  // A new network, layout mode or explicit reset replaces the chart; anything
  // else (selection, labels, photos, colours, size) merges and keeps the view.
  const structure = useMemo(() => ({}), [network, layoutMode, resetKey]);

  return (
    <div ref={wrap} className={`link-chart${full !== 'off' ? ' is-full' : ''}${full === 'css' ? ' is-max' : ''}`}>
      <EChart
        option={option}
        height={full === 'off' ? height : '100%'}
        label={label}
        merge
        resetKey={structure}
        onReady={onReady}
        onBlankClick={() => onSelect?.(undefined)}
        onDblClick={
          dblAction &&
          (() => {
            clearTimeout(pending.current);
            dblAction();
          })
        }
        onClick={(p) => {
          const d = p.data as { node?: { id: string }; edge?: { source: string; target: string } } | undefined;
          const sel: LinkSelection | undefined =
            p.dataType === 'node' && d?.node ? { type: 'node', id: d.node.id } : p.dataType === 'edge' && d?.edge ? { type: 'edge', source: d.edge.source, target: d.edge.target } : undefined;
          if (!sel) return;
          // What a click opens lives outside the chart: leave full screen to show it.
          const wasFull = full !== 'off';
          const fire = () => {
            if (wasFull) exitFull();
            onSelect?.(sel);
          };
          clearTimeout(pending.current);
          if (dblAction) pending.current = setTimeout(fire, DBL_WAIT_MS);
          else fire();
        }}
      />
      {full !== 'off' && (
        <div className="link-full-bar">
          <span>ดับเบิลคลิกหรือกด Esc เพื่อกลับ</span>
          <button className="btn small" type="button" onClick={exitFull}>
            ออกจากเต็มจอ
          </button>
        </div>
      )}
    </div>
  );
}
