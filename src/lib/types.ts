// Canonical data model shared by every parser, analysis module and view.
// Timestamps are "wall-clock" epoch milliseconds: the UTC fields of the Date
// hold Thai local time exactly as written in the source file, so analysis
// never depends on the browser's time zone. Always read them back with the
// helpers in time.ts (getUTC*), never with local-time getters.

export type Service = 'call' | 'sms' | 'data' | 'wifi' | 'other';
export type Direction = 'out' | 'in' | 'fwd' | 'na';
export type PeerKind = 'mobile' | 'landline' | 'intl' | 'shortcode' | 'alpha' | 'other' | 'none';
/** 'VOICE+IMS' = one call logged in both the circuit-switched and the VoLTE sheet. */
export type SourceKind = 'FLAT' | 'VOICE' | 'IMS' | 'VOICE+IMS' | 'SMS' | 'DATA' | 'WIFI';
export type FormatId = 'ais' | 'dtac' | 'flat';
export type CoordSource = 'file' | 'import' | 'approx';

export interface Cell {
  /** Stable key within a dataset, e.g. "ECI:150900141" or "CELL:SIM0001E_1NB01_S01" (fictitious examples). */
  key: string;
  cellId?: string;
  lac?: string;
  ci?: string;
  tac?: string;
  eci?: string;
  siteName?: string;
  locationName?: string;
  tumbol?: string;
  amphur?: string;
  province?: string;
  region?: string;
  lat?: number;
  lon?: number;
}

/** Device + network position of ONE handset at the moment of an interaction. */
export interface Observation {
  imsi?: string;
  imei?: string;
  cell?: Cell;
}

/** One communication (call / SMS) or session (data / Wi-Fi) of the target. */
export interface Interaction {
  id: number;
  ts: number;
  endTs?: number;
  durationSec?: number;
  service: Service;
  direction: Direction;
  /** Calls only: false = unanswered / failed attempt. */
  answered?: boolean;
  /** Normalised other-party key (see phone.ts). Undefined for data/Wi-Fi. */
  peer?: string;
  peerRaw?: string;
  peerKind: PeerKind;
  peerCountry?: string;
  rawType: string;
  source: SourceKind;
  /** Position/device of the TARGET handset, when the operator recorded it. */
  targetObs?: Observation;
  /** Position/device of the OTHER party, when the file includes their record (DTAC on-net). */
  peerObs?: Observation;
  /**
   * The peer-side cell was taken from an IMS row that carries the target's
   * IMSI but no IMEI: such rows record a position away from the target's
   * handset (the far end of the call), so it is not counted as the target's.
   */
  peerCellInferred?: boolean;
  bytes?: number;
  ip?: string;
  /** Source rows as "Sheet!row" (1-based Excel row numbers, header = row 1). */
  rowRefs: string[];
  /** True when the source row is an exact copy of an earlier row. */
  dupOfPrev?: boolean;
  /** Source-specific details worth showing (Wi-Fi access point, IMS access network...). */
  extra?: Record<string, string>;
}

export interface SheetStat {
  sheet: string;
  rows: number;
  used: number;
  skippedNoTime: number;
  peerOwned: number;
  noLocation: number;
  unknownTypes: Record<string, number>;
  duplicates: number;
}

/** Whose handset a SIM seen in the file belongs to, and so whose positions its rows carry. */
export interface ImsiCheck {
  /** '' for rows without an IMSI (owner taken from the event role). */
  imsi: string;
  owner: 'target' | 'peer';
  /** The number using this SIM: the target, or the party on the handset's side of its events. */
  number?: string;
  /**
   * data: in the DATA sheet (only the target's sessions); main: most often on
   * the target's side; sim-change: on the target's side, never in use while
   * the target's other SIMs are, and in a handset (IMEI) the target's SIM
   * also used; review: like sim-change but in other handsets only, so kept
   * as a peer for the investigator to check; other: another handset; role:
   * no IMSI; manual: set by the user (see auto).
   */
  basis: 'data' | 'main' | 'sim-change' | 'review' | 'other' | 'role' | 'manual';
  /** What the automatic rules decided (differs from owner only when set by hand). */
  auto: 'target' | 'peer';
  /** Seen in the DATA sheet, which by subpoena holds only the target's sessions. */
  inData: boolean;
  /** Handsets (IMEI, first 14 digits) seen with this SIM, most used first. */
  imeis: string[];
  rows: number;
  withCell: number;
  firstTs: number;
  lastTs: number;
}

/** Owners of SIMs set by the user, by IMSI; they override the automatic rules. */
export type ImsiOwners = Record<string, 'target' | 'peer'>;

