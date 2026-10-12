import type { ZMode } from './types';

// All timestamps are wall-clock milliseconds: Date.UTC(<local fields>).
// Read them back exclusively through the helpers below.

export const HOUR = 3_600_000;
export const MINUTE = 60_000;
export const DAY = 24 * HOUR;
const THAI_OFFSET = 7 * HOUR;

function build(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0): number {
  if (y > 2400) y -= 543; // Buddhist Era year
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return NaN;
  const t = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  // Reject rollovers such as 31 Feb.
  const dt = new Date(t);
  if (dt.getUTCDate() !== d) return NaN;
  return t;
}

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,6}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const YMD = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const COMPACT = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;

/**
 * Parse a timestamp cell into wall-clock milliseconds (NaN when unreadable).
 *
 * Thai operator exports often append "Z" to clock times that are already
 * local; zMode 'local' (default) keeps the written clock time, zMode 'utc'
 * treats it as real UTC and converts to Thai time (+7 h). Explicit offsets
 * such as "+07:00" are always honoured.
 */
export function parseWallClock(value: string | null | undefined, zMode: ZMode = 'local'): number {
  if (value == null) return NaN;
  const s = String(value).trim();
  if (!s) return NaN;

  let m = ISO.exec(s);
  if (m) {
    const ms = m[7] ? Number(m[7].padEnd(3, '0').slice(0, 3)) : 0;
    let t = build(+m[1], +m[2], +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, ms);
    const zone = m[8];
    if (zone && !Number.isNaN(t)) {
      if (zone.toUpperCase() === 'Z') {
        if (zMode === 'utc') t += THAI_OFFSET;
      } else {
        const sign = zone[0] === '-' ? -1 : 1;
        const digits = zone.slice(1).replace(':', '');
        const off = sign * (Number(digits.slice(0, 2)) * HOUR + Number(digits.slice(2, 4)) * MINUTE);
        t = t - off + THAI_OFFSET;
      }
    }
    return t;
  }
  m = YMD.exec(s);
  if (m) return build(+m[1], +m[2], +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
  m = DMY.exec(s);
  if (m) return build(+m[3], +m[2], +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
  m = COMPACT.exec(s);
  if (m) return build(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);

  // Excel serial date number (days since 1899-12-30).
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 20000 && serial < 80000) return Math.round((serial - 25569) * DAY);
  }
  return NaN;
}

/** Combine separate date and time-of-day cells. */
export function parseDateAndClock(date: string | null | undefined, clock: string | null | undefined, zMode: ZMode = 'local'): number {
  if (!date) return NaN;
  if (!clock) return parseWallClock(date, zMode);
  const c = String(clock).trim();
  // Excel fraction of a day.
  if (/^0?\.\d+$/.test(c)) {
    const base = parseWallClock(date, zMode);
    return Number.isNaN(base) ? NaN : base + Math.round(Number(c) * DAY);
  }
  return parseWallClock(`${String(date).trim().split(/[ T]/)[0]} ${c}`, zMode);
}

const pad = (n: number) => String(n).padStart(2, '0');

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function hourOf(ts: number): number {
  return new Date(ts).getUTCHours();
}

/** 0 = Monday ... 6 = Sunday (Thai reports start the week on Monday). */
export function weekdayMon0(ts: number): number {
  return (new Date(ts).getUTCDay() + 6) % 7;
}

export function startOfDay(ts: number): number {
  return Math.floor(ts / DAY) * DAY;
}

export function isNight(ts: number, nightStart: number, nightEnd: number): boolean {
  const h = hourOf(ts);
  return nightStart > nightEnd ? h >= nightStart || h < nightEnd : h >= nightStart && h < nightEnd;
}

export type YearStyle = 'ce' | 'be';

export function fmtDate(ts: number | undefined, year: YearStyle = 'ce'): string {
  if (ts == null || Number.isNaN(ts)) return '-';
  const d = new Date(ts);
  const y = d.getUTCFullYear() + (year === 'be' ? 543 : 0);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${y}`;
}

export function fmtTime(ts: number | undefined): string {
  if (ts == null || Number.isNaN(ts)) return '-';
  const d = new Date(ts);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function fmtDateTime(ts: number | undefined, year: YearStyle = 'ce'): string {
  if (ts == null || Number.isNaN(ts)) return '-';
  return `${fmtDate(ts, year)} ${fmtTime(ts)}`;
}

/** ISO-like text for exports: 2026-08-01 09:15:30 */
export function isoText(ts: number | undefined): string {
  if (ts == null || Number.isNaN(ts)) return '';
  const d = new Date(ts);
  return `${dayKey(ts)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Seconds -> "1:02:03" (hours unbounded). */
export function fmtDuration(sec: number | undefined): string {
  if (sec == null || Number.isNaN(sec)) return '-';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}:${pad(m)}:${pad(r)}`;
}

/** Human span: 26.5 ชม. / 3.2 วัน */
export function fmtHours(ms: number): string {
  const h = ms / HOUR;
  if (h < 48) return `${h.toFixed(1)} ชม.`;
  return `${(h / 24).toFixed(1)} วัน`;
}
