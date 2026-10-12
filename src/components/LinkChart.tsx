import { useEffect, useMemo, useRef, useState } from 'react';
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
}

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

  const option = useMemo(
    () => buildLinkOption({ network, layout, mode, layoutMode, colorBy, communitySlots, profiles, unit, allLabels, allEdgeLabels, selection, compact, yearStyle, view }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [network, layout, mode, layoutMode, colorBy, communitySlots, profiles, unit, allLabels, allEdgeLabels, selection, compact, yearStyle, view, photoTick],
  );
  // A new network, layout mode or explicit reset replaces the chart; anything
  // else (selection, labels, photos, colours, size) merges and keeps the view.
  const structure = useMemo(() => ({}), [network, layoutMode, resetKey]);

  return (
    <div ref={wrap}>
      <EChart
      option={option}
      height={height}
      label={label}
      merge
      resetKey={structure}
      onReady={onReady}
      onBlankClick={() => onSelect?.(undefined)}
      onClick={(p) => {
        const d = p.data as { node?: { id: string }; edge?: { source: string; target: string } } | undefined;
        if (p.dataType === 'node' && d?.node) onSelect?.({ type: 'node', id: d.node.id });
        else if (p.dataType === 'edge' && d?.edge) onSelect?.({ type: 'edge', source: d.edge.source, target: d.edge.target });
      }}
      />
    </div>
  );
}
