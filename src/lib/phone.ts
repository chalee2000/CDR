import type { PeerKind } from './types';

export interface PhoneInfo {
  /** Key used to group the same party across records and files. */
  key: string;
  kind: PeerKind;
  /** Thai country name for international numbers. */
  country?: string;
}

// Country calling codes most relevant to Thai cases (neighbours first).
// Longest prefix wins, so 3-digit codes are checked before 2- and 1-digit ones.
const COUNTRY_CODES: Record<string, string> = {
  '95': 'เมียนมา',
  '856': 'ลาว',
  '855': 'กัมพูชา',
  '60': 'มาเลเซีย',
  '84': 'เวียดนาม',
  '86': 'จีน',
  '852': 'ฮ่องกง',
  '853': 'มาเก๊า',
  '886': 'ไต้หวัน',
  '65': 'สิงคโปร์',
  '62': 'อินโดนีเซีย',
  '63': 'ฟิลิปปินส์',
  '673': 'บรูไน',
  '670': 'ติมอร์-เลสเต',
  '91': 'อินเดีย',
  '880': 'บังกลาเทศ',
  '92': 'ปากีสถาน',
  '94': 'ศรีลังกา',
  '977': 'เนปาล',
  '81': 'ญี่ปุ่น',
  '82': 'เกาหลีใต้',
  '850': 'เกาหลีเหนือ',
  '61': 'ออสเตรเลีย',
  '64': 'นิวซีแลนด์',
  '971': 'สหรัฐอาหรับเอมิเรตส์',
  '966': 'ซาอุดีอาระเบีย',
  '974': 'กาตาร์',
  '968': 'โอมาน',
  '965': 'คูเวต',
  '972': 'อิสราเอล',
  '90': 'ตุรกี',
  '98': 'อิหร่าน',
  '44': 'สหราชอาณาจักร',
  '49': 'เยอรมนี',
  '33': 'ฝรั่งเศส',
  '39': 'อิตาลี',
  '34': 'สเปน',
  '31': 'เนเธอร์แลนด์',
  '41': 'สวิตเซอร์แลนด์',
  '46': 'สวีเดน',
  '47': 'นอร์เวย์',
  '45': 'เดนมาร์ก',
  '48': 'โปแลนด์',
  '380': 'ยูเครน',
  '234': 'ไนจีเรีย',
  '27': 'แอฟริกาใต้',
  '55': 'บราซิล',
  '52': 'เม็กซิโก',
  '1': 'สหรัฐฯ/แคนาดา',
  '7': 'รัสเซีย/คาซัคสถาน',
};

// Thai international dialling prefixes (IDD) that may precede a foreign number.
const THAI_IDD = ['001', '007', '008', '009'];

function matchCountry(digits: string): { cc: string; country: string } | undefined {
  for (const len of [3, 2, 1]) {
    const cc = digits.slice(0, len);
    const country = COUNTRY_CODES[cc];
    if (!country) continue;
    // Single-digit codes collide with domestic short numbers; demand a full
    // E.164-length number before accepting them.
    if (len === 1 && digits.length < 11) continue;
    return { cc, country };
  }
  return undefined;
}

function international(digits: string): PhoneInfo | undefined {
  if (digits.length < 9 || digits.length > 15) return undefined;
  const m = matchCountry(digits);
  if (!m) return undefined;
  return { key: '+' + digits, kind: 'intl', country: m.country };
}

/** Classify a Thai national-format number (leading 0). */
function thaiNational(n: string): PhoneInfo {
  if (/^0[689]\d{8}$/.test(n)) return { key: n, kind: 'mobile' };
  if (/^0[2-7]\d{7}$/.test(n)) return { key: n, kind: 'landline' };
  if (/^0\d{8,9}$/.test(n)) return { key: n, kind: 'other' };
  return { key: n, kind: 'other' };
}

/**
 * Normalise a party identifier from any Thai operator export so the same
 * person groups together: "66810000101", "0810000101" and "+66 81 000 0101"
 * all become "0810000101". The raw value is kept separately by callers.
 */
