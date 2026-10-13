/**
 * Backup files (.cdrbak): the whole working session in one file the user
 * saves on purpose — the imported CDR workbooks (raw cells as read), column
 * mappings, target aliases and colours, person profiles, imported cell
 * coordinates and the analysis settings — optionally protected by a password.
 *
 * Layout: "CDRBAK" 0x00, a container version byte, the header length
 * (uint32 LE), the header JSON, then the payload. The payload is
 * gzip-compressed NDJSON, one record per line, so neither side ever builds
 * one giant string. With a password it is sealed with AES-GCM under a
 * PBKDF2-SHA256 key, and every byte before the payload is the additional
 * data, so the header cannot be altered unnoticed. The header holds nothing
 * from the CDR files.
 */

import { cleanProfile, cleanText, MAX_PROFILES, type PersonProfile } from './profiles';
import { cleanSettings, FLAT_FIELDS, type ColumnMapping, type FlatField, type RawSheet, type Settings } from './types';

export const BACKUP_FORMAT = 'cdr-analyzer/backup';
export const BACKUP_VERSION = 1;
export const BACKUP_EXT = '.cdrbak';
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSWORD_LENGTH = 8;

const SIGNATURE = [0x43, 0x44, 0x52, 0x42, 0x41, 0x4b, 0x00]; // "CDRBAK\0"
const CONTAINER_VERSION = 1;
const PREFIX = SIGNATURE.length + 1 + 4;
const MAX_HEADER_BYTES = 64 * 1024;
const ROWS_PER_RECORD = 1000;
const RECORD_CHARS = 4 * 1024 * 1024;
const COORDS_PER_RECORD = 5000;
// Limits for files that may come from elsewhere: far above any real case,
// low enough that a crafted file cannot exhaust the page.
const MAX_LINE_CHARS = 128 * 1024 * 1024;
const MAX_FILES = 500;
const MAX_SHEETS = 256;
const MAX_ROWS = 5_000_000;
const MAX_ROW_CELLS = 16_384;
const MAX_CELL_CHARS = 1_000_000;
const MAX_TARGETS = 1000;
const MAX_COORDS = 2_000_000;
const MAX_SEALED_BYTES = 1024 ** 3;
const MIN_ITERATIONS = 1_000;
const MAX_ITERATIONS = 10_000_000;

type Row = (string | null)[];

export interface BackupTarget {
  /** The target number as the parser found it ('' when the file had none). */
  target: string;
  /** Colour slot. */
  slot: number;
  /** Alias, when the user gave one. */
  label?: string;
}

export interface BackupFile {
  fileName: string;
  sheets: RawSheet[];
  mapping?: ColumnMapping;
  targets: BackupTarget[];
}

export interface BackupCoords {
  name: string;
  entries: [key: string, lat: number, lon: number][];
}

/** Everything a backup holds. */
export interface SessionSnapshot {
  settings: Settings;
  files: BackupFile[];
  profiles: PersonProfile[];
  coords?: BackupCoords;
}

export interface BackupEncryption {
  cipher: 'AES-GCM';
  kdf: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  salt: string;
  iv: string;
}

export interface BackupHeader {
  format: typeof BACKUP_FORMAT;
  version: number;
  /** ISO time the backup was made ('' when the file does not say). */
  savedAt: string;
  compression: 'gzip';
  encryption: BackupEncryption | null;
}

export type BackupErrorCode = 'not-backup' | 'newer' | 'password' | 'corrupt' | 'too-large' | 'unsupported';

