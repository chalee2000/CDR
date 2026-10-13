import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  backupFileName,
  isBackupFile,
  PBKDF2_ITERATIONS,
  readBackup,
  readBackupHeader,
  summarizeSnapshot,
  writeBackup,
  type BackupFile,
  type SessionSnapshot,
} from '../../src/lib/backup';
import { parseWorkbook } from '../../src/lib/parsers';
import type { PersonProfile } from '../../src/lib/profiles';
import { generateSamples } from '../../src/lib/samples/generate';
import { cleanSettings, DEFAULT_SETTINGS, type RawWorkbook } from '../../src/lib/types';

// Fictitious people, numbers and cells only.
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const person: PersonProfile = {
  number: '0860000111',
  firstName: 'นายสมมติ',
  lastName: 'ทดสอบระบบ',
  address: '99/9 หมู่ 9 ตำบลจำลอง',
  criminalRecord: 'คดีตัวอย่างที่ 1 (สมมติ)',
  photo: PHOTO,
  updatedAt: 1,
};
const manual: RawWorkbook = {
  fileName: 'manual.csv',
  sheets: [
    {
      name: 'manual',
      rows: [
        ['เวลา', 'ต้นทาง', 'ปลายทาง'],
        ['2026-08-01 10:00:00', '0810000101', '0899999999'],
      ],
    },
  ],
};

function sampleSnapshot(): SessionSnapshot {
  let slot = 0;
  const files: BackupFile[] = generateSamples().map((wb) => {
    const res = parseWorkbook(wb, 'local');
    if (res.kind !== 'ok') throw new Error('sample did not parse');
    return { fileName: wb.fileName, sheets: wb.sheets, targets: res.drafts.map((d) => ({ target: d.target, slot: slot++ })) };
  });
  files[0].targets[0] = { ...files[0].targets[0], label: 'นาย ก. (สมมติ)' };
  return {
    settings: { ...DEFAULT_SETTINGS, zMode: 'utc', burstCount: 4, burstSms: false },
    files: [
      ...files,
      { fileName: manual.fileName, sheets: manual.sheets, mapping: { sheet: 'manual', headerRow: 0, columns: { time: 0, a: 1, b: 2 }, target: '0810000101' }, targets: [{ target: '0810000101', slot: 7 }] },
    ],
    profiles: [person, { number: '0950000222', nickname: 'ตัวอย่าง', updatedAt: 2 }],
    coords: {
      name: 'cells.csv',
      entries: [
        ['ECI:150900141', 13.75, 100.5],
        ['SITE:SIM0001E', 13.7, 100.61],
      ],
    },
  };
}

// The container, spelled out here so tests can build and damage files by hand.
function prefix(header: object, container = 1): Uint8Array<ArrayBuffer> {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(12 + json.length);
  out.set([0x43, 0x44, 0x52, 0x42, 0x41, 0x4b, 0x00, container]);
  new DataView(out.buffer).setUint32(8, json.length, true);
  out.set(json, 12);
  return out;
}

const HEADER = { format: BACKUP_FORMAT, version: 1, savedAt: '2026-10-13T02:30:00.000Z', compression: 'gzip', encryption: null };

async function craft(lines: object[], header: object = HEADER, container = 1): Promise<Blob> {
  const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  const gz = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  return new Blob([prefix(header, container), gz]);
}

