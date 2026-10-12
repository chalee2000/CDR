import type { DayRow, HourProfile } from '../lib/analysis/temporal';
import { WEEKDAYS_TH } from '../lib/labels';
import { slotColor, SEQUENTIAL_BLUE, type ThemeMode } from '../lib/palette';
import { chrome, tooltipRows } from './Chart';

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