const MESSAGES: Record<BackupErrorCode, string> = {
  'not-backup': 'ไฟล์นี้ไม่ใช่ไฟล์สำรองของ CDR Analyzer',
  newer: 'ไฟล์สำรองนี้มาจากแอปรุ่นใหม่กว่า กรุณาใช้แอปรุ่นล่าสุด',
  password: 'รหัสผ่านไม่ถูกต้อง (หรือไฟล์ถูกแก้ไขหลังบันทึก)',
  corrupt: 'ไฟล์สำรองเสียหายหรือไม่ครบ',
  'too-large': 'ไฟล์สำรองใหญ่เกินกว่าที่แอปจะเปิดได้',
  unsupported: 'เบราว์เซอร์นี้ไม่รองรับการบีบอัดหรือเข้ารหัสที่ไฟล์สำรองใช้ กรุณาใช้ Chrome, Edge หรือ Firefox รุ่นล่าสุด',
};

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  constructor(code: BackupErrorCode) {
    super(MESSAGES[code]);
    this.name = 'BackupError';
    this.code = code;
  }
}

export function canCompress(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

/** Web Crypto exists only in a secure context (https, localhost or a local file). */
export function canEncrypt(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle?.deriveKey === 'function';
}

// ------------------------------------------------------------------ writing

type BackupRecord =
  | { t: 'settings'; settings: Settings }
  | { t: 'file'; i: number; fileName: string; mapping?: ColumnMapping; sheets: { name: string; rows: number }[]; targets: BackupTarget[] }
  | { t: 'rows'; i: number; s: number; rows: Row[] }
  | { t: 'profile'; p: PersonProfile }
  | { t: 'coords'; name: string; entries: BackupCoords['entries'] }
  | { t: 'end'; files: number; rows: number; profiles: number; coords: number };

function* records(s: SessionSnapshot): Generator<BackupRecord> {
  yield { t: 'settings', settings: s.settings };
  let total = 0;
  for (const [i, f] of s.files.entries()) {
    yield { t: 'file', i, fileName: f.fileName, mapping: f.mapping, sheets: f.sheets.map((sh) => ({ name: sh.name, rows: sh.rows.length })), targets: f.targets };
    for (const [si, sh] of f.sheets.entries()) {
      let rows: Row[] = [];
      let chars = 0;
      for (const row of sh.rows) {
        rows.push(row);
        for (const c of row) chars += (c?.length ?? 0) + 3;
        if (rows.length >= ROWS_PER_RECORD || chars >= RECORD_CHARS) {
          yield { t: 'rows', i, s: si, rows };
          rows = [];
          chars = 0;
        }
      }
      if (rows.length) yield { t: 'rows', i, s: si, rows };
      total += sh.rows.length;
    }
  }
  for (const p of s.profiles) yield { t: 'profile', p };
  const coords = s.coords;
  if (coords) {
    // At least one record, so an imported file without usable rows keeps its name.
    for (let k = 0; k === 0 || k < coords.entries.length; k += COORDS_PER_RECORD) {
      yield { t: 'coords', name: coords.name, entries: coords.entries.slice(k, k + COORDS_PER_RECORD) };
    }
  }
  yield { t: 'end', files: s.files.length, rows: total, profiles: s.profiles.length, coords: coords?.entries.length ?? 0 };
}

const encoder = new TextEncoder();

async function gzipRecords(list: Iterable<BackupRecord>): Promise<Blob> {
  const gz = new CompressionStream('gzip');
  const out = new Response(gz.readable).blob();
  out.catch(() => undefined); // a failure surfaces from the writer below
  const writer = gz.writable.getWriter();
  try {
    let batch = '';
    for (const r of list) {
      batch += `${JSON.stringify(r)}\n`;
      if (batch.length >= 1 << 20) {
        await writer.write(encoder.encode(batch));
        batch = '';
      }
    }
    if (batch) await writer.write(encoder.encode(batch));
    await writer.close();
  } catch (e) {
    writer.abort(e).catch(() => undefined);
    throw e;
  }
  return out;
}

function headerBytes(header: BackupHeader): Uint8Array<ArrayBuffer> {
  const json = encoder.encode(JSON.stringify(header));
  const out = new Uint8Array(PREFIX + json.length);
  out.set(SIGNATURE, 0);
  out[SIGNATURE.length] = CONTAINER_VERSION;
  new DataView(out.buffer).setUint32(SIGNATURE.length + 1, json.length, true);
  out.set(json, PREFIX);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number, use: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, [use]);
}