async function payloadLines(blob: Blob): Promise<Record<string, unknown>[]> {
  const size = new DataView(await blob.slice(8, 12).arrayBuffer()).getUint32(0, true);
  const text = await new Response(blob.slice(12 + size).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

async function damage(blob: Blob, at: number): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  bytes[at] ^= 0xff;
  return new Blob([bytes]);
}

const minimal = (extra: object[] = [], end: object = { t: 'end', files: 0, rows: 0, profiles: 0, coords: 0 }) => [{ t: 'settings', settings: DEFAULT_SETTINGS }, ...extra, end];

describe('backup files', () => {
  it('round-trips the whole session without a password', async () => {
    const snap = sampleSnapshot();
    const blob = await writeBackup(snap, { savedAt: new Date('2026-10-13T02:30:00Z') });
    const header = await readBackupHeader(blob);
    expect(header).toEqual(HEADER);
    const { snapshot, skipped } = await readBackup(blob);
    expect(skipped).toBe(0);
    expect(snapshot).toEqual(snap);
    // The restored workbooks parse to the same targets as before.
    for (const f of snapshot.files) {
      const res = parseWorkbook({ fileName: f.fileName, sheets: f.sheets }, 'local', f.mapping);
      expect(res.kind).toBe('ok');
    }
    expect(summarizeSnapshot(snapshot)).toMatchObject({ files: 4, targets: 4, aliases: 1, profiles: 2, photos: 1, coords: 2 });
  });

  it('writes large sheets in chunks and reads them back in order', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => [`2026-08-01 ${String(i % 24).padStart(2, '0')}:00:00`, '0810000101', i % 7 ? `08${String(i).padStart(8, '0')}` : null]);
    const snap: SessionSnapshot = {
      settings: DEFAULT_SETTINGS,
      files: [{ fileName: 'big.csv', sheets: [{ name: 'big', rows }, { name: 'empty', rows: [] }], targets: [{ target: '0810000101', slot: 0 }] }],
      profiles: [],
    };
    const blob = await writeBackup(snap);
    const lines = await payloadLines(blob);
    expect(lines.filter((l) => l.t === 'rows').map((l) => (l.rows as unknown[]).length)).toEqual([1000, 1000, 500]);
    expect(lines[lines.length - 1]).toEqual({ t: 'end', files: 1, rows: 2500, profiles: 0, coords: 0 });
    expect((await readBackup(blob)).snapshot).toEqual(snap);
  });

  it('seals the file with a password', async () => {
    const snap = sampleSnapshot();
    const password = 'รหัสผ่านทดสอบ 123';
    const blob = await writeBackup(snap, { password, iterations: 1000 });
    const header = await readBackupHeader(blob);
    expect(header.encryption).toMatchObject({ cipher: 'AES-GCM', kdf: 'PBKDF2', hash: 'SHA-256', iterations: 1000 });
    expect(JSON.stringify(header)).not.toMatch(/0810000101|นายสมมติ|manual/);
    await expect(readBackup(blob)).rejects.toMatchObject({ code: 'password' });
    await expect(readBackup(blob, 'wrong password')).rejects.toMatchObject({ code: 'password' });
    expect((await readBackup(blob, password)).snapshot).toEqual(snap);
    // The payload is not plain gzip.
    await expect(payloadLines(blob)).rejects.toThrow();
  });

  it('uses the full PBKDF2 work factor by default', async () => {
    const snap: SessionSnapshot = { settings: DEFAULT_SETTINGS, files: [], profiles: [person] };
    const blob = await writeBackup(snap, { password: 'a long passphrase' });
    expect((await readBackupHeader(blob)).encryption?.iterations).toBe(PBKDF2_ITERATIONS);
    expect((await readBackup(blob, 'a long passphrase')).snapshot.profiles).toEqual([person]);
  });

  it('detects a changed header or damaged bytes in a sealed file', async () => {
    const snap = sampleSnapshot();
    const blob = await writeBackup(snap, { password: 'password-1', iterations: 1000, savedAt: new Date('2026-10-13T02:30:00Z') });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const at = text.indexOf('2026-10-13');
    bytes.set(new TextEncoder().encode('2025'), at); // same length, different date
    await expect(readBackup(new Blob([bytes]), 'password-1')).rejects.toMatchObject({ code: 'password' });
    await expect(readBackup(await damage(blob, blob.size - 40), 'password-1')).rejects.toMatchObject({ code: 'password' });
  });

  it('reports damaged and truncated files', async () => {
    const blob = await writeBackup(sampleSnapshot());
    await expect(readBackup(await damage(blob, Math.floor(blob.size / 2)))).rejects.toMatchObject({ code: 'corrupt' });
    await expect(readBackup(blob.slice(0, blob.size - 20))).rejects.toMatchObject({ code: 'corrupt' });
    await expect(readBackup(blob.slice(0, 20))).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('tells other files apart', async () => {
    const xlsx = new Blob([readFileSync('samples/sample-ais-0810000101.xlsx')]);
    await expect(readBackup(xlsx)).rejects.toMatchObject({ code: 'not-backup' });
    await expect(readBackup(new Blob([JSON.stringify({ format: 'cdr-analyzer/profiles', version: 1, profiles: [] })]))).rejects.toMatchObject({ code: 'not-backup' });
    await expect(readBackup(await craft(minimal(), { ...HEADER, format: 'something-else' }))).rejects.toMatchObject({ code: 'not-backup' });
    expect(await isBackupFile(new File([xlsx], 'cdr.xlsx'))).toBe(false);
    expect(await isBackupFile(new File(['x'], 'case.CDRBAK'))).toBe(true);
    expect(await isBackupFile(new File([await craft(minimal())], 'renamed.bin'))).toBe(true);
  });

  it('refuses files from a newer app', async () => {
    await expect(readBackup(await craft(minimal(), { ...HEADER, version: 2 }))).rejects.toMatchObject({ code: 'newer' });
    await expect(readBackup(await craft(minimal(), HEADER, 2))).rejects.toMatchObject({ code: 'newer' });
  });

  it('checks every record of a file it did not write', async () => {
    const lines = [
      { t: 'settings', settings: { burstCount: 1000, zMode: 'utc', nightStart: 25, coLocationKm: 2.5, extra: 'x' } },
      {
        t: 'file',
        i: 0,
        fileName: 'a\u0000.csv',
        sheets: [{ name: 'a', rows: 2 }],
        mapping: { sheet: 'missing', headerRow: 0, columns: { a: 0 } },
        targets: [
          { target: '0810000101', slot: 3, label: 'นาย ก.' },
          { target: '0820000202', slot: 3 },
          { target: '0810000101', slot: 5 },
          { target: 42, slot: 1 },
        ],
      },
      { t: 'rows', i: 0, s: 0, rows: [['h1', 'h2'], ['x', null]] },
      { t: 'profile', p: { number: '0860000111', firstName: 'นายสมมติ', photo: 'javascript:alert(1)' } },
      { t: 'profile', p: { number: '', firstName: 'ไม่มีเลข' } },
      { t: 'coords', name: 'c.csv', entries: [['ECI:1', 13.7, 100.5], ['ECI:2', 95, 100], ['BAD:3', 13, 100], ['CELL:X', 0, 100]] },
      { t: 'from-the-future', x: 1 },
      { t: 'end', files: 1, rows: 2, profiles: 2, coords: 4 },
    ];
    const { snapshot, skipped } = await readBackup(await craft(lines));
    expect(snapshot.settings).toEqual({ ...DEFAULT_SETTINGS, zMode: 'utc', coLocationKm: 2.5 });
    expect(snapshot.files).toEqual([
      {
        fileName: 'a.csv',
        sheets: [{ name: 'a', rows: [['h1', 'h2'], ['x', null]] }],
        targets: [
          { target: '0810000101', slot: 3, label: 'นาย ก.' },
          { target: '0820000202', slot: 0 },
        ],
      },
    ]);
    expect(snapshot.profiles).toEqual([{ number: '0860000111', firstName: 'นายสมมติ', updatedAt: expect.any(Number) }]);
    expect(snapshot.coords).toEqual({ name: 'c.csv', entries: [['ECI:1', 13.7, 100.5]] });
    // mapping 1 + profile 1 + coordinates 3 + unknown record 1
    expect(skipped).toBe(6);
  });

  it('rejects files whose structure does not add up', async () => {
    const file = { t: 'file', i: 0, fileName: 'a.csv', sheets: [{ name: 'a', rows: 2 }], targets: [] };
    const end1 = { t: 'end', files: 1, rows: 2, profiles: 0, coords: 0 };
    const cases: object[][] = [
      minimal([file, { t: 'rows', i: 0, s: 0, rows: [['x']] }], end1), // a row missing
      minimal([file, { t: 'rows', i: 0, s: 0, rows: [['x'], ['y'], ['z']] }], end1), // a row too many
      minimal([file, { t: 'rows', i: 0, s: 0, rows: [['x'], [1]] }], end1), // a number cell
      minimal([file, { t: 'rows', i: 1, s: 0, rows: [['x'], ['y']] }], end1), // rows of an unknown file
      minimal([{ ...file, i: 1 }, { t: 'rows', i: 1, s: 0, rows: [['x'], ['y']] }], end1), // files out of order
      minimal([file, { t: 'rows', i: 0, s: 0, rows: [['x'], ['y']] }], { ...end1, rows: 3 }), // wrong total
      minimal([], { t: 'end', files: 0, rows: 0, profiles: 1, coords: 0 }), // a profile lost
      [{ t: 'settings', settings: {} }], // no end record
      [...minimal(), { t: 'profile', p: person }], // a record after the end
      [{ t: 'end', files: 0, rows: 0, profiles: 0, coords: 0 }], // no settings
    ];
    for (const lines of cases) await expect(readBackup(await craft(lines))).rejects.toMatchObject({ code: 'corrupt' });
    const text = new Blob([prefix(HEADER), await new Response(new Blob(['{"t":"settings"\n']).stream().pipeThrough(new CompressionStream('gzip'))).blob()]);
    await expect(readBackup(text)).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('names files by local time', () => {
    expect(backupFileName(new Date(2026, 9, 13, 9, 5))).toBe('CDR-backup_20261013-0905.cdrbak');
  });
});

describe('settings from untrusted input', () => {
  it('keeps valid values and falls back to the defaults for the rest', () => {
    expect(cleanSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    const valid = { ...DEFAULT_SETTINGS, zMode: 'utc', nightStart: 22, nightEnd: 5, burstSms: false, yearStyle: 'be', showBasemap: false, coLocationKm: 0.5 };
    expect(cleanSettings(valid)).toEqual(valid);
    expect(cleanSettings({ nightStart: 22.5, burstCount: 2.5, burstMinutes: 0, relayMinutes: '30', zMode: 'gmt', dedupeExact: 'yes', yearStyle: 'thai' })).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings({ __proto__: { burstCount: 9 }, extra: 1 })).toEqual(DEFAULT_SETTINGS);
  });
});