export function normalizeNumber(raw: string | null | undefined, opts: { restoreLeadingZero?: boolean } = {}): PhoneInfo {
  const restoreLeadingZero = opts.restoreLeadingZero ?? true;
  if (raw == null) return { key: '', kind: 'none' };
  let s = String(raw).trim();
  if (s === '' || s === '-' || s.toLowerCase() === 'null' || s.toLowerCase() === 'nan') {
    return { key: '', kind: 'none' };
  }

  // SIP URIs: keep the user part if it is a number.
  const sip = /^sips?:([^@;]+)/i.exec(s);
  if (sip) {
    const user = sip[1].replace(/^\+/, '');
    if (!/^\d+$/.test(user)) return { key: s, kind: 'other' };
    s = user;
  }

  const plus = s.startsWith('+');
  const compact = s.replace(/[\s\-().]/g, '').replace(/^\+/, '');

  if (/[*#]/.test(compact)) return { key: compact, kind: 'other' };

  if (/[^0-9]/.test(compact)) {
    const letters = (compact.match(/[A-Za-z฀-๿]/g) ?? []).length;
    const digits = (compact.match(/\d/g) ?? []).length;
    // "B56800000"-style routing artefacts are not service sender names.
    if (letters <= 1 && digits >= 6) return { key: compact, kind: 'other' };
    return { key: s, kind: 'alpha' };
  }

  let d = compact;
  if (plus) {
    if (d.startsWith('66')) d = '0' + d.slice(2);
    else return international(d) ?? { key: '+' + d, kind: 'other' };
  }

  if (d.startsWith('00')) {
    const idd = THAI_IDD.find((p) => d.startsWith(p) && d.length > p.length + 6);
    const rest = idd ? d.slice(idd.length) : d.slice(2);
    if (rest.startsWith('66')) d = '0' + rest.slice(2);
    else return international(rest) ?? { key: d, kind: 'other' };
  }

  // Some operators prepend a 5-digit routing prefix (e.g. 69710 / 69705) to
  // inbound international CLIs: 69710959400000555 -> +959400000555.
  if (/^697\d\d/.test(d) && d.length >= 14) {
    const intl = international(d.slice(5));
    if (intl) return intl;
  }

  if (d.startsWith('66')) {
    if (d.length === 11) return thaiNational('0' + d.slice(2));
    if (d.length === 10) return thaiNational('0' + d.slice(2));
    if (d.length === 6 && d[2] === '1') return { key: d.slice(2), kind: 'shortcode' };
    if (d.length <= 8) return { key: d, kind: 'shortcode' };
  }

  if (d.startsWith('0')) return thaiNational(d);

  // Mobile number whose leading zero was lost when stored as a numeric cell.
  // Not applied to exports that already write numbers as text (DTAC), where a
  // bare 9-digit value is a routing/service number instead.
  if (restoreLeadingZero && d.length === 9 && /^[689]/.test(d)) return thaiNational('0' + d);

  if (d.length >= 10) {
    const intl = international(d);
    if (intl) return intl;
  }

  if (d.length <= 8) return { key: d, kind: 'shortcode' };
  return { key: d, kind: 'other' };
}

/**
 * True for subscriber numbers (people/organisations one actually talks to).
 * Short codes, sender names and unrecognised technical identifiers are
 * service traffic and stay out of the person network by default.
 */
export function isPersonKind(kind: PeerKind): boolean {
  return kind === 'mobile' || kind === 'landline' || kind === 'intl';
}

/** Human-friendly rendering: 0812345678 -> 081-234-5678, +95... kept as is. */
export function formatNumber(key: string | undefined): string {
  if (!key) return '-';
  if (/^0[689]\d{8}$/.test(key)) return `${key.slice(0, 3)}-${key.slice(3, 6)}-${key.slice(6)}`;
  if (/^02\d{7}$/.test(key)) return `${key.slice(0, 2)}-${key.slice(2, 5)}-${key.slice(5)}`;
  if (/^0[3-7]\d{7}$/.test(key)) return `${key.slice(0, 3)}-${key.slice(3, 6)}-${key.slice(6)}`;
  return key;
}

/** Map a PLMN code (MCC+MNC) to the Thai operator brand. */
export function operatorFromPlmn(plmn: string | undefined): string | undefined {
  if (!plmn) return undefined;
  const p = plmn.trim();
  if (p === '52001' || p === '52003' || p === '52023') return 'AIS';
  if (p === '52005' || p === '52018') return 'DTAC';
  if (p === '52004' || p === '52099' || p === '52000') return 'TrueMove H';
  if (p === '52015' || p === '52047') return 'NT';
  return undefined;
}
