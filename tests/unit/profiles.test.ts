import { describe, expect, it } from 'vitest';
import {
  cleanProfile,
  formatNationalId,
  isValidThaiId,
  MAX_PROFILES,
  mergeProfiles,
  nationalIdProblem,
  parseProfilesFile,
  personName,
  PROFILE_FORMAT,
  profilesFileName,
  recordLines,
  serializeProfiles,
  type PersonProfile,
} from '../../src/lib/profiles';

// Fictitious people and numbers only.
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const somchai: PersonProfile = {
  number: '0860000111',
  firstName: 'นายสมมติ',
  lastName: 'ทดสอบระบบ',
  nickname: 'ตัวอย่าง',
  address: '99/9 หมู่ 9 ตำบลจำลอง\nอำเภอจำลอง จังหวัดตัวอย่าง',
  criminalRecord: 'คดีตัวอย่างที่ 1 (สมมติ)\n\n  คดีตัวอย่างที่ 2 (สมมติ)  ',
  photo: PHOTO,
  updatedAt: 1,
};

describe('person profiles', () => {
  it('names a person and splits the record into cases', () => {
    expect(personName(somchai)).toBe('นายสมมติ ทดสอบระบบ');
    expect(personName({ number: 'x', nickname: 'ตัวอย่าง', updatedAt: 0 })).toBe('ตัวอย่าง');
    expect(personName(undefined)).toBeUndefined();
    expect(recordLines(somchai)).toEqual(['คดีตัวอย่างที่ 1 (สมมติ)', 'คดีตัวอย่างที่ 2 (สมมติ)']);
  });

  it('round-trips through a saved file', () => {
    const text = serializeProfiles({ [somchai.number]: somchai, '0950000222': { number: '0950000222', firstName: 'นางสาวจำลอง', updatedAt: 2 } });
    expect(JSON.parse(text).format).toBe(PROFILE_FORMAT);
    const { profiles, skipped } = parseProfilesFile(text);
    expect(skipped).toBe(0);
    expect(profiles).toHaveLength(2);
    const back = profiles.find((p) => p.number === somchai.number)!;
    expect(back.photo).toBe(PHOTO);
    expect(back.address).toBe(somchai.address);
    expect(recordLines(back)).toHaveLength(2);
  });

  it('rejects files that are not profile files', () => {
    expect(() => parseProfilesFile('not json')).toThrow();
    expect(() => parseProfilesFile(JSON.stringify({ format: 'other', profiles: [] }))).toThrow();
    expect(() => parseProfilesFile(JSON.stringify({ format: PROFILE_FORMAT, version: 99, profiles: [] }))).toThrow();
  });

  it('cleans untrusted entries: bad photos, control characters, empty records, long text', () => {
    const { profiles, skipped } = parseProfilesFile(
      JSON.stringify({
        format: PROFILE_FORMAT,
        version: 1,
        profiles: [
          { number: '0810000101', firstName: 'ก\u0007ข', photo: 'javascript:alert(1)' },
          { number: '0820000202', photo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' },
          { number: '', firstName: 'ไม่มีเลข' },
          { number: '0630000303', notes: 'x'.repeat(20000) },
          'not an object',
        ],
      }),
    );
    expect(skipped).toBe(3);
    expect(profiles.map((p) => p.number).sort()).toEqual(['0630000303', '0810000101']);
    const a = profiles.find((p) => p.number === '0810000101')!;
    expect(a.firstName).toBe('กข');
    expect(a.photo).toBeUndefined();
    expect(profiles.find((p) => p.number === '0630000303')!.notes).toHaveLength(10000);
  });

  it('caps the number of profiles read from one file', () => {
    const many = Array.from({ length: MAX_PROFILES + 3 }, (_, i) => ({ number: `09${String(i).padStart(8, '0')}`, firstName: 'ทดสอบ' }));
    const { profiles, skipped } = parseProfilesFile(JSON.stringify({ format: PROFILE_FORMAT, version: 1, profiles: many }));
    expect(profiles).toHaveLength(MAX_PROFILES);
    expect(skipped).toBe(3);
  });

  it('merges a file over the current profiles', () => {
    const cur = { [somchai.number]: somchai };
    const incoming = [cleanProfile({ number: somchai.number, firstName: 'ชื่อใหม่' })!, cleanProfile({ number: '0640000404', nickname: 'สมมติ' })!];
    const { next, added, replaced } = mergeProfiles(cur, incoming);
    expect(added).toBe(1);
    expect(replaced).toBe(1);
    expect(next[somchai.number].firstName).toBe('ชื่อใหม่');
    expect(cur[somchai.number].firstName).toBe('นายสมมติ');
  });

  it('keeps a national ID as 13 digits and checks its last digit', () => {
    // Fictitious IDs: 1-1111-11111-11-9 has a valid check digit, …-1 does not.
    expect(isValidThaiId('1111111111119')).toBe(true);
    expect(isValidThaiId('1111111111111')).toBe(false);
    expect(isValidThaiId('111111111111')).toBe(false);
    expect(cleanProfile({ number: '0860000111', nationalId: ' 1-1111-11111-11-9 ' })!.nationalId).toBe('1111111111119');
    expect(cleanProfile({ number: '0860000111', nationalId: '1 1111 11111 11 9' })!.nationalId).toBe('1111111111119');
    // Another document number stays as typed, on one line.
    expect(cleanProfile({ number: '0860000111', nationalId: 'AA 000\n0000' })!.nationalId).toBe('AA 000 0000');
    // An ID alone is worth keeping.
    expect(cleanProfile({ number: '0860000111', nationalId: '1111111111119' })).toBeDefined();
    expect(formatNationalId('1111111111119')).toBe('1-1111-11111-11-9');
    expect(formatNationalId('AA0000000')).toBe('AA0000000');
    expect(nationalIdProblem('1-1111-11111-11-9')).toBeUndefined();
    expect(nationalIdProblem('')).toBeUndefined();
    expect(nationalIdProblem('1111111111111')).toMatch(/เลขตรวจสอบ/);
    expect(nationalIdProblem('11111')).toMatch(/5 หลัก/);
    expect(nationalIdProblem('AA0000000')).toMatch(/ตามที่กรอก/);
    // Saved to a file and read back.
    const text = serializeProfiles({ '0860000111': cleanProfile({ number: '0860000111', firstName: 'นายสมมติ', nationalId: '1-1111-11111-11-9' })! });
    expect(parseProfilesFile(text).profiles[0].nationalId).toBe('1111111111119');
  });

  it('keeps parcel pickup locations as typed, one per line', () => {
    const p = cleanProfile({ number: '0860000111', parcelLocation: ' 13.7563, 100.5018 (จุดสมมติ)\r\n13.7000, 100.5000 ' })!;
    // An entry with only a pickup location is worth keeping.
    expect(p).toBeDefined();
    expect(p.parcelLocation).toBe('13.7563, 100.5018 (จุดสมมติ)\n13.7000, 100.5000');
    const text = serializeProfiles({ [p.number]: p });
    expect(parseProfilesFile(text).profiles[0].parcelLocation).toBe(p.parcelLocation);
    expect(cleanProfile({ number: '0860000111', parcelLocation: 'x'.repeat(5000) })!.parcelLocation).toHaveLength(2000);
  });

  it('names saved files by date and time', () => {
    expect(profilesFileName(new Date(2026, 9, 12, 14, 5))).toBe('CDR-profiles_20261012-1405.json');
  });
});