export interface WriteOptions {
  /** Seal the file with this password; without one anyone who has the file can read it. */
  password?: string;
  savedAt?: Date;
  /** PBKDF2 rounds (tests lower it to stay fast). */
  iterations?: number;
}

export async function writeBackup(s: SessionSnapshot, opts: WriteOptions = {}): Promise<Blob> {
  if (!canCompress() || (opts.password && !canEncrypt())) throw new BackupError('unsupported');
  const header: BackupHeader = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    savedAt: (opts.savedAt ?? new Date()).toISOString(),
    compression: 'gzip',
    encryption: null,
  };
  const payload = await gzipRecords(records(s));
  if (!opts.password) return new Blob([headerBytes(header), payload], { type: 'application/octet-stream' });
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = opts.iterations ?? PBKDF2_ITERATIONS;
  header.encryption = { cipher: 'AES-GCM', kdf: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt), iv: toBase64(iv) };
  const prefix = headerBytes(header);
  const key = await deriveKey(opts.password, salt, iterations, 'encrypt');
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: prefix }, key, await payload.arrayBuffer());
  return new Blob([prefix, sealed], { type: 'application/octet-stream' });
}

// ------------------------------------------------------------------ reading

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/** The first bytes of a backup file, whatever its container version. */
export function hasBackupSignature(head: Uint8Array): boolean {
  return head.length > SIGNATURE.length && SIGNATURE.every((b, i) => head[i] === b);
}

/** A picked or dropped file that should be restored rather than imported as CDR. */
export async function isBackupFile(file: Blob & { name?: string }): Promise<boolean> {
  if (file.name?.toLowerCase().endsWith(BACKUP_EXT)) return true;
  return hasBackupSignature(new Uint8Array(await file.slice(0, SIGNATURE.length + 1).arrayBuffer()));
}

function checkHeader(raw: unknown): BackupHeader {
  if (!isObject(raw) || raw.format !== BACKUP_FORMAT) throw new BackupError('not-backup');
  if (!isCount(raw.version) || raw.version < 1) throw new BackupError('corrupt');
  if (raw.version > BACKUP_VERSION) throw new BackupError('newer');
  if (raw.compression !== 'gzip') throw new BackupError('corrupt');
  let encryption: BackupEncryption | null = null;
  if (raw.encryption != null) {
    const e: Record<string, unknown> = isObject(raw.encryption) ? raw.encryption : {};
    if (
      e.cipher !== 'AES-GCM' ||
      e.kdf !== 'PBKDF2' ||
      e.hash !== 'SHA-256' ||
      !isCount(e.iterations) ||
      e.iterations < MIN_ITERATIONS ||
      e.iterations > MAX_ITERATIONS ||
      typeof e.salt !== 'string' ||
      typeof e.iv !== 'string'
    ) {
      throw new BackupError('corrupt');
    }
    encryption = { cipher: 'AES-GCM', kdf: 'PBKDF2', hash: 'SHA-256', iterations: e.iterations, salt: e.salt, iv: e.iv };
  }
  const savedAt = typeof raw.savedAt === 'string' && !Number.isNaN(Date.parse(raw.savedAt)) ? raw.savedAt : '';
  return { format: BACKUP_FORMAT, version: raw.version, savedAt, compression: 'gzip', encryption };
}

interface Opened {
  header: BackupHeader;
  prefix: Uint8Array<ArrayBuffer>;
  payload: Blob;
}

