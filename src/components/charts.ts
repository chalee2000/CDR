import type { CallBurst } from '../lib/analysis/bursts';
import type { DayRow, HourProfile } from '../lib/analysis/temporal';
import { WEEKDAYS_TH } from '../lib/labels';
import { slotColor, SEQUENTIAL_BLUE, type ThemeMode } from '../lib/palette';
import { DAY, dayKey, fmtTime, startOfDay } from '../lib/time';
import { chrome, tooltipRows } from './Chart';
import { escapeHtml } from './download';

// Series identity is fixed across every chart: slot 1 = โทรออก, 2 = โทรเข้า, 3 = SMS.
export const SERIES = [
  { key: 'callOut', label: 'โทรออก', slot: 0 },
  { key: 'callIn', label: 'โทรเข้า', slot: 1 },
  { key: 'sms', label: 'SMS', slot: 2 },
] as const;

export function seriesLegend(mode: ThemeMode) {
  return SERIES.map((s) => ({ color: slotColor(s.slot, mode), label: s.label }));
}

type AxisParam = { axisValueLabel?: string; name?: string; seriesName: string; value: number; color: string };

function axisTooltip(mode: ThemeMode, titleOf?: (p: AxisParam) => string) {
  const ch = chrome(mode);
  return {
    ...ch.tooltip,
    trigger: 'axis' as const,
    axisPointer: { type: 'shadow' as const, shadowStyle: { color: mode === 'light' ? 'rgba(11,11,11,0.04)' : 'rgba(255,255,255,0.05)' } },
    formatter: (params: AxisParam[]) => {
      const list = Array.isArray(params) ? params : [params];
      const title = titleOf ? titleOf(list[0]) : (list[0]?.axisValueLabel ?? '');
      return tooltipRows(
        title,
        list.map((p) => ({ color: p.color, name: p.seriesName, value: Number(p.value ?? 0).toLocaleString('th-TH') })),
      );
    },
  };
}

/** Bar mark spec: <= 24 px, 4 px rounded data end, 2 px surface gap in stacks. */
function bar(name: string, data: number[], color: string, surface: string, top: boolean) {
  return {
    name,
    type: 'bar',
    stack: 'total',
    data,
    barMaxWidth: 24,
    itemStyle: { color, borderColor: surface, borderWidth: 1, borderRadius: top ? [4, 4, 0, 0] : 0 },
    emphasis: { focus: 'none', itemStyle: { opacity: 0.85 } },
  };
}

const dayLabel = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

export function dailyOption(rows: DayRow[], mode: ThemeMode) {
  const ch = chrome(mode);
  const days = rows.map((r) => r.day);
  return {
    textStyle: ch.textStyle,
    grid: { ...ch.grid, bottom: rows.length > 45 ? 34 : 8 },
    tooltip: axisTooltip(mode, (p) => {
      const d = days.find((x) => dayLabel(x) === p.axisValueLabel) ?? '';
      return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : String(p.axisValueLabel ?? '');
    }),
    xAxis: { type: 'category', data: days.map(dayLabel), ...ch.categoryAxis },
    yAxis: { type: 'value', minInterval: 1, ...ch.valueAxis },
    dataZoom: rows.length > 45 ? [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 4, borderColor: 'transparent', fillerColor: mode === 'light' ? 'rgba(42,120,214,0.12)' : 'rgba(57,135,229,0.2)', textStyle: { color: ch.muted } }] : [],
    series: [
      bar('โทรออก', rows.map((r) => r.callOut), slotColor(0, mode), ch.surface, false),
      bar('โทรเข้า', rows.map((r) => r.callIn), slotColor(1, mode), ch.surface, false),
      bar('SMS', rows.map((r) => r.smsOut + r.smsIn), slotColor(2, mode), ch.surface, true),
    ],
  };
}

export function dataVolumeOption(rows: DayRow[], mode: ThemeMode) {
  const ch = chrome(mode);
  return {
    textStyle: ch.textStyle,
    grid: { ...ch.grid, bottom: rows.length > 45 ? 34 : 8 },
    tooltip: axisTooltip(mode),
    xAxis: { type: 'category', data: rows.map((r) => dayLabel(r.day)), ...ch.categoryAxis },
    yAxis: { type: 'value', ...ch.valueAxis, axisLabel: { ...ch.valueAxis.axisLabel, formatter: (v: number) => `${v} MB` } },
    dataZoom: rows.length > 45 ? [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 4, borderColor: 'transparent', textStyle: { color: ch.muted } }] : [],
    series: [
      {
        name: 'ปริมาณข้อมูล (MB)',
        type: 'bar',
        data: rows.map((r) => Math.round((r.dataBytes / 1048576) * 10) / 10),
        barMaxWidth: 24,
        itemStyle: { color: slotColor(0, mode), borderRadius: [4, 4, 0, 0] },
      },
    ],
  };
}

