import centroids from '../../assets/province-centroids.json';
import gazetteer from '../../assets/th-area-centroids.json';
import { activeInteractions } from '../dataset';
import { dayKey, DAY, hourOf, isNight, weekdayMon0 } from '../time';
import type { ApproxLevel, Cell, CoordSource, Dataset, Interaction, Settings } from '../types';

const CENTROIDS = centroids as unknown as Record<string, [number, number]>;
/** Province → district → subdistrict → point; '' under a district is the district's own point. */
const AREAS = (gazetteer as unknown as { areas: Record<string, Record<string, Record<string, [number, number]>>> }).areas;

/** Area names as the gazetteer keys them: no "จังหวัด/อำเภอ/ตำบล/เขต/แขวง" prefix, no spaces (see scripts/build-gazetteer.mjs). */
export function areaKey(v: string | undefined): string {
  return String(v ?? '')
    .trim()
    .replace(/^(จังหวัด|จ\.|กิ่งอำเภอ|อำเภอ|อ\.|เขต|ตำบล|ต\.|แขวง)\s*/, '')
    .replace(/\s+/g, '');
}

/** Lookup by a name from the file: own entries only, never Object.prototype's. */
function own<T>(table: Record<string, T> | undefined, name: string): T | undefined {
  return table && Object.hasOwn(table, name) ? table[name] : undefined;
}

/** The best known point for a cell's area: its subdistrict, else its district, else its province. */
export function areaPoint(cell: Pick<Cell, 'province' | 'amphur' | 'tumbol'>): { at: [number, number]; level: ApproxLevel; key: string } | undefined {
  const prov = normalizeProvince(areaKey(cell.province) || undefined);
  if (!prov) return undefined;
  const districts = own(AREAS, prov);
  // "เมือง" alone names the capital district: เมือง + province.
  const named = areaKey(cell.amphur);
  const amphur = named === 'เมือง' && !own(districts, named) ? `เมือง${prov}` : named;
  const tambons = own(districts, amphur);
  if (tambons) {
    const tumbol = areaKey(cell.tumbol);
    const t = tumbol ? own(tambons, tumbol) : undefined;
    if (t) return { at: t, level: 'tumbol', key: `${prov}|${amphur}|${tumbol}` };
    const d = own(tambons, '');
    if (d) return { at: d, level: 'amphur', key: `${prov}|${amphur}` };
  }
  const c = own(CENTROIDS, prov);
  return c ? { at: c, level: 'province', key: prov } : undefined;
}

export interface SiteLabel {
  key: string;
  label: string;
}

/** Sector cells of one tower collapse into one site: name + district + province. */
export function siteLabelOf(cell: Cell): SiteLabel {
  const label = cell.siteName ?? cell.locationName ?? cell.cellId ?? cell.key.replace(/^[A-Z-]+:/, '');
  return { key: [label, cell.amphur ?? '', cell.province ?? ''].join('|'), label };
}

export function normalizeProvince(p: string | undefined): string | undefined {
  if (!p) return undefined;
  if (p.startsWith('กรุงเทพ') || /^bangkok$/i.test(p)) return 'กรุงเทพมหานคร';
  return p;
}

export function provinceCentroid(p: string | undefined): [number, number] | undefined {
  const n = normalizeProvince(p);
  return n ? own(CENTROIDS, n) : undefined;
}

/** Coordinates the user imported for cells that have none in the CDR. */
export type ImportedCoords = Map<string, [number, number]>;

export function importKeysFor(cell: Cell): string[] {
  const keys: string[] = [];
  if (cell.eci) keys.push(`ECI:${cell.eci}`);
  if (cell.cellId) keys.push(`CELL:${cell.cellId.toUpperCase()}`);
  if (cell.ci) keys.push(`CI:${cell.lac ?? ''}-${cell.ci}`, `CI:${cell.ci}`);
  if (cell.siteName) keys.push(`SITE:${cell.siteName.toUpperCase()}`);
  if (cell.locationName) keys.push(`SITE:${cell.locationName.toUpperCase()}`);
  return keys;
}

export interface Coord {
  lat: number;
  lon: number;
  source: CoordSource;
  /** For approximate positions: the area whose point was used. */
  level?: ApproxLevel;
}

/** Spread of the spiral that keeps several sites of one area apart, in degrees. */
const SPREAD: Record<ApproxLevel, number> = { tumbol: 0.0025, amphur: 0.006, province: 0.03 };

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Resolves a position for every site: coordinates from the file, then from
 * an imported cell list, then a schematic spot at the site's subdistrict
 * (else district, else province) point, on a small deterministic spiral so
 * sites never stack; always labelled approximate.
 */
export class CoordResolver {
  private approx = new Map<string, Coord>();
  private perArea = new Map<string, number>();
  constructor(private imported?: ImportedCoords) {}

