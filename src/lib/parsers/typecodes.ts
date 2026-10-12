import type { Direction, Service } from '../types';

export interface TypeInfo {
  service: Service;
  /** Direction from the point of view of the served (A-column) subscriber. */
  direction?: Direction;
  known: boolean;
}

const TABLE: [string[], Service, Direction | undefined][] = [
  [['MOC', 'MO', 'OUT', 'OUTGOING', 'CALL_OUT', 'CALL_MO', 'VOICE_MO', 'MOC_VOICE', 'ORIGINATING', 'ORIGINATING_ROLE', 'VOICE_OUT', 'โทรออก'], 'call', 'out'],
  [['MTC', 'MT', 'IN', 'INCOMING', 'CALL_IN', 'CALL_MT', 'VOICE_MT', 'MTC_VOICE', 'TERMINATING', 'TERMINATING_ROLE', 'VOICE_IN', 'โทรเข้า'], 'call', 'in'],
  [['SMO', 'SMS_MO', 'SM_MO', 'MO_SMS', 'SMS_OUT', 'SMSMO', 'ส่งข้อความ', 'SMS_ออก'], 'sms', 'out'],
  [['SMT', 'SMS_MT', 'SM_MT', 'MT_SMS', 'SMS_IN', 'SMSMT', 'รับข้อความ', 'SMS_เข้า'], 'sms', 'in'],
  [['CF', 'CFW', 'FWD', 'CALL_FORWARD', 'FORWARD', 'FORWARDED', 'โอนสาย'], 'call', 'fwd'],
  [['GPRS', 'DATA', 'PS', 'PDP', 'INTERNET', 'MOBILE_DATA', 'LTE_DATA', 'อินเทอร์เน็ต'], 'data', 'na'],
  [['VOICE', 'CALL', 'โทร'], 'call', undefined],
  [['SMS', 'ข้อความ'], 'sms', undefined],
];

const LOOKUP = new Map<string, { service: Service; direction?: Direction }>();
for (const [codes, service, direction] of TABLE) {
  for (const c of codes) LOOKUP.set(c, { service, direction });
}

export function normCode(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s\-./]+/g, '_');
}

export function classifyType(raw: string | null | undefined): TypeInfo {
  const code = normCode(raw);
  if (!code) return { service: 'other', known: false };
  const hit = LOOKUP.get(code);
  if (hit) return { ...hit, known: true };
  return { service: 'other', known: false };
}

/** Values of an explicit direction column. */
export function classifyDirection(raw: string | null | undefined): Direction | undefined {
  const code = normCode(raw);
  if (['O', 'OUT', 'OUTGOING', 'MO', 'ออก', 'โทรออก'].includes(code)) return 'out';
  if (['I', 'IN', 'INCOMING', 'MT', 'เข้า', 'โทรเข้า'].includes(code)) return 'in';
  return undefined;
}

export function invert(d: Direction | undefined): Direction | undefined {
  if (d === 'out') return 'in';
  if (d === 'in') return 'out';
  return d;
}