export function hourOption(p: HourProfile, mode: ThemeMode) {
  const ch = chrome(mode);
  const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
  return {
    textStyle: ch.textStyle,
    grid: ch.grid,
    tooltip: axisTooltip(mode, (x) => `${x.axisValueLabel}:00–${x.axisValueLabel}:59 น.`),
    xAxis: { type: 'category', data: hours, ...ch.categoryAxis },
    yAxis: { type: 'value', minInterval: 1, ...ch.valueAxis },
    series: [
      bar('โทรออก', p.callOut, slotColor(0, mode), ch.surface, false),
      bar('โทรเข้า', p.callIn, slotColor(1, mode), ch.surface, false),
      bar('SMS', p.sms, slotColor(2, mode), ch.surface, true),
    ],
  };
}

/** Single-series hour profile (e.g. one contact). */
export function singleHourOption(hours: number[], mode: ThemeMode, name: string) {
  const ch = chrome(mode);
  return {
    textStyle: ch.textStyle,
    grid: ch.grid,
    tooltip: axisTooltip(mode, (x) => `${x.axisValueLabel}:00–${x.axisValueLabel}:59 น.`),
    xAxis: { type: 'category', data: hours.map((_, h) => String(h).padStart(2, '0')), ...ch.categoryAxis },
    yAxis: { type: 'value', minInterval: 1, ...ch.valueAxis },
    series: [{ name, type: 'bar', data: hours, barMaxWidth: 24, itemStyle: { color: slotColor(0, mode), borderRadius: [4, 4, 0, 0] } }],
  };
}

const hourText = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:00`;

/**
 * Call bursts on a day x time-of-day plane: one dot per burst, area by size,
 * colour by target. Night hours sit on a recessive band, so bursts that keep
 * recurring at the same hour (or at night) stand out.
 */
export function burstOption(
  bursts: CallBurst[],
  targets: { id: string; slot: number; target: string; label: string }[],
  range: [number, number],
  mode: ThemeMode,
  night: { start: number; end: number },
) {
  const ch = chrome(mode);
  const first = startOfDay(range[0]);
  const days: string[] = [];
  for (let t = first; t <= startOfDay(range[1]); t += DAY) days.push(dayKey(t));
  const maxCount = Math.max(1, ...bursts.map((b) => b.count));
  const hourFloat = (ts: number) => (ts - startOfDay(ts)) / 3_600_000;
  const band = mode === 'light' ? 'rgba(11,11,11,0.045)' : 'rgba(255,255,255,0.05)';
  // Bursts on the same day within ~1.5 h of each other sit side by side
  // (pixel offsets), so same-night bursts of two targets never hide each other.
  const dayOf = (b: CallBurst) => Math.round((startOfDay(b.from) - first) / DAY);
  const offset = new Map<string, number>();
  const byDay = new Map<number, CallBurst[]>();
  for (const b of bursts) byDay.set(dayOf(b), [...(byDay.get(dayOf(b)) ?? []), b]);
  for (const list of byDay.values()) {
    list.sort((x, y) => x.from - y.from);
    let group: CallBurst[] = [];
    const flush = () => group.forEach((b, k) => offset.set(b.id, (k - (group.length - 1) / 2) * 16));
    for (const b of list) {
      if (group.length && hourFloat(b.from) - hourFloat(group[group.length - 1].from) > 1.5) {
        flush();
        group = [];
      }
      group.push(b);
    }
    flush();
  }
  const series = targets.map((t, i) => ({
    name: t.label,
    type: 'scatter',
    data: bursts
      .filter((b) => b.datasetId === t.id)
      .map((b) => ({ value: [dayOf(b), hourFloat(b.from), b.count, b.id], symbolOffset: [offset.get(b.id) ?? 0, 0] })),
    symbolSize: (v: number[]) => 9 + 21 * Math.sqrt(v[2] / maxCount),
    itemStyle: { color: slotColor(t.slot, mode), opacity: 0.85, borderColor: ch.surface, borderWidth: 1.5 },
    emphasis: { scale: 1.25, itemStyle: { opacity: 1 } },
    // Night shading once, under the dots.
    markArea:
      i === 0
        ? {
            silent: true,
            itemStyle: { color: band },
            data:
              night.start > night.end
                ? [
                    [{ yAxis: night.start }, { yAxis: 24 }],
                    [{ yAxis: 0 }, { yAxis: night.end }],
                  ]
                : [[{ yAxis: night.start }, { yAxis: night.end }]],
          }
        : undefined,
  }));
  const byId = new Map(bursts.map((b) => [b.id, b]));
  const nameOf = new Map(targets.map((t) => [t.id, t.label]));
  return {
    textStyle: ch.textStyle,
    grid: { ...ch.grid, top: 10, bottom: days.length > 45 ? 34 : 8 },
    tooltip: {
      ...ch.tooltip,
      trigger: 'item',
      formatter: (p: { value: [number, number, number, string]; color: string }) => {
        const b = byId.get(p.value[3]);
        if (!b) return '';
        const peers = b.peers
          .slice(0, 4)
          .map((x) => `${escapeHtml(x.peer)} ×${x.count}`)
          .join(', ');
        return (
          tooltipRows(`${nameOf.get(b.datasetId) ?? b.target} · ${b.from ? `${dayKey(b.from).slice(8, 10)}/${dayKey(b.from).slice(5, 7)}/${dayKey(b.from).slice(0, 4)}` : ''} ${fmtTime(b.from)}–${fmtTime(b.to)}`, [
            { color: p.color, name: 'ครั้งในช่วงนี้', value: b.count.toLocaleString('th-TH') },
          ]) +
          `<div style="margin-top:3px;opacity:.8">โทรออก ${b.callsOut} · โทรเข้า ${b.callsIn} · SMS ${b.sms}</div><div style="opacity:.8;max-width:300px;white-space:normal">${peers}${b.peers.length > 4 ? ' …' : ''}</div>`
        );
      },
    },
    xAxis: { type: 'category', data: days.map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`), boundaryGap: true, ...ch.categoryAxis },
    yAxis: {
      type: 'value',
      min: 0,
      max: 24,
      interval: 3,
      inverse: true,
      ...ch.valueAxis,
      axisLabel: { ...ch.valueAxis.axisLabel, formatter: (v: number) => hourText(v) },
    },
    dataZoom: days.length > 45 ? [{ type: 'inside', xAxisIndex: 0 }, { type: 'slider', xAxisIndex: 0, height: 16, bottom: 4, borderColor: 'transparent', textStyle: { color: ch.muted } }] : [],
    series,
  };
}