export interface DatasetMeta {
  format: FormatId;
  formatLabel: string;
  operator?: string;
  declaredPeriod?: string;
  sheets: SheetStat[];
  targetImsis: string[];
  /** True/DTAC: every SIM in the file and whether its positions count as the target's. */
  imsiCheck?: ImsiCheck[];
  /** Data limitations to show next to the analysis (Thai). */
  notes: string[];
  /** How "Z"-suffixed timestamps were interpreted when parsing. */
  zMode: ZMode;
  hasCoordinates: boolean;
}

export interface Dataset {
  id: string;
  fileName: string;
  target: string;
  label: string;
  /** Categorical palette slot (0-based); colour is resolved per theme. */
  slot: number;
  interactions: Interaction[];
  meta: DatasetMeta;
}

/** 'local' = clock time as written (default); 'utc' = treat Z as UTC and add 7 h. */
export type ZMode = 'local' | 'utc';

export interface Settings {
  zMode: ZMode;
  /** Night window: hour >= nightStart OR hour < nightEnd. */
  nightStart: number;
  nightEnd: number;
  dedupeExact: boolean;
  includeServiceNumbers: boolean;
  coLocationMinutes: number;
  coLocationKm: number;
  relayMinutes: number;
  silenceHours: number;
  burstCount: number;
  burstMinutes: number;
  /** Count SMS as well as calls when looking for call bursts. */
  burstSms: boolean;
  yearStyle: 'ce' | 'be';
  showBasemap: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  zMode: 'local',
  nightStart: 20,
  nightEnd: 6,
  dedupeExact: false,
  includeServiceNumbers: false,
  coLocationMinutes: 30,
  coLocationKm: 1,
  relayMinutes: 30,
  silenceHours: 24,
  burstCount: 5,
  burstMinutes: 10,
  burstSms: true,
  yearStyle: 'ce',
  showBasemap: true,
};

type NumericSetting = 'nightStart' | 'nightEnd' | 'coLocationMinutes' | 'coLocationKm' | 'relayMinutes' | 'silenceHours' | 'burstCount' | 'burstMinutes';

/** Allowed range of each numeric setting (the inputs and the file readers share it). */
export const SETTING_LIMITS: Record<NumericSetting, { min: number; max: number; int?: boolean }> = {
  nightStart: { min: 0, max: 23, int: true },
  nightEnd: { min: 0, max: 23, int: true },
  coLocationMinutes: { min: 1, max: 720 },
  coLocationKm: { min: 0.1, max: 50 },
  relayMinutes: { min: 1, max: 1440 },
  silenceHours: { min: 1, max: 720 },
  burstCount: { min: 2, max: 100, int: true },
  burstMinutes: { min: 1, max: 240 },
};

const ENUM_SETTINGS = {
  zMode: ['local', 'utc'],
  yearStyle: ['ce', 'be'],
} as const;

/** Settings from untrusted input (browser storage, a backup file): unknown keys and bad values fall back to the defaults. */
export function cleanSettings(input: unknown): Settings {
  const src = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  // Own properties only: nothing inherited through the prototype counts.
  const o = Object.fromEntries(Object.entries(src));
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const [key, { min, max, int }] of Object.entries(SETTING_LIMITS) as [NumericSetting, (typeof SETTING_LIMITS)[NumericSetting]][]) {
    const v = o[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max && (!int || Number.isInteger(v))) out[key] = v;
  }
  for (const key of ['dedupeExact', 'includeServiceNumbers', 'burstSms', 'showBasemap'] as const) {
    if (typeof o[key] === 'boolean') out[key] = o[key];
  }
  if (ENUM_SETTINGS.zMode.includes(o.zMode as ZMode)) out.zMode = o.zMode as ZMode;
  if (ENUM_SETTINGS.yearStyle.includes(o.yearStyle as Settings['yearStyle'])) out.yearStyle = o.yearStyle as Settings['yearStyle'];
  return out;
}

/** Raw workbook as read from disk: every cell already converted to string | null. */
export interface RawSheet {
  name: string;
  rows: (string | null)[][];
}

export interface RawWorkbook {
  fileName: string;
  sheets: RawSheet[];
}

/** User-chosen column mapping for files the auto-detector cannot read. */
export interface ColumnMapping {
  sheet: string;
  headerRow: number;
  columns: Partial<Record<FlatField, number>>;
  target?: string;
}

export const FLAT_FIELDS = [
  'time', 'date', 'clock', 'end', 'a', 'b', 'type', 'direction', 'duration',
  'imsi', 'imei', 'lac', 'ci', 'tac', 'eci', 'cellName', 'site', 'location',
  'tumbol', 'amphur', 'province', 'region', 'lat', 'lon', 'plmn',
] as const;

export type FlatField = (typeof FLAT_FIELDS)[number];
