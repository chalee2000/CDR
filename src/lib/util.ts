export function countBy<T>(items: Iterable<T>, key: (item: T) => string | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (k === undefined) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export function groupBy<T>(items: Iterable<T>, key: (item: T) => string | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (k === undefined) continue;
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

/** Most frequent key, ties broken by first appearance. */
export function mode<T>(items: Iterable<T>, key: (item: T) => string | undefined): string | undefined {
  let best: string | undefined;
  let bestN = 0;
  for (const [k, n] of countBy(items, key)) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

export function sum(values: Iterable<number | undefined>): number {
  let s = 0;
  for (const v of values) if (v != null && !Number.isNaN(v)) s += v;
  return s;
}

export function clean(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  if (!s || s === '-' || /^(nan|null|none|unknow|unknown|n\/a|tbd)$/i.test(s)) return undefined;
  return s;
}

export function toNumber(value: string | null | undefined): number | undefined {
  const s = clean(value);
  if (s === undefined) return undefined;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** Great-circle distance in kilometres. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtInt(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return '-';
  return n.toLocaleString('th-TH');
}

export function pct(part: number, whole: number): string {
  if (!whole) return '0%';
  return `${((part / whole) * 100).toFixed(1)}%`;
}