  resolve(cell: Cell): Coord | undefined {
    if (cell.lat !== undefined && cell.lon !== undefined) return { lat: cell.lat, lon: cell.lon, source: 'file' };
    if (this.imported) {
      for (const k of importKeysFor(cell)) {
        const hit = this.imported.get(k);
        if (hit) return { lat: hit[0], lon: hit[1], source: 'import' };
      }
    }
    const site = siteLabelOf(cell).key;
    const cached = this.approx.get(site);
    if (cached) return cached;
    const area = areaPoint(cell);
    if (!area) return undefined;
    const idx = this.perArea.get(area.key) ?? 0;
    this.perArea.set(area.key, idx + 1);
    const r = SPREAD[area.level] * Math.sqrt(idx);
    const coord: Coord = {
      lat: area.at[0] + r * Math.cos(idx * GOLDEN_ANGLE),
      lon: area.at[1] + r * Math.sin(idx * GOLDEN_ANGLE),
      source: 'approx',
      level: area.level,
    };
    this.approx.set(site, coord);
    return coord;
  }
}

export interface SiteStat {
  key: string;
  label: string;
  siteName?: string;
  locationName?: string;
  tumbol?: string;
  amphur?: string;
  province?: string;
  coord?: Coord;
  cells: string[];
  count: number;
  commCount: number;
  dataCount: number;
  days: number;
  firstTs: number;
  lastTs: number;
  dayCount: number;
  nightCount: number;
  share: number;
}

function targetLocated(ds: Dataset, settings: Settings): (Interaction & { targetObs: { cell: Cell } })[] {
  return activeInteractions(ds, settings).filter(
    (it): it is Interaction & { targetObs: { cell: Cell } } => !!it.targetObs?.cell && it.source !== 'WIFI',
  );
}

export function siteStats(ds: Dataset, settings: Settings, resolver?: CoordResolver): SiteStat[] {
  const located = targetLocated(ds, settings);
  const map = new Map<string, SiteStat & { _days: Set<string>; _cells: Set<string> }>();
  for (const it of located) {
    const cell = it.targetObs.cell;
    const { key, label } = siteLabelOf(cell);
    let s = map.get(key);
    if (!s) {
      s = {
        key,
        label,
        siteName: cell.siteName,
        locationName: cell.locationName,
        tumbol: cell.tumbol,
        amphur: cell.amphur,
        province: cell.province,
        coord: resolver?.resolve(cell),
        cells: [],
        count: 0,
        commCount: 0,
        dataCount: 0,
        days: 0,
        firstTs: it.ts,
        lastTs: it.ts,
        dayCount: 0,
        nightCount: 0,
        share: 0,
        _days: new Set(),
        _cells: new Set(),
      };
      map.set(key, s);
    }
    s.count++;
    if (it.service === 'data') s.dataCount++;
    else s.commCount++;
    if (it.ts < s.firstTs) s.firstTs = it.ts;
    if (it.ts > s.lastTs) s.lastTs = it.ts;
    if (isNight(it.ts, settings.nightStart, settings.nightEnd)) s.nightCount++;
    else s.dayCount++;
    s._days.add(dayKey(it.ts));
    s._cells.add(cell.cellId ?? cell.key);
  }
  const total = located.length || 1;
  return [...map.values()]
    .map(({ _days, _cells, ...s }) => ({ ...s, days: _days.size, cells: [..._cells], share: s.count / total }))
    .sort((a, b) => b.count - a.count);
}

export interface PlaceCandidate {
  site: SiteStat;
  /** Distinct nights (home) or weekdays (work) the target was seen there. */
  support: number;
  /** All nights / weekdays with any located observation. */
  outOf: number;
}

/**
 * Night = the configured night window; activity after midnight counts toward
 * the previous evening. Work = Mon–Fri 09:00–16:59. Both are candidates only.
 */
export function homeWorkCandidates(ds: Dataset, settings: Settings, sites: SiteStat[]): { home?: PlaceCandidate; work?: PlaceCandidate } {
  const located = targetLocated(ds, settings);
  const bySite = new Map(sites.map((s) => [s.key, s]));
  const nights = new Map<string, Set<string>>();
  const allNights = new Set<string>();
  const workdays = new Map<string, Set<string>>();
  const allWorkdays = new Set<string>();
  for (const it of located) {
    const key = siteLabelOf(it.targetObs.cell).key;
    const h = hourOf(it.ts);
    if (isNight(it.ts, settings.nightStart, settings.nightEnd)) {
      const night = dayKey(h < settings.nightEnd ? it.ts - DAY : it.ts);
      allNights.add(night);
      if (!nights.has(key)) nights.set(key, new Set());
      nights.get(key)!.add(night);
    }
    if (weekdayMon0(it.ts) < 5 && h >= 9 && h < 17) {
      const d = dayKey(it.ts);
      allWorkdays.add(d);
      if (!workdays.has(key)) workdays.set(key, new Set());
      workdays.get(key)!.add(d);
    }
  }
  const best = (m: Map<string, Set<string>>, outOf: number): PlaceCandidate | undefined => {
    let top: PlaceCandidate | undefined;
    for (const [key, set] of m) {
      const site = bySite.get(key);
      if (!site) continue;
      if (!top || set.size > top.support) top = { site, support: set.size, outOf };
    }
    return top && top.support >= 2 ? top : undefined;
  };
  return { home: best(nights, allNights.size), work: best(workdays, allWorkdays.size) };
}

