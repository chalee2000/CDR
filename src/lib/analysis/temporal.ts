import { activeInteractions, isComm } from '../dataset';
import { periodOfHour } from '../labels';
import { isPersonKind } from '../phone';
import { DAY, dayKey, hourOf, MINUTE, HOUR, startOfDay, weekdayMon0 } from '../time';
import type { Dataset, Settings } from '../types';
import { siteLabelOf } from './locations';

export interface DayRow {
  day: string;
  ts: number;
  callOut: number;
  callIn: number;
  callMissed: number;
  smsOut: number;
  smsIn: number;
  data: number;
  dataBytes: number;
  comm: number;
}

/** One row per calendar day from first to last record (gaps included as zero). */
export function dailySeries(ds: Dataset, settings: Settings): DayRow[] {
  const items = activeInteractions(ds, settings);
  if (items.length === 0) return [];
  const rows = new Map<string, DayRow>();
  let min = Infinity;
  let max = -Infinity;
  for (const it of items) {
    min = Math.min(min, it.ts);
    max = Math.max(max, it.ts);
  }
  for (let t = startOfDay(min); t <= startOfDay(max); t += DAY) {
    const day = dayKey(t);
    rows.set(day, { day, ts: t, callOut: 0, callIn: 0, callMissed: 0, smsOut: 0, smsIn: 0, data: 0, dataBytes: 0, comm: 0 });
  }
  for (const it of items) {
    const r = rows.get(dayKey(it.ts))!;
    if (it.service === 'call') {
      if (it.direction === 'out') r.callOut++;
      else r.callIn++;
      if (it.answered === false) r.callMissed++;
      r.comm++;
    } else if (it.service === 'sms') {
      if (it.direction === 'out') r.smsOut++;
      else r.smsIn++;
      r.comm++;
    } else if (it.service === 'data') {
      r.data++;
      r.dataBytes += it.bytes ?? 0;
    }
  }
  return [...rows.values()];
}

export interface HourProfile {
  /** [hour] counts of calls + SMS */
  comm: number[];
  calls: number[];
  callOut: number[];
  callIn: number[];
  sms: number[];
  data: number[];
  /** [weekday Mon=0][hour] calls + SMS */
  heat: number[][];
  periods: Record<string, number>;
}

export function hourProfile(ds: Dataset, settings: Settings, personOnly = false): HourProfile {
  const p: HourProfile = {
    comm: new Array(24).fill(0),
    calls: new Array(24).fill(0),
    callOut: new Array(24).fill(0),
    callIn: new Array(24).fill(0),
    sms: new Array(24).fill(0),
    data: new Array(24).fill(0),
    heat: Array.from({ length: 7 }, () => new Array(24).fill(0)),
    periods: { morning: 0, midday: 0, evening: 0, night: 0 },
  };
  for (const it of activeInteractions(ds, settings)) {
    const h = hourOf(it.ts);
    if (it.service === 'data') {
      p.data[h]++;
      continue;
    }
    if (!isComm(it)) continue;
    if (personOnly && !isPersonKind(it.peerKind)) continue;
    p.comm[h]++;
    if (it.service === 'call') {
      p.calls[h]++;
      if (it.direction === 'out') p.callOut[h]++;
      else p.callIn[h]++;
    } else p.sms[h]++;
    p.heat[weekdayMon0(it.ts)][h]++;
    p.periods[periodOfHour(h)]++;
  }
  return p;
}

export interface Gap {
  from: number;
  to: number;
  hours: number;
}

/** Periods with no record of any kind (phone off, out of coverage, or another handset). */
export function silences(ds: Dataset, settings: Settings): Gap[] {
  const ts = activeInteractions(ds, settings)
    .map((i) => i.ts)
    .sort((a, b) => a - b);
  const out: Gap[] = [];
  for (let i = 1; i < ts.length; i++) {
    const gap = ts[i] - ts[i - 1];
    if (gap >= settings.silenceHours * HOUR) out.push({ from: ts[i - 1], to: ts[i], hours: gap / HOUR });
  }
  return out.sort((a, b) => b.hours - a.hours);
}

export interface Burst {
  from: number;
  to: number;
  count: number;
  peers: string[];
}

/** Windows with >= burstCount person calls/SMS inside burstMinutes (merged when overlapping). */
export function bursts(ds: Dataset, settings: Settings): Burst[] {
  const events = activeInteractions(ds, settings)
    .filter((i) => isComm(i) && isPersonKind(i.peerKind))
    .sort((a, b) => a.ts - b.ts);
  const win = settings.burstMinutes * MINUTE;
  const spans: [number, number][] = [];
  let j = 0;
  for (let i = 0; i < events.length; i++) {
    while (events[i].ts - events[j].ts > win) j++;
    if (i - j + 1 < settings.burstCount) continue;
    const last = spans[spans.length - 1];
    if (last && j <= last[1]) last[1] = i;
    else spans.push([j, i]);
  }
  return spans.map(([a, b]) => {
    const slice = events.slice(a, b + 1);
    return { from: slice[0].ts, to: slice[slice.length - 1].ts, count: slice.length, peers: [...new Set(slice.map((e) => e.peer!))] };
  });
}

export interface DayRhythm {
  day: string;
  first: number;
  last: number;
  count: number;
  topSite?: string;
}

/** First and last activity of each day plus where the target mostly was. */
export function dailyRhythm(ds: Dataset, settings: Settings): DayRhythm[] {
  const map = new Map<string, DayRhythm & { _sites: Map<string, number> }>();
  for (const it of activeInteractions(ds, settings)) {
    const day = dayKey(it.ts);
    let r = map.get(day);
    if (!r) {
      r = { day, first: it.ts, last: it.ts, count: 0, _sites: new Map() };
      map.set(day, r);
    }
    r.count++;
    if (it.ts < r.first) r.first = it.ts;
    if (it.ts > r.last) r.last = it.ts;
    const cell = it.targetObs?.cell;
    if (cell) {
      const label = siteLabelOf(cell).label;
      r._sites.set(label, (r._sites.get(label) ?? 0) + 1);
    }
  }
  return [...map.values()]
    .map(({ _sites, ...r }) => {
      let top: string | undefined;
      let n = 0;
      for (const [k, v] of _sites) if (v > n) [top, n] = [k, v];
      return { ...r, topSite: top };
    })
    .sort((a, b) => a.day.localeCompare(b.day));
}