async function open(file: Blob): Promise<Opened> {
  const head = new Uint8Array(await file.slice(0, PREFIX).arrayBuffer());
  if (head.length < PREFIX || !hasBackupSignature(head)) throw new BackupError('not-backup');
  const container = head[SIGNATURE.length];
  if (container > CONTAINER_VERSION) throw new BackupError('newer');
  if (container < 1) throw new BackupError('corrupt');
  const size = new DataView(head.buffer).getUint32(SIGNATURE.length + 1, true);
  if (size === 0 || size > MAX_HEADER_BYTES || PREFIX + size > file.size) throw new BackupError('corrupt');
  const prefix = new Uint8Array(await file.slice(0, PREFIX + size).arrayBuffer());
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(prefix.subarray(PREFIX)));
  } catch {
    throw new BackupError('corrupt');
  }
  return { header: checkHeader(raw), prefix, payload: file.slice(PREFIX + size) };
}

/** The header alone: says whether the file needs a password before asking for one. */
export async function readBackupHeader(file: Blob): Promise<BackupHeader> {
  return (await open(file)).header;
}

async function* gunzipLines(blob: Blob): AsyncGenerator<string> {
  const reader = blob.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let start = 0;
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n', start)) {
        yield buf.slice(start, nl);
        start = nl + 1;
      }
      buf = buf.slice(start);
      if (buf.length > MAX_LINE_CHARS) throw new BackupError('too-large');
    }
    buf += decoder.decode();
    if (buf) yield buf;
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

const COORD_KEY = /^(?:ECI|CELL|CI|SITE):[^\u0000-\u001f\u007f]{1,200}$/;

function cleanCoord(e: unknown): [string, number, number] | undefined {
  if (!Array.isArray(e) || e.length !== 3) return undefined;
  const [key, lat, lon] = e as unknown[];
  if (typeof key !== 'string' || !COORD_KEY.test(key) || typeof lat !== 'number' || typeof lon !== 'number') return undefined;
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180) || lat === 0 || lon === 0) return undefined;
  return [key, lat, lon];
}

function cleanMapping(v: unknown, sheets: RawSheet[]): ColumnMapping | undefined {
  if (!isObject(v) || typeof v.sheet !== 'string' || !isCount(v.headerRow) || !isObject(v.columns)) return undefined;
  const sheet = v.sheet;
  if (!sheets.some((s) => s.name === sheet)) return undefined;
  const columns: Partial<Record<FlatField, number>> = {};
  for (const f of FLAT_FIELDS) {
    const c = v.columns[f];
    if (isCount(c) && c < MAX_ROW_CELLS) columns[f] = c;
  }
  const target = cleanText(v.target, 64);
  return { sheet, headerRow: v.headerRow, columns, ...(target ? { target } : {}) };
}

function cleanTargets(v: unknown): BackupTarget[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: BackupTarget[] = [];
  for (const t of v.slice(0, MAX_TARGETS)) {
    if (!isObject(t) || typeof t.target !== 'string' || t.target.length > 64 || seen.has(t.target)) continue;
    seen.add(t.target);
    const label = cleanText(t.label, 200);
    out.push({ target: t.target, slot: isCount(t.slot) && t.slot < 1000 ? t.slot : -1, ...(label && label !== t.target ? { label } : {}) });
  }
  return out;
}

/** Each target keeps its colour; a missing or repeated slot takes the lowest free one. */
function uniqueSlots(targets: BackupTarget[]) {
  const used = new Set<number>();
  for (const t of targets) {
    if (t.slot >= 0 && !used.has(t.slot)) used.add(t.slot);
    else t.slot = -1;
  }
  let next = 0;
  for (const t of targets) {
    if (t.slot >= 0) continue;
    while (used.has(next)) next++;
    t.slot = next;
    used.add(next);
  }
}

interface FileInProgress extends BackupFile {
  expect: number[];
  /** Sheet being filled; rows arrive sheet by sheet. */
  sheet: number;
}

/** Rebuilds a snapshot line by line, checking every record: the file is untrusted. */
class SnapshotReader {
  private settings?: Settings;
  private files: FileInProgress[] = [];
  private profiles = new Map<string, PersonProfile>();
  private coords?: BackupCoords;
  private rows = 0;
  private profileRecords = 0;
  private coordEntries = 0;
  private end?: Record<string, unknown>;
  skipped = 0;

