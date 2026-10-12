import type { Cell, FlatField, RawSheet } from '../types';
import { clean, toNumber } from '../util';

/** "START TIME" / "start_time" / "Start-Time" -> "START_TIME". */
export function normHeader(h: string | null | undefined): string {
  return String(h ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s\-./()]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Header aliases for flat (single-table) exports from any operator.
export const FIELD_ALIASES: Record<FlatField, string[]> = {
  time: ['START_DATETIME', 'START_TIME', 'STARTTIME', 'START_DATE_TIME', 'CALL_START', 'CALL_START_TIME', 'CALL_DATETIME', 'CALL_DATE_TIME', 'DATETIME', 'DATE_TIME', 'EVENT_TIME', 'EVENT_DATETIME', 'TIMESTAMP', 'วันเวลา', 'วันที่เวลา', 'วัน_เวลา', 'เวลาเริ่ม', 'เวลาเริ่มต้น'],
  date: ['DATE', 'CALL_DATE', 'START_DATE', 'EVENT_DATE', 'วันที่'],
  clock: ['TIME', 'CALL_TIME', 'EVENT_TIME_OF_DAY', 'เวลา'],
  end: ['END_DATETIME', 'END_TIME', 'CALL_END', 'CALL_END_TIME', 'STOP_TIME', 'เวลาสิ้นสุด'],
  a: ['A_NUMBER', 'A_NO', 'ANUMBER', 'A_PARTY', 'CALLING_NUMBER', 'CALLING_NO', 'CALLING', 'CALLER', 'CALLER_NUMBER', 'ORIG_NUMBER', 'ORIGINATING_NUMBER', 'SOURCE_NUMBER', 'MSISDN', 'SERVED_MSISDN', 'เบอร์ต้นทาง', 'หมายเลขต้นทาง', 'เลขหมายต้นทาง', 'หมายเลข_A'],
  b: ['B_NUMBER', 'B_NO', 'BNUMBER', 'B_PARTY', 'CALLED_NUMBER', 'CALLED_NO', 'CALLED', 'CALLEE', 'DEST_NUMBER', 'DESTINATION', 'DESTINATION_NUMBER', 'TERM_NUMBER', 'TERMINATING_NUMBER', 'OTHER_PARTY', 'OTHER_NUMBER', 'PARTNER_NUMBER', 'เบอร์ปลายทาง', 'หมายเลขปลายทาง', 'เลขหมายปลายทาง', 'คู่สาย', 'หมายเลข_B'],
  type: ['RECORD_TYPE', 'EVENT_TYPE', 'CALL_TYPE', 'TYPE', 'SERVICE_TYPE', 'USAGE_TYPE', 'CDR_TYPE', 'ประเภท', 'ประเภทการใช้งาน', 'ประเภทรายการ'],
  direction: ['DIRECTION', 'CALL_DIRECTION', 'ทิศทาง'],
  duration: ['DURATION', 'CALL_DURATION', 'DUR', 'DURATION_SEC', 'DURATION_S', 'CALL_DURATION_SEC', 'ระยะเวลา', 'ระยะเวลา_วินาที', 'วินาที'],
  imsi: ['IMSI'],
  imei: ['IMEI', 'IMEISV', 'IMEI_SV'],
  lac: ['LAC', 'LAC_ID'],
  ci: ['CI', 'CELL_ID', 'CELLID', 'CID'],
  tac: ['TAC'],
  eci: ['ECI', 'ECGI', 'E_CI', 'EUTRAN_CELL_ID'],
  cellName: ['CELL_NAME', 'CELLNAME'],
  site: ['SITE_NAME', 'SITE', 'SITENAME', 'BTS_NAME', 'BTS', 'CELL_SITE', 'NODE_NAME', 'ชื่อสถานี', 'ชื่อเสา', 'สถานีฐาน', 'ชื่อสถานีฐาน'],
  location: ['LOCATION_NAME', 'LOCATION', 'ADDRESS', 'SITE_ADDRESS', 'ที่ตั้ง', 'ที่อยู่เสา'],
  tumbol: ['TUMBOL', 'TUMBON', 'TAMBON', 'TAMBOL', 'SUBDISTRICT', 'SUB_DISTRICT', 'ตำบล', 'แขวง'],
  amphur: ['AMPHUR', 'AMPHOE', 'AMPUR', 'DISTRICT', 'อำเภอ', 'เขต'],
  province: ['PROVINCE', 'CHANGWAT', 'จังหวัด'],
  region: ['REGION', 'ภาค'],
  lat: ['LATITUDE', 'LAT', 'ละติจูด'],
  lon: ['LONGITUDE', 'LON', 'LNG', 'LONG', 'ลองจิจูด'],
  plmn: ['PLMN', 'PUBLIC_LAND_MOBILE_NETWORK', 'MCCMNC', 'MCC_MNC'],
};

const ALIAS_LOOKUP = new Map<string, FlatField>();
for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [FlatField, string[]][]) {
  for (const a of aliases) if (!ALIAS_LOOKUP.has(normHeader(a))) ALIAS_LOOKUP.set(normHeader(a), field);
}

