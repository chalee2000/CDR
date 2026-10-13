import type { ImsiCheck, Direction, Interaction, PeerKind, Service } from './types';

export const WEEKDAYS_TH = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
export const WEEKDAYS_SHORT_TH = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];

/** Same buckets as the cdr-narcotics report skill, so numbers line up. */
export const DAY_PERIODS = [
  { key: 'morning', label: 'เช้า (06:00–11:59)', from: 6, to: 12 },
  { key: 'midday', label: 'กลางวัน (12:00–15:59)', from: 12, to: 16 },
  { key: 'evening', label: 'เย็น (16:00–19:59)', from: 16, to: 20 },
  { key: 'night', label: 'กลางคืน (20:00–05:59)', from: 20, to: 6 },
] as const;

export function periodOfHour(h: number): (typeof DAY_PERIODS)[number]['key'] {
  if (h >= 6 && h < 12) return 'morning';
  if (h >= 12 && h < 16) return 'midday';
  if (h >= 16 && h < 20) return 'evening';
  return 'night';
}

export const PEER_KIND_TH: Record<PeerKind, string> = {
  mobile: 'มือถือ',
  landline: 'โทรศัพท์บ้าน',
  intl: 'ต่างประเทศ',
  shortcode: 'เลขบริการ/Short code',
  alpha: 'ชื่อผู้ส่ง (ระบบ/บริการ)',
  other: 'ไม่ทราบรูปแบบ',
  none: 'ไม่มีข้อมูล',
};

export type Category = 'callOut' | 'callIn' | 'callFwd' | 'smsOut' | 'smsIn' | 'data' | 'wifi' | 'other';

export const CATEGORY_TH: Record<Category, string> = {
  callOut: 'โทรออก',
  callIn: 'โทรเข้า',
  callFwd: 'โอนสาย',
  smsOut: 'ส่ง SMS',
  smsIn: 'รับ SMS',
  data: 'อินเทอร์เน็ต',
  wifi: 'Wi-Fi',
  other: 'อื่น ๆ',
};

export function categoryOf(service: Service, direction: Direction): Category {
  if (service === 'call') return direction === 'out' ? 'callOut' : direction === 'in' ? 'callIn' : direction === 'fwd' ? 'callFwd' : 'other';
  if (service === 'sms') return direction === 'out' ? 'smsOut' : direction === 'in' ? 'smsIn' : 'other';
  if (service === 'data') return 'data';
  if (service === 'wifi') return 'wifi';
  return 'other';
}

export function interactionLabel(it: Interaction): string {
  const base = CATEGORY_TH[categoryOf(it.service, it.direction)];
  if (it.service === 'call' && it.answered === false) return `${base} (ไม่สำเร็จ)`;
  return base;
}

export const SOURCE_TH: Record<Interaction['source'], string> = {
  FLAT: 'ตารางหลัก',
  VOICE: 'VOICE',
  IMS: 'IMS (VoLTE)',
  'VOICE+IMS': 'VOICE + IMS (สายเดียวกัน)',
  SMS: 'SMS',
  DATA: 'DATA',
  WIFI: 'Wi-Fi',
};

/** Why a SIM's rows were filed under the target or under a peer (True/DTAC). */
export const IMSI_BASIS_TH: Record<ImsiCheck['basis'], string> = {
  data: 'พบในชีต DATA ซึ่งมีเฉพาะการใช้งานของเป้าหมาย',
  main: 'พบในฝั่งของเป้าหมาย (MO ที่ A เป็นเป้าหมาย / MT ที่ B เป็นเป้าหมาย) มากที่สุด',
  'sim-change': 'อยู่ฝั่งของเป้าหมาย และใช้ไม่ทับช่วงเวลากับซิมอื่นของเป้าหมาย (เปลี่ยนซิม)',
  other: 'ไม่ใช่ IMSI ของเป้าหมาย: เป็นขาที่บันทึกจากเครื่องคู่สายซึ่งอยู่เครือข่ายเดียวกัน',
  role: 'แถวไม่มี IMSI: ตัดสินจากบทบาท MO/MT ของแถว',
};

/** Where a SIM's cell positions end up in the analysis. */
export function imsiUseTh(c: Pick<ImsiCheck, 'owner' | 'number'>): string {
  if (c.owner === 'target') return 'ตำแหน่งของเป้าหมาย';
  return c.number ? `ตำแหน่งของ ${c.number} (ไม่นับเป็นของเป้าหมาย)` : 'ไม่นับเป็นตำแหน่งของเป้าหมาย';
}