  add(line: string) {
    if (line.length > MAX_LINE_CHARS) throw new BackupError('too-large');
    if (this.end) throw new BackupError('corrupt'); // nothing may follow the end record
    let r: unknown;
    try {
      r = JSON.parse(line);
    } catch {
      throw new BackupError('corrupt');
    }
    if (!isObject(r)) throw new BackupError('corrupt');
    switch (r.t) {
      case 'settings':
        this.settings = cleanSettings(r.settings);
        break;
      case 'file':
        this.addFile(r);
        break;
      case 'rows':
        this.addRows(r);
        break;
      case 'profile':
        this.addProfile(r.p);
        break;
      case 'coords':
        this.addCoords(r);
        break;
      case 'end':
        this.end = r;
        break;
      default:
        this.skipped++; // a kind of record this version does not know
    }
  }

  /** The file before the next one (or the end) must be complete. */
  private closeFile() {
    const f = this.files[this.files.length - 1];
    if (f && f.sheets.some((s, k) => s.rows.length !== f.expect[k])) throw new BackupError('corrupt');
  }

  private addFile(r: Record<string, unknown>) {
    this.closeFile();
    if (r.i !== this.files.length) throw new BackupError('corrupt');
    if (this.files.length >= MAX_FILES) throw new BackupError('too-large');
    if (!Array.isArray(r.sheets) || r.sheets.length === 0 || r.sheets.length > MAX_SHEETS) throw new BackupError('corrupt');
    const sheets: RawSheet[] = [];
    const expect: number[] = [];
    for (const s of r.sheets as unknown[]) {
      if (!isObject(s) || typeof s.name !== 'string' || s.name.length > 255 || !isCount(s.rows)) throw new BackupError('corrupt');
      sheets.push({ name: s.name, rows: [] });
      expect.push(s.rows);
    }
    const mapping = r.mapping === undefined ? undefined : cleanMapping(r.mapping, sheets);
    if (r.mapping !== undefined && !mapping) this.skipped++;
    this.files.push({
      fileName: cleanText(r.fileName, 255) ?? 'ไม่ทราบชื่อไฟล์',
      sheets,
      ...(mapping ? { mapping } : {}),
      targets: cleanTargets(r.targets),
      expect,
      sheet: 0,
    });
  }

  private addRows(r: Record<string, unknown>) {
    const f = this.files[this.files.length - 1];
    const s = r.s;
    if (!f || r.i !== this.files.length - 1 || !isCount(s) || s < f.sheet || s >= f.sheets.length || !Array.isArray(r.rows)) {
      throw new BackupError('corrupt');
    }
    for (; f.sheet < s; f.sheet++) {
      if (f.sheets[f.sheet].rows.length !== f.expect[f.sheet]) throw new BackupError('corrupt');
    }
    const rows = r.rows as unknown[];
    const sheet = f.sheets[s];
    if (sheet.rows.length + rows.length > f.expect[s]) throw new BackupError('corrupt');
    this.rows += rows.length;
    if (this.rows > MAX_ROWS) throw new BackupError('too-large');
    for (const row of rows) {
      if (!Array.isArray(row) || row.length > MAX_ROW_CELLS) throw new BackupError('corrupt');
      for (const c of row) {
        if (c !== null && (typeof c !== 'string' || c.length > MAX_CELL_CHARS)) throw new BackupError('corrupt');
      }
      sheet.rows.push(row as Row);
    }
  }

  private addProfile(p: unknown) {
    this.profileRecords++;
    const clean = cleanProfile(p);
    if (clean && (this.profiles.has(clean.number) || this.profiles.size < MAX_PROFILES)) this.profiles.set(clean.number, clean);
    else this.skipped++;
  }

