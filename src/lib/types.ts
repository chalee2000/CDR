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

export interface DatasetMeta {
  format: FormatId;
  formatLabel: string;
  operator?: string;
  declaredPeriod?: string;
  sheets: SheetStat[];
  targetImsis: string[];
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
  yearStyle: 'ce',
  showBasemap: true,
};

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

export type FlatField =
  | 'time' | 'date' | 'clock' | 'end' | 'a' | 'b' | 'type' | 'direction' | 'duration'
  | 'imsi' | 'imei' | 'lac' | 'ci' | 'tac' | 'eci' | 'cellName' | 'site' | 'location'
  | 'tumbol' | 'amphur' | 'province' | 'region' | 'lat' | 'lon' | 'plmn';
