import { describe, expect, it } from 'vitest';
import { isPersonKind, normalizeNumber } from '../../src/lib/phone';

// All numbers here are fictitious; they only reproduce the formats seen in exports.
describe('normalizeNumber', () => {
  it.each([
    ['66810000101', '0810000101', 'mobile'],
    ['0810000101', '0810000101', 'mobile'],
    ['+66 81 000 0101', '0810000101', 'mobile'],
    ['810000101', '0810000101', 'mobile'], // leading zero lost in a numeric cell
    ['021234567', '021234567', 'landline'],
    ['6621234567', '021234567', 'landline'],
    ['900515', '900515', 'shortcode'],
    ['661678', '1678', 'shortcode'],
    ['66800000', '66800000', 'shortcode'],
    ['AIS', 'AIS', 'alpha'],
    ['Shop-ab', 'Shop-ab', 'alpha'],
    ['B56800000', 'B56800000', 'other'],
    ['*57600000', '*57600000', 'other'],
  ])('%s -> %s (%s)', (raw, key, kind) => {
    const n = normalizeNumber(raw);
    expect(n.key).toBe(key);
    expect(n.kind).toBe(kind);
  });

  it('recognises international numbers, including routing prefixes', () => {
    for (const raw of ['959400000555', '69710959400000555', '69705959400000555', '+959400000555', '001959400000555']) {
      const n = normalizeNumber(raw);
      expect(n.key).toBe('+959400000555');
      expect(n.kind).toBe('intl');
      expect(n.country).toBe('เมียนมา');
    }
    expect(normalizeNumber('60120000777')).toMatchObject({ key: '+60120000777', kind: 'intl', country: 'มาเลเซีย' });
  });

  it('keeps bare 9-digit values as-is when the export writes numbers as text', () => {
    expect(normalizeNumber('990600000', { restoreLeadingZero: false }).kind).toBe('other');
    expect(normalizeNumber('990600000').key).toBe('0990600000');
  });

  it('extracts numeric SIP users and treats empty values as none', () => {
    expect(normalizeNumber('sip:+66810000101@ims.example').key).toBe('0810000101');
    expect(normalizeNumber('sip:vscc01@ims.mnc005.mcc520.3gppnetwork.org').kind).toBe('other');
    expect(normalizeNumber('').kind).toBe('none');
    expect(normalizeNumber('-').kind).toBe('none');
    expect(normalizeNumber(null).kind).toBe('none');
  });

  it('separates people from service traffic', () => {
    expect(isPersonKind('mobile')).toBe(true);
    expect(isPersonKind('intl')).toBe(true);
    expect(isPersonKind('alpha')).toBe(false);
    expect(isPersonKind('shortcode')).toBe(false);
  });
});
