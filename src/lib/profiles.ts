/**
 * Person details an investigator attaches to a number (name, address,
 * criminal record, photo). They are typed in by the user — never read from
 * CDR files — live only in page memory, and leave the browser only as a file
 * the user saves on purpose.
 */

export interface PersonProfile {
  /** The number exactly as the app keys it (Interaction.peer / Dataset.target). */
  number: string;
  firstName?: string;
  lastName?: string;
  nickname?: string;
  address?: string;
  /** One case per line. */
  criminalRecord?: string;
  notes?: string;
  /** data:image/jpeg;base64,… — square, re-encoded in the browser (no EXIF). */
  photo?: string;
  updatedAt: number;
}

export type ProfileMap = Record<string, PersonProfile>;

export const PROFILE_FORMAT = 'cdr-analyzer/profiles';
export const PROFILE_VERSION = 1;
export const MAX_PROFILES = 5000;
export const MAX_PHOTO_CHARS = 1_500_000;

const TEXT_LIMITS = {
  firstName: 200,
  lastName: 200,
  nickname: 200,
  address: 2000,
  criminalRecord: 10000,
  notes: 10000,
} as const;
export type ProfileTextField = keyof typeof TEXT_LIMITS;
export const PROFILE_TEXT_FIELDS = Object.keys(TEXT_LIMITS) as ProfileTextField[];

const PHOTO_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
// Keys are numbers, international numbers or sender names; no control characters.
const NUMBER_RE = /^[^\u0000-\u001f\u007f]{1,64}$/;

export function isValidPhoto(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_PHOTO_CHARS && PHOTO_RE.test(v);
}

/** Trim, unify line breaks, drop control characters and cap the length. */
export function cleanText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max)
    .trim();
  return s || undefined;
}

/** A clean profile, or undefined when the input is unusable or empty. */
export function cleanProfile(input: unknown, now = Date.now()): PersonProfile | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const o = input as Record<string, unknown>;
  const number = typeof o.number === 'string' ? o.number.trim() : '';
  if (!NUMBER_RE.test(number)) return undefined;
  const p: PersonProfile = { number, updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : now };
  for (const f of PROFILE_TEXT_FIELDS) {
    const v = cleanText(o[f], TEXT_LIMITS[f]);
    if (v) p[f] = v;
  }
  if (isValidPhoto(o.photo)) p.photo = o.photo;
  return hasContent(p) ? p : undefined;
}

export function hasContent(p: PersonProfile | undefined): boolean {
  return !!p && (PROFILE_TEXT_FIELDS.some((f) => !!p[f]) || !!p.photo);
}

/** "ชื่อ นามสกุล", or the nickname when no name was given. */
export function personName(p: PersonProfile | undefined): string | undefined {
  if (!p) return undefined;
  const full = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  return full || p.nickname || undefined;
}

export function recordLines(p: PersonProfile | undefined): string[] {
  return (p?.criminalRecord ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

export function serializeProfiles(map: ProfileMap, savedAt = new Date()): string {
  const profiles = Object.values(map)
    .filter(hasContent)
    .sort((a, b) => a.number.localeCompare(b.number));
  return JSON.stringify({ format: PROFILE_FORMAT, version: PROFILE_VERSION, savedAt: savedAt.toISOString(), count: profiles.length, profiles }, null, 1);
}

export class ProfileFileError extends Error {}

/** Read a saved profiles file. The file is untrusted: every field is checked. */
export function parseProfilesFile(text: string): { profiles: PersonProfile[]; skipped: number } {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new ProfileFileError('ไฟล์นี้ไม่ใช่ไฟล์ข้อมูลบุคคลของแอป (อ่าน JSON ไม่ได้)');
  }
  const o = data as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || o.format !== PROFILE_FORMAT || !Array.isArray(o.profiles)) {
    throw new ProfileFileError('ไฟล์นี้ไม่ใช่ไฟล์ข้อมูลบุคคลของแอป');
  }
  if (typeof o.version !== 'number' || o.version > PROFILE_VERSION) {
    throw new ProfileFileError('ไฟล์ข้อมูลบุคคลนี้มาจากแอปรุ่นใหม่กว่า กรุณาใช้แอปรุ่นล่าสุด');
  }
  const byNumber = new Map<string, PersonProfile>();
  let skipped = Math.max(0, o.profiles.length - MAX_PROFILES);
  for (const item of o.profiles.slice(0, MAX_PROFILES)) {
    const p = cleanProfile(item);
    if (p) byNumber.set(p.number, p);
    else skipped++;
  }
  return { profiles: [...byNumber.values()], skipped };
}

/** Profiles from a file replace those for the same numbers; others stay. */
export function mergeProfiles(cur: ProfileMap, incoming: PersonProfile[]): { next: ProfileMap; added: number; replaced: number } {
  const next = { ...cur };
  let added = 0;
  let replaced = 0;
  for (const p of incoming) {
    if (next[p.number]) replaced++;
    else added++;
    next[p.number] = p;
  }
  return { next, added, replaced };
}

/** File name like CDR-profiles_20261012-1405.json (local wall clock). */
export function profilesFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `CDR-profiles_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}