export interface HeaderMatch {
  headerRow: number;
  headers: string[];
  columns: Partial<Record<FlatField, number>>;
}

/** Map header cells to canonical fields; the first column wins on clashes. */
export function mapHeaders(headers: (string | null)[]): Partial<Record<FlatField, number>> {
  const columns: Partial<Record<FlatField, number>> = {};
  headers.forEach((h, i) => {
    const field = ALIAS_LOOKUP.get(normHeader(h));
    if (field && columns[field] === undefined) columns[field] = i;
  });
  return columns;
}

/** Find the header row (operators sometimes put a title block above it). */
export function findHeader(sheet: RawSheet, maxScan = 15): HeaderMatch | undefined {
  let best: HeaderMatch | undefined;
  let bestScore = 0;
  const limit = Math.min(sheet.rows.length, maxScan);
  for (let r = 0; r < limit; r++) {
    const row = sheet.rows[r] ?? [];
    const columns = mapHeaders(row);
    const score = Object.keys(columns).length;
    if (score > bestScore) {
      bestScore = score;
      best = { headerRow: r, headers: row.map((h) => String(h ?? '')), columns };
    }
  }
  return best && bestScore >= 2 ? best : undefined;
}

/** Index of a header by exact (normalised) name, for operator-specific layouts. */
export function exactIndex(headers: (string | null)[]): (name: string) => number {
  const idx = new Map<string, number>();
  headers.forEach((h, i) => {
    const k = String(h ?? '').trim().toUpperCase();
    if (!idx.has(k)) idx.set(k, i);
  });
  return (name: string) => idx.get(name.trim().toUpperCase()) ?? -1;
}

const ADMIN_PREFIX = /^(อำเภอ|อ\.|จังหวัด|จ\.|ตำบล|ต\.)\s*/;

export function cleanAdmin(v: string | null | undefined): string | undefined {
  const s = clean(v);
  return s ? s.replace(ADMIN_PREFIX, '').trim() || undefined : undefined;
}

function nonZero(v: string | null | undefined): string | undefined {
  const s = clean(v);
  if (s === undefined || /^0+$/.test(s)) return undefined;
  return s;
}

export function parseCoord(v: string | null | undefined, kind: 'lat' | 'lon'): number | undefined {
  const n = toNumber(v);
  if (n === undefined || n === 0) return undefined;
  if (kind === 'lat' && (n < -90 || n > 90)) return undefined;
  if (kind === 'lon' && (n < -180 || n > 180)) return undefined;
  return Math.round(n * 1e6) / 1e6;
}

export interface CellFields {
  lac?: string | null;
  ci?: string | null;
  tac?: string | null;
  eci?: string | null;
  cellName?: string | null;
  site?: string | null;
  location?: string | null;
  tumbol?: string | null;
  amphur?: string | null;
  province?: string | null;
  region?: string | null;
  lat?: string | null;
  lon?: string | null;
}

/** Build a Cell from whichever identifiers the operator supplied. */
export function makeCell(f: CellFields): Cell | undefined {
  const eci = nonZero(f.eci);
  const lac = nonZero(f.lac);
  const ci = nonZero(f.ci);
  const tac = nonZero(f.tac);
  const cellName = clean(f.cellName);
  const siteName = clean(f.site);
  const lat = parseCoord(f.lat, 'lat');
  const lon = parseCoord(f.lon, 'lon');

  let key: string | undefined;
  let cellId: string | undefined;
  if (cellName) {
    key = `CELL:${cellName}`;
    cellId = cellName;
  } else if (eci) {
    key = `ECI:${eci}`;
    cellId = eci;
  } else if (ci) {
    key = `LAC-CI:${lac ?? ''}-${ci}`;
    cellId = lac ? `${lac}-${ci}` : ci;
  } else if (siteName) {
    key = `SITE:${siteName}`;
  } else if (lat !== undefined && lon !== undefined) {
    key = `LL:${lat},${lon}`;
  }
  if (!key) return undefined;

  const cell: Cell = { key };
  if (cellId) cell.cellId = cellId;
  if (lac) cell.lac = lac;
  if (ci) cell.ci = ci;
  if (tac) cell.tac = tac;
  if (eci) cell.eci = eci;
  if (siteName) cell.siteName = siteName;
  const location = clean(f.location);
  if (location) cell.locationName = location;
  const tumbol = cleanAdmin(f.tumbol);
  if (tumbol) cell.tumbol = tumbol;
  const amphur = cleanAdmin(f.amphur);
  if (amphur) cell.amphur = amphur;
  const province = cleanAdmin(f.province);
  if (province) cell.province = province;
  const region = clean(f.region);
  if (region) cell.region = region;
  if (lat !== undefined && lon !== undefined) {
    cell.lat = lat;
    cell.lon = lon;
  }
  return cell;
}

/** Key used to spot exact duplicate source rows. */
export function rowSignature(row: (string | null)[]): string {
  return row.map((c) => c ?? '').join('\u0001');
}
