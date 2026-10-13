import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, GraphChart, HeatmapChart, LineChart, ScatterChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, MarkAreaComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption, ECharts } from 'echarts/core';
import { CHROME, type ThemeMode } from '../lib/palette';
import { escapeHtml } from './download';

echarts.use([BarChart, LineChart, HeatmapChart, GraphChart, ScatterChart, GridComponent, TooltipComponent, VisualMapComponent, DataZoomComponent, MarkAreaComponent, CanvasRenderer]);

interface Props {
  option: EChartsCoreOption;
  height: number | string;
  label: string;
  onClick?: (params: { name?: string; data?: unknown; dataType?: string }) => void;
  /** Click on empty canvas (no chart element under the pointer). */
  onBlankClick?: () => void;
  onReady?: (chart: ECharts) => void;
  /**
   * Merge option updates into the chart instead of replacing it, so the
   * user's zoom/pan (and force-layout positions) survive style changes. A new
   * `resetKey` still forces a full replace.
   */
  merge?: boolean;
  resetKey?: unknown;
}

export function EChart({ option, height, label, onClick, onBlankClick, onReady, merge, resetKey }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts>(null);
  const click = useRef(onClick);
  click.current = onClick;
  const blank = useRef(onBlankClick);
  blank.current = onBlankClick;
  const lastReset = useRef<unknown>(undefined);

  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, undefined, { renderer: 'canvas' });
    chart.current = c;
    c.on('click', (p) => click.current?.(p as never));
    c.getZr().on('click', (e) => {
      if (!e.target) blank.current?.();
    });
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    onReady?.(c);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
      lastReset.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const replace = !merge || lastReset.current !== resetKey;
    lastReset.current = resetKey;
    c.setOption(option, { notMerge: replace });
  }, [option, merge, resetKey]);

  return <div ref={el} className="chart-box" style={{ height }} role="img" aria-label={label} />;
}

/** Axis, grid and tooltip chrome shared by every chart (recessive hairlines). */
export function chrome(mode: ThemeMode) {
  const c = CHROME[mode];
  const axis = {
    axisLine: { lineStyle: { color: c.axis, width: 1 } },
    axisTick: { show: false },
    axisLabel: { color: c.muted, fontSize: 11 },
    splitLine: { show: false },
  };
  return {
    textStyle: { fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font') || 'system-ui', color: c.ink2 },
    grid: { left: 8, right: 12, top: 12, bottom: 8, containLabel: true },
    categoryAxis: axis,
    valueAxis: {
      ...axis,
      axisLine: { show: false },
      splitLine: { show: true, lineStyle: { color: c.grid, width: 1, type: 'solid' as const } },
    },
    tooltip: {
      backgroundColor: c.surface,
      borderColor: mode === 'light' ? 'rgba(11,11,11,0.12)' : 'rgba(255,255,255,0.14)',
      borderWidth: 1,
      textStyle: { color: c.ink, fontSize: 12.5 },
      extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,.12); border-radius: 8px;',
      confine: true,
    },
    surface: c.surface,
    ink: c.ink,
    ink2: c.ink2,
    muted: c.muted,
    gridColor: c.grid,
    axisColor: c.axis,
    other: c.other,
  };
}

/** Tooltip rows: value first (strong), series name after, keyed by a short line of the series colour. */
export function tooltipRows(title: string, rows: { color: string; name: string; value: string }[]): string {
  const lines = rows
    .map(
      (r) =>
        `<div style="display:flex;align-items:center;gap:8px;margin-top:3px"><span style="display:inline-block;width:12px;height:2px;background:${r.color};border-radius:1px"></span><strong style="min-width:36px;font-variant-numeric:tabular-nums">${escapeHtml(r.value)}</strong><span style="opacity:.75">${escapeHtml(r.name)}</span></div>`,
    )
    .join('');
  return `<div style="font-weight:600;margin-bottom:2px">${escapeHtml(title)}</div>${lines}`;
}

interface CardProps {
  title: string;
  sub?: ReactNode;
  legend?: { color: string; label: string; shape?: 'rect' | 'line' | 'dot' }[];
  table?: { columns: string[]; rows: (string | number)[][] };
  actions?: ReactNode;
  children: ReactNode;
}

/** A figure with title, legend and a table-view twin (the accessible equivalent). */
export function ChartCard({ title, sub, legend, table, actions, children }: CardProps) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="card chart">
      <header>
        <div>
          <h3>{title}</h3>
          {sub && <div className="sub">{sub}</div>}
        </div>
        <div className="no-print" style={{ display: 'flex', gap: 6 }}>
          {actions}
          {table && (
            <button className="btn small" type="button" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
              {asTable ? 'ดูเป็นกราฟ' : 'ดูเป็นตาราง'}
            </button>
          )}
        </div>
      </header>
      {legend && legend.length > 1 && !asTable && (
        <div className="legend">
          {legend.map((l) => (
            <span key={l.label}>
              <i
                aria-hidden="true"
                style={{
                  display: 'inline-block',
                  width: l.shape === 'line' ? 14 : 10,
                  height: l.shape === 'line' ? 2 : 10,
                  borderRadius: l.shape === 'dot' ? '50%' : 2,
                  background: l.color,
                }}
              />
              {l.label}
            </span>
          ))}
        </div>
      )}
      {asTable && table ? (
        <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table className="data" aria-label={title}>
            <thead>
              <tr>
                {table.columns.map((c, i) => (
                  <th key={c} className={i > 0 ? 'num' : undefined} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) => (
                    <td key={j} className={j > 0 ? 'num' : undefined}>
                      {typeof v === 'number' ? v.toLocaleString('th-TH') : v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </figure>
  );
}
