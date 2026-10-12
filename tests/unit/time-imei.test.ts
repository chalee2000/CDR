import { describe, expect, it } from 'vitest';
import { imei15, imeiCore, likelySameHandset, luhnCheckDigit } from '../../src/lib/imei';
import { dayKey, fmtDateTime, hourOf, isNight, parseDateAndClock, parseWallClock, weekdayMon0 } from '../../src/lib/time';

describe('parseWallClock', () => {
  it('keeps a "Z" clock time as written by default (Thai exports)', () => {
    const t = parseWallClock('2026-08-01T09:15:30.000Z');
    expect(fmtDateTime(t)).toBe('01/08/2026 09:15:30');
  });

  it('converts real UTC to Thai time when asked', () => {
    const t = parseWallClock('2026-08-01T09:15:30.000Z', 'utc');
    expect(fmtDateTime(t)).toBe('01/08/2026 16:15:30');
  });

  it('honours explicit offsets', () => {
    expect(fmtDateTime(parseWallClock('2026-08-01T09:00:00+07:00'))).toBe('01/08/2026 09:00:00');
    expect(fmtDateTime(parseWallClock('2026-08-01T02:00:00+00:00'))).toBe('01/08/2026 09:00:00');
  });

  it('reads common layouts', () => {
    expect(fmtDateTime(parseWallClock('2026-07-02 06:28:22'))).toBe('02/07/2026 06:28:22');
    expect(fmtDateTime(parseWallClock('2026/07/01 00:00:00'))).toBe('01/07/2026 00:00:00');
    expect(fmtDateTime(parseWallClock('01/07/2569 13:45'))).toBe('01/07/2026 13:45:00'); // Buddhist Era
    expect(fmtDateTime(parseWallClock('20260701134500'))).toBe('01/07/2026 13:45:00');
    expect(fmtDateTime(parseDateAndClock('2026-07-01', '13:45:10'))).toBe('01/07/2026 13:45:10');
    expect(Number.isNaN(parseWallClock('not a date'))).toBe(true);
    expect(Number.isNaN(parseWallClock('2026-02-31 10:00:00'))).toBe(true);
  });

  it('derives day, hour, weekday and night from wall-clock values', () => {
    const t = parseWallClock('2026-10-12 23:30:00'); // Monday
    expect(dayKey(t)).toBe('2026-10-12');
    expect(hourOf(t)).toBe(23);
    expect(weekdayMon0(t)).toBe(0);
    expect(isNight(t, 20, 6)).toBe(true);
    expect(isNight(parseWallClock('2026-10-12 12:00:00'), 20, 6)).toBe(false);
    expect(fmtDateTime(t, 'be')).toBe('12/10/2569 23:30:00');
  });
});

describe('IMEI', () => {
  // Fictitious device numbers except the public Luhn textbook example.
  it('compares IMEI, IMEI with zero check digit and IMEISV on 14 digits', () => {
    expect(imeiCore('356666000030300')).toBe('35666600003030');
    expect(imeiCore('3566660000303005')).toBe('35666600003030');
    expect(imeiCore('000000000000000')).toBeUndefined();
    expect(imeiCore('12345')).toBeUndefined();
  });

  it('computes the Luhn check digit', () => {
    expect(luhnCheckDigit('49015420323751')).toBe(8);
    expect(imei15('35555500001001')).toBe('355555000010011');
  });

  it('flags consecutive serials of one model as a possible dual-SIM handset', () => {
    expect(likelySameHandset('86600000012345', '86600000012346')).toBe(true);
    expect(likelySameHandset('86600000012345', '35555500001001')).toBe(false);
    expect(likelySameHandset('86600000012345', '86600000099999')).toBe(false);
  });
});