export type AreaLevel = 'site' | 'amphur' | 'province';

export interface Stay {
  area: string;
  from: number;
  to: number;
  count: number;
  province?: string;
  amphur?: string;
}

function areaOf(cell: Cell, level: AreaLevel): string | undefined {
  if (level === 'province') return normalizeProvince(cell.province);
  if (level === 'amphur') return cell.amphur ? `${cell.amphur}${cell.province ? `, ${cell.province}` : ''}` : undefined;
  return siteLabelOf(cell).label;
}

/** Consecutive observations in the same area collapsed into one stay. */
export function stays(ds: Dataset, settings: Settings, level: AreaLevel): Stay[] {
  const out: Stay[] = [];
  for (const it of targetLocated(ds, settings)) {
    const area = areaOf(it.targetObs.cell, level);
    if (!area) continue;
    const last = out[out.length - 1];
    if (last && last.area === area) {
      last.to = it.ts;
      last.count++;
    } else {
      out.push({ area, from: it.ts, to: it.ts, count: 1, province: normalizeProvince(it.targetObs.cell.province), amphur: it.targetObs.cell.amphur });
    }
  }
  return out;
}

export interface PathPoint {
  ts: number;
  lat: number;
  lon: number;
  label: string;
  source: CoordSource;
  count: number;
}

/** Ordered positions of the target for the map path (same-site runs collapsed). */
export function pathPoints(ds: Dataset, settings: Settings, resolver: CoordResolver, day?: string): PathPoint[] {
  const out: PathPoint[] = [];
  for (const it of targetLocated(ds, settings)) {
    if (day && dayKey(it.ts) !== day) continue;
    const c = resolver.resolve(it.targetObs.cell);
    if (!c) continue;
    const label = siteLabelOf(it.targetObs.cell).label;
    const last = out[out.length - 1];
    if (last && last.lat === c.lat && last.lon === c.lon) {
      last.count++;
      continue;
    }
    out.push({ ts: it.ts, lat: c.lat, lon: c.lon, label, source: c.source, count: 1 });
  }
  return out;
}

export function locatedDays(ds: Dataset, settings: Settings): string[] {
  return [...new Set(targetLocated(ds, settings).map((it) => dayKey(it.ts)))].sort();
}

/** A cell where the file places the OTHER party of a target's communication. */
export interface PeerSite {
  key: string;
  label: string;
  tumbol?: string;
  amphur?: string;
  province?: string;
  coord?: Coord;
  count: number;
  /** Of which inferred from the target's IMS rows without an IMEI. */
  inferred: number;
  /** Parties seen at this cell, most frequent first. */
  peers: { peer: string; count: number }[];
  firstTs: number;
  lastTs: number;
}

/**
 * Positions that are NOT the target's: the peer's own rows (another SIM on
 * the same network) and the far end recorded in IMS rows without an IMEI.
 */
export function peerSites(ds: Dataset, settings: Settings, resolver?: CoordResolver): PeerSite[] {
  const map = new Map<string, PeerSite & { _peers: Map<string, number> }>();
  for (const it of activeInteractions(ds, settings)) {
    const cell = it.peerObs?.cell;
    if (!cell) continue;
    const { key, label } = siteLabelOf(cell);
    let s = map.get(key);
    if (!s) {
      s = { key, label, tumbol: cell.tumbol, amphur: cell.amphur, province: cell.province, coord: resolver?.resolve(cell), count: 0, inferred: 0, peers: [], firstTs: it.ts, lastTs: it.ts, _peers: new Map() };
      map.set(key, s);
    }
    s.count++;
    if (it.peerCellInferred) s.inferred++;
    if (it.peer) s._peers.set(it.peer, (s._peers.get(it.peer) ?? 0) + 1);
    s.firstTs = Math.min(s.firstTs, it.ts);
    s.lastTs = Math.max(s.lastTs, it.ts);
  }
  return [...map.values()]
    .map(({ _peers, ...s }) => ({ ...s, peers: [..._peers].map(([peer, count]) => ({ peer, count })).sort((a, b) => b.count - a.count) }))
    .sort((a, b) => b.count - a.count);
}