  private addCoords(r: Record<string, unknown>) {
    if (!Array.isArray(r.entries)) throw new BackupError('corrupt');
    const coords = (this.coords ??= { name: cleanText(r.name, 255) ?? 'พิกัดเสา', entries: [] });
    for (const e of r.entries as unknown[]) {
      this.coordEntries++;
      const c = cleanCoord(e);
      if (c && coords.entries.length < MAX_COORDS) coords.entries.push(c);
      else this.skipped++;
    }
  }

  finish(): { snapshot: SessionSnapshot; skipped: number } {
    this.closeFile();
    const end = this.end;
    if (
      !end ||
      !this.settings ||
      end.files !== this.files.length ||
      end.rows !== this.rows ||
      end.profiles !== this.profileRecords ||
      end.coords !== this.coordEntries
    ) {
      throw new BackupError('corrupt');
    }
    const files: BackupFile[] = this.files.map((f) => ({ fileName: f.fileName, sheets: f.sheets, ...(f.mapping ? { mapping: f.mapping } : {}), targets: f.targets }));
    uniqueSlots(files.flatMap((f) => f.targets));
    return {
      snapshot: { settings: this.settings, files, profiles: [...this.profiles.values()], ...(this.coords ? { coords: this.coords } : {}) },
      skipped: this.skipped,
    };
  }
}

export interface RestoredBackup {
  header: BackupHeader;
  snapshot: SessionSnapshot;
  /** Entries left out because they were unusable (a profile, a coordinate, a mapping). */
  skipped: number;
}

/** Read a backup file. A sealed file needs its password; a wrong one throws code 'password'. */
export async function readBackup(file: Blob, password?: string): Promise<RestoredBackup> {
  const { header, prefix, payload } = await open(file);
  if (!canCompress()) throw new BackupError('unsupported');
  let compressed = payload;
  const enc = header.encryption;
  if (enc) {
    if (!canEncrypt()) throw new BackupError('unsupported');
    if (!password) throw new BackupError('password');
    if (payload.size > MAX_SEALED_BYTES) throw new BackupError('too-large');
    let salt: Uint8Array<ArrayBuffer>;
    let iv: Uint8Array<ArrayBuffer>;
    try {
      salt = fromBase64(enc.salt);
      iv = fromBase64(enc.iv);
    } catch {
      throw new BackupError('corrupt');
    }
    if (salt.length < 8 || iv.length !== 12) throw new BackupError('corrupt');
    const key = await deriveKey(password, salt, enc.iterations, 'decrypt');
    try {
      compressed = new Blob([await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: prefix }, key, await payload.arrayBuffer())]);
    } catch {
      throw new BackupError('password');
    }
  }
  const reader = new SnapshotReader();
  try {
    for await (const line of gunzipLines(compressed)) reader.add(line);
    return { header, ...reader.finish() };
  } catch (e) {
    throw e instanceof BackupError ? e : new BackupError('corrupt');
  }
}

// ------------------------------------------------------------------ helpers

export interface BackupSummary {
  files: number;
  targets: number;
  /** Raw spreadsheet rows (headers included). */
  rows: number;
  aliases: number;
  profiles: number;
  photos: number;
  coords: number;
}

export function summarizeSnapshot(s: SessionSnapshot): BackupSummary {
  let rows = 0;
  let targets = 0;
  let aliases = 0;
  for (const f of s.files) {
    for (const sh of f.sheets) rows += sh.rows.length;
    targets += f.targets.length;
    aliases += f.targets.filter((t) => t.label).length;
  }
  return {
    files: s.files.length,
    targets,
    rows,
    aliases,
    profiles: s.profiles.length,
    photos: s.profiles.filter((p) => p.photo).length,
    coords: s.coords?.entries.length ?? 0,
  };
}

/** File name like CDR-backup_20261013-0930.cdrbak (local wall clock). */
export function backupFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `CDR-backup_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${BACKUP_EXT}`;
}