/** Weekday x hour heatmap on the sequential blue ramp (light = near zero). */
export function heatOption(heat: number[][], mode: ThemeMode) {
  const ch = chrome(mode);
  const data: [number, number, number][] = [];
  let max = 0;
  heat.forEach((row, d) =>
    row.forEach((v, h) => {
      data.push([h, d, v]);
      max = Math.max(max, v);
    }),
  );
  // Near-zero recedes toward the surface in both modes: light runs pale -> dark
  // blue, dark mode runs from a deep step up to a pale step (its own selection).
  const ramp = mode === 'light' ? ['#eef3f9', ...SEQUENTIAL_BLUE] : ['#1d2530', ...[...SEQUENTIAL_BLUE].reverse().slice(0, 12)];
  return {
    textStyle: ch.textStyle,
    grid: { ...ch.grid, bottom: 44 },
    tooltip: {
      ...ch.tooltip,
      formatter: (p: { value: [number, number, number] }) => {
        const [h, d, v] = p.value;
        return tooltipRows(`${WEEKDAYS_TH[d]} ${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59`, [{ color: slotColor(0, mode), name: 'ครั้ง (โทร + SMS)', value: v.toLocaleString('th-TH') }]);
      },
    },
    xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')), ...ch.categoryAxis, axisLine: { show: false } },
    yAxis: { type: 'category', data: WEEKDAYS_TH, inverse: true, ...ch.categoryAxis, axisLine: { show: false } },
    visualMap: {
      min: 0,
      max: Math.max(1, max),
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemHeight: 140,
      itemWidth: 10,
      text: [String(max), '0'],
      textStyle: { color: ch.muted, fontSize: 11 },
      inRange: { color: ramp },
    },
    series: [
      {
        type: 'heatmap',
        data,
        itemStyle: { borderColor: ch.surface, borderWidth: 2, borderRadius: 3 },
        emphasis: { itemStyle: { borderColor: ch.ink, borderWidth: 1 } },
      },
    ],
  };
}
