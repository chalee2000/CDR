import type { RawSheet, RawWorkbook } from '../types';

/*
 * Deterministic FICTITIOUS CDR data in the exact layouts of the two operator
 * exports the app supports (AIS single sheet, DTAC multi-sheet). Every number,
 * IMSI, IMEI and site name is invented. The scenario is built so each analysis
 * has something to show:
 *
 *  A 0810000101 (AIS, Chiang Rai)  — phone change then a dual-SIM handset,
 *                                    Myanmar number behind a 69710 routing
 *                                    prefix, 3-day silence, relays via X1.
 *  B 0820000202 (AIS, Nakhon Sawan) — shares X1 with A and X2 with C, calls C
 *                                    directly, a late-night call burst, trip
 *                                    to Bangkok on 2026-08-20.
 *  C 0630000303 (DTAC, Songkhla)   — on-net peers (paired IMS records, and
 *                                    calls logged in BOTH the VOICE and IMS
 *                                    sheets), unanswered calls, Malaysian number, data
 *                                    trail with coordinates on a trip to
 *                                    Bangkok where it meets B, and a peer whose
 *                                    handset is A's old phone.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;
const BASE = Date.UTC(2026, 6, 1); // 2026-07-01 00:00 (wall clock)
const DAYS = 62; // through 2026-08-31

export const SAMPLE_TARGETS = { A: '0810000101', B: '0820000202', C: '0630000303' };
const X1 = '0860000111'; // shared by A and B
const X2 = '0950000222'; // shared by B and C, DTAC subscriber
const P404 = '0640000404'; // DTAC subscriber using A's old handset
const A_OLD_IMEI = '355555000010010';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const p2 = (n: number) => String(n).padStart(2, '0');
function parts(ts: number) {
  const d = new Date(ts);
  return {
    y: d.getUTCFullYear(),
    mo: p2(d.getUTCMonth() + 1),
    d: p2(d.getUTCDate()),
    h: p2(d.getUTCHours()),
    mi: p2(d.getUTCMinutes()),
    s: p2(d.getUTCSeconds()),
  };
}
/** AIS writes local clock time with a misleading "Z". */
const aisTime = (ts: number) => {
  const p = parts(ts);
  return `${p.y}-${p.mo}-${p.d}T${p.h}:${p.mi}:${p.s}.000Z`;
};
const dtacTime = (ts: number) => {
  const p = parts(ts);
  return `${p.y}-${p.mo}-${p.d} ${p.h}:${p.mi}:${p.s}`;
};
const intl66 = (n: string) => (n.startsWith('0') ? '66' + n.slice(1) : n);

interface Site {
  name: string;
  en: string;
  tumbol: string;
  amphur: string;
  province: string;
  region: string;
  tac: string;
  eci: string[];
  lat?: number;
  lon?: number;
}

// ---------------------------------------------------------------- A (AIS)
const A_SITES: Record<string, Site> = {
  home: { name: 'บ้านจำลองแม่สาย', en: 'Ban Jamlong Mae Sai', tumbol: 'เวียงพางคำ', amphur: 'แม่สาย', province: 'เชียงราย', region: 'NR', tac: '12901', eci: ['150900141', '150900142', '150900143'] },
  market: { name: 'ตลาดจำลองชายแดน', en: 'Border Market (sim)', tumbol: 'แม่สาย', amphur: 'แม่สาย', province: 'เชียงราย', region: 'NR', tac: '12901', eci: ['150900211', '150900212'] },
  pongpha: { name: 'บ้านจำลองโป่งผา', en: 'Ban Jamlong Pong Pha', tumbol: 'โป่งผา', amphur: 'แม่สาย', province: 'เชียงราย', region: 'NR', tac: '12901', eci: ['150900305'] },
  thalo: { name: 'จุดจำลองท่าล้อ', en: 'Tha Lo Point (sim)', tumbol: 'ห้วยไคร้', amphur: 'แม่สาย', province: 'เชียงราย', region: 'NR', tac: '12902', eci: ['150900406'] },
};

// ---------------------------------------------------------------- B (AIS)
const B_SITES: Record<string, Site> = {
  home: { name: 'หมู่บ้านจำลองนครสวรรค์', en: 'Moo Ban Jamlong NSW', tumbol: 'นครสวรรค์ตก', amphur: 'เมืองนครสวรรค์', province: 'นครสวรรค์', region: 'CR', tac: '22301', eci: ['220501101', '220501102'] },
  work: { name: 'โกดังจำลองริมน้ำ', en: 'Riverside Warehouse (sim)', tumbol: 'ปากน้ำโพ', amphur: 'เมืองนครสวรรค์', province: 'นครสวรรค์', region: 'CR', tac: '22301', eci: ['220501201', '220501203'] },
  chainat: { name: 'ปั๊มจำลองชัยนาท', en: 'Chai Nat Station (sim)', tumbol: 'บ้านกล้วย', amphur: 'เมืองชัยนาท', province: 'ชัยนาท', region: 'CR', tac: '22401', eci: ['220601301'] },
  bkk: { name: 'ตลาดจำลองจตุจักร', en: 'Chatuchak Market (sim)', tumbol: 'ลาดยาว', amphur: 'จตุจักร', province: 'กรุงเทพมหานคร', region: 'BKK', tac: '10001', eci: ['100101101'], lat: 13.7999, lon: 100.5507 },
};

// ---------------------------------------------------------------- C (DTAC)
const C_SITES: Record<string, Site> = {
  home: { name: 'หมู่บ้านจำลองหาดใหญ่', en: '', tumbol: 'คอหงส์', amphur: 'อำเภอหาดใหญ่', province: 'สงขลา', region: '', tac: '363', eci: ['SKA9001E_2NB01_S01', 'SKA9001E_2NB01_S02'], lat: 7.0086, lon: 100.4747 },
  shop: { name: 'ร้านจำลองตลาดกิมหยง', en: '', tumbol: 'หาดใหญ่', amphur: 'อำเภอหาดใหญ่', province: 'สงขลา', region: '', tac: '363', eci: ['SKA9002G_7NB01_S01'], lat: 7.0058, lon: 100.4689 },
  sadao: { name: 'ด่านจำลองสะเดา', en: '', tumbol: 'สำนักขาม', amphur: 'อำเภอสะเดา', province: 'สงขลา', region: '', tac: '364', eci: ['SKA9010G_7NB01_S02'], lat: 6.6386, lon: 100.4219 },
  phatthalung: { name: 'จุดจำลองพัทลุง', en: '', tumbol: 'คูหาสวรรค์', amphur: 'อำเภอเมืองพัทลุง', province: 'พัทลุง', region: '', tac: '371', eci: ['PLG9001E_2NB01_S01'], lat: 7.6167, lon: 100.0740 },
  nakhonsi: { name: 'จุดจำลองทุ่งสง', en: '', tumbol: 'ปากแพรก', amphur: 'อำเภอทุ่งสง', province: 'นครศรีธรรมราช', region: '', tac: '381', eci: ['NRT9001E_2NB01_S03'], lat: 8.1640, lon: 99.6800 },
  surat: { name: 'จุดจำลองพุนพิน', en: '', tumbol: 'ท่าข้าม', amphur: 'อำเภอพุนพิน', province: 'สุราษฎร์ธานี', region: '', tac: '391', eci: ['SNI9001E_2NB01_S01'], lat: 9.1100, lon: 99.2300 },
  chumphon: { name: 'จุดจำลองชุมพร', en: '', tumbol: 'ท่าตะเภา', amphur: 'อำเภอเมืองชุมพร', province: 'ชุมพร', region: '', tac: '401', eci: ['CPN9001E_2NB01_S02'], lat: 10.4930, lon: 99.1800 },
  prachuap: { name: 'จุดจำลองบางสะพาน', en: '', tumbol: 'กำเนิดนพคุณ', amphur: 'อำเภอบางสะพาน', province: 'ประจวบคีรีขันธ์', region: '', tac: '411', eci: ['PKN9001E_2NB01_S01'], lat: 11.2120, lon: 99.5100 },
  phetchaburi: { name: 'จุดจำลองชะอำ', en: '', tumbol: 'ชะอำ', amphur: 'อำเภอชะอำ', province: 'เพชรบุรี', region: '', tac: '421', eci: ['PBI9001E_2NB01_S01'], lat: 12.7990, lon: 99.9670 },
  bkk: { name: 'ตลาดจำลองจตุจักร', en: '', tumbol: 'ลาดยาว', amphur: 'จตุจักร', province: 'กรุงเทพมหานคร', region: '', tac: '501', eci: ['BKK9001E_2NB01_S01'], lat: 13.7999, lon: 100.5507 },
};
const C_ROUTE = ['home', 'phatthalung', 'nakhonsi', 'surat', 'chumphon', 'prachuap', 'phetchaburi', 'bkk'];

const AIS_HEADER = ['START_DATETIME', 'END_DATETIME', 'A_NUMBER', 'B_NUMBER', 'RECORD_TYPE', 'DURATION', 'IMSI', 'IMEI', 'LAC', 'CI', 'TAC', 'ECI', 'PLMN', 'LOCATION_NAME', 'SITE_NAME', 'REGION', 'PROVINCE', 'AMPHUR', 'TUMBOL'];

interface AisEvent {
  ts: number;
  type: 'MOC' | 'MTC' | 'SMO' | 'SMT';
  peer: string;
  dur: number;
  site: Site;
  imei: string;
  dupes?: number;
}

function aisRows(target: string, imsi: string, events: AisEvent[], rand: () => number): (string | null)[][] {
  const rows: (string | null)[][] = [AIS_HEADER];
  events.sort((x, y) => x.ts - y.ts);
  for (const e of events) {
    const call = e.type === 'MOC' || e.type === 'MTC';
    const eci = e.site.eci[Math.floor(rand() * e.site.eci.length)];
    const row = [aisTime(e.ts), call ? aisTime(e.ts + e.dur * 1000) : null, target, e.peer, e.type, String(call ? e.dur : 0), imsi, e.imei, '0', '0', e.site.tac, eci, '52003', e.site.en, e.site.name, e.site.region, e.site.province, e.site.amphur, e.site.tumbol];
    rows.push(row);
    for (let k = 0; k < (e.dupes ?? 0); k++) rows.push([...row]);
  }
  return rows;
}

function buildA(rand: () => number, relays: number[]): RawWorkbook {
  const ev: AisEvent[] = [];
  const imeiAt = (ts: number) => (ts < BASE + 14 * DAY ? A_OLD_IMEI : ts < BASE + 20 * DAY ? '866000000123450' : '866000000123460');
  const silenceFrom = BASE + 40 * DAY + 8 * HOUR; // 2026-08-10 08:00
  const silenceTo = BASE + 43 * DAY + 10 * HOUR; // 2026-08-13 10:00
  const push = (e: Omit<AisEvent, 'imei'>) => {
    if (e.ts >= silenceFrom && e.ts <= silenceTo) return;
    ev.push({ ...e, imei: imeiAt(e.ts) });
  };
  const siteAt = (h: number) => (h >= 20 || h < 7 ? A_SITES.home : rand() < 0.7 ? A_SITES.market : rand() < 0.5 ? A_SITES.pongpha : A_SITES.thalo);
  for (let d = 0; d < DAYS; d++) {
    const day = BASE + d * DAY;
    const nX1 = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < nX1; k++) {
      const h = 9 + Math.floor(rand() * 13);
      const ts = day + h * HOUR + Math.floor(rand() * 60) * MIN;
      push({ ts, type: rand() < 0.6 ? 'MOC' : 'MTC', peer: X1, dur: 20 + Math.floor(rand() * 240), site: siteAt(h) });
    }
    if (rand() < 0.5) {
      const h = 18 + Math.floor(rand() * 3);
      push({ ts: day + h * HOUR + Math.floor(rand() * 59) * MIN, type: 'MTC', peer: '0890000444', dur: 60 + Math.floor(rand() * 600), site: A_SITES.home });
    }
    if (rand() < 0.25) {
      const h = 22 + Math.floor(rand() * 2);
      push({ ts: day + h * HOUR + Math.floor(rand() * 59) * MIN, type: 'MOC', peer: '0870000333', dur: 15 + Math.floor(rand() * 90), site: A_SITES.home });
    }
    if (d % 9 === 3) {
      const raw = rand() < 0.5 ? '69710959400000555' : rand() < 0.5 ? '69705959400000555' : '959400000555';
      push({ ts: day + 13 * HOUR + Math.floor(rand() * 50) * MIN, type: 'MTC', peer: raw, dur: 30 + Math.floor(rand() * 200), site: A_SITES.market });
    }
    // Operator / service SMS, often split into several identical parts.
    const nSms = Math.floor(rand() * 4);
    for (let k = 0; k < nSms; k++) {
      const h = 7 + Math.floor(rand() * 14);
      push({ ts: day + h * HOUR + Math.floor(rand() * 3600) * 1000, type: 'SMT', peer: rand() < 0.7 ? 'AIS' : rand() < 0.5 ? '900515' : 'TrueMoney', dur: 0, site: siteAt(h), dupes: rand() < 0.4 ? 1 + Math.floor(rand() * 2) : 0 });
    }
    if (d % 15 === 7) push({ ts: day + 20 * HOUR + 5 * MIN, type: 'SMO', peer: '90149', dur: 0, site: A_SITES.home });
  }
  // Relay seeds: A calls X1, minutes later X1 calls B (generated in buildB).
  for (const t of relays) push({ ts: t, type: 'MOC', peer: X1, dur: 45 + Math.floor(rand() * 60), site: A_SITES.home });
  return { fileName: 'sample-ais-0810000101.xlsx', sheets: [{ name: 'Sheet1', rows: aisRows(SAMPLE_TARGETS.A, '520030000000101', ev, rand) }] };
}

function buildB(rand: () => number, relays: number[], bcCalls: { ts: number; out: boolean; dur: number }[], meet: number): RawWorkbook {
  const ev: AisEvent[] = [];
  const imei = '351111000020200';
  const push = (e: Omit<AisEvent, 'imei'>) => ev.push({ ...e, imei });
  const tripDay = 50; // 2026-08-20
  const siteAt = (d: number, h: number): Site => {
    if (d === tripDay) return h < 9 ? B_SITES.home : h < 11 ? B_SITES.chainat : B_SITES.bkk;
    if (d === tripDay + 1) return h < 12 ? B_SITES.bkk : h < 15 ? B_SITES.chainat : B_SITES.home;
    return h >= 8 && h < 17 && d % 7 < 5 ? B_SITES.work : B_SITES.home;
  };
  const others = ['0900000601', '0900000602', '0900000603', '0900000604', '0900000605', '0900000606', '0900000607'];
  for (let d = 0; d < DAYS; d++) {
    const day = BASE + d * DAY;
    const n = 2 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const h = 8 + Math.floor(rand() * 14);
      const peer = others[Math.floor(rand() * others.length)];
      push({ ts: day + h * HOUR + Math.floor(rand() * 60) * MIN, type: rand() < 0.5 ? 'MOC' : 'MTC', peer, dur: 10 + Math.floor(rand() * 300), site: siteAt(d, h) });
    }
    if (rand() < 0.35) {
      const h = 21 + Math.floor(rand() * 3);
      push({ ts: day + h * HOUR + Math.floor(rand() * 59) * MIN, type: rand() < 0.5 ? 'MOC' : 'MTC', peer: X2, dur: 30 + Math.floor(rand() * 400), site: siteAt(d, h) });
    }
    if (rand() < 0.2) {
      const h = 10 + Math.floor(rand() * 8);
      push({ ts: day + h * HOUR + Math.floor(rand() * 59) * MIN, type: 'MTC', peer: X1, dur: 20 + Math.floor(rand() * 120), site: siteAt(d, h) });
    }
    if (rand() < 0.5) {
      const h = 9 + Math.floor(rand() * 10);
      push({ ts: day + h * HOUR + Math.floor(rand() * 3600) * 1000, type: 'SMT', peer: rand() < 0.6 ? 'AIS' : 'KBank', dur: 0, site: siteAt(d, h), dupes: rand() < 0.3 ? 1 : 0 });
    }
  }
  // Late-night burst: six calls to different numbers within eight minutes.
  const burst = BASE + 35 * DAY + 23 * HOUR + 2 * MIN;
  others.slice(0, 6).forEach((p, i) => push({ ts: burst + i * 80 * 1000, type: 'MOC', peer: p, dur: 15 + i * 7, site: B_SITES.home }));
  // X1 calls B a few minutes after A called X1.
  for (const t of relays) push({ ts: t + (6 + Math.floor(rand() * 12)) * MIN, type: 'MTC', peer: X1, dur: 40 + Math.floor(rand() * 80), site: B_SITES.home });
  // Calls between B and C (also present in C's file).
  for (const c of bcCalls) push({ ts: c.ts, type: c.out ? 'MOC' : 'MTC', peer: SAMPLE_TARGETS.C, dur: c.dur, site: siteAt(Math.floor((c.ts - BASE) / DAY), new Date(c.ts).getUTCHours()) });
  // At the Bangkok market while C is there.
  push({ ts: meet + 4 * MIN, type: 'MOC', peer: X2, dur: 35, site: B_SITES.bkk });
  return { fileName: 'sample-ais-0820000202.xlsx', sheets: [{ name: 'Sheet1', rows: aisRows(SAMPLE_TARGETS.B, '520030000000202', ev, rand) }] };
}

// ---------------------------------------------------------------- DTAC builder
const C_IMSI = '520050000000303';
const C_IMEI = '356666000030300';
const C_IMEISV = '3566660000303005';
const ONNET: Record<string, { imsi: string; imei: string; site: Site }> = {
  [X2]: { imsi: '520050000000222', imei: '357777000022200', site: C_SITES.shop },
  [P404]: { imsi: '520050000000404', imei: A_OLD_IMEI, site: C_SITES.sadao },
};

function cellCols(site: Site | undefined, rand: () => number): (string | null)[] {
  if (!site) return ['-', '-', '-', '-', '-', '-', '-', '-', '-'];
  const cell = site.eci[Math.floor(rand() * site.eci.length)];
  return [site.tac, String(10000 + Math.floor(rand() * 50000)), site.name, cell, site.tumbol, site.amphur, site.province, String(site.lat ?? ''), String(site.lon ?? '')];
}

function buildC(rand: () => number, bcCalls: { ts: number; out: boolean; dur: number }[], meet: number): RawWorkbook {
  const T = intl66(SAMPLE_TARGETS.C);
  const tripStart = 48; // 2026-08-18
  const tripEnd = 52;
  const siteAt = (ts: number): Site => {
    const d = Math.floor((ts - BASE) / DAY);
    const h = new Date(ts).getUTCHours();
    if (d === tripStart) return C_SITES[C_ROUTE[Math.min(C_ROUTE.length - 1, Math.max(0, Math.floor((h - 6) / 2)))]];
    if (d > tripStart && d < tripEnd) return C_SITES.bkk;
    if (d === tripEnd) return C_SITES[C_ROUTE[Math.max(0, C_ROUTE.length - 1 - Math.max(0, Math.floor((h - 6) / 2)))]];
    if (h >= 10 && h < 18 && d % 7 === 2) return C_SITES.sadao;
    return h >= 9 && h < 19 && rand() < 0.5 ? C_SITES.shop : C_SITES.home;
  };

  const IMS_HEADER = ['START TIME', 'A NUMBER', 'B NUMBER', 'Duration', 'Event Type', 'LAC ID', 'CELL ID', 'IMSI', 'IMEI', 'Media type', 'AccessNetworkInfo', 'SITE_NAME', 'CELL_ID', 'TUMBON', 'AMPHUR', 'PROVINCE', 'LATITUDE', 'LONGITUDE'];
  const ims: (string | null)[][] = [IMS_HEADER];
  const imsRow = (ts: number, a: string, b: string, dur: number | null, role: string, imsi: string, imei: string, site: Site | undefined) => {
    const [lac, ci, name, cell, tumbol, amphur, province, lat, lon] = cellCols(site, rand);
    ims.push([dtacTime(ts), a, b, dur === null ? null : String(dur), role, lac, ci, imsi, imei, dur === null ? null : 'VoiceCall', rand() < 0.9 ? '3GPP-E-UTRAN-FDD' : '3GPP-E-UTRAN-TDD', name, cell, tumbol, amphur, province, lat, lon]);
  };
  const VOICE_HEADER = ['START TIME', 'A NUMBER', 'B NUMBER', 'DURATION', 'EVENT TYPE', 'LAC ID', 'CELL ID', 'IMEI', 'IMSI', 'INCOMING ROUTE', 'OUTGOING ROUTE', 'SITE_NAME', 'CELL_ID', 'TUMBON', 'AMPHUR', 'PROVINCE', 'LATITUDE', 'LONGITUDE'];
  const voice: (string | null)[][] = [VOICE_HEADER];
  /** A circuit-switched leg of the peer's own handset (VOICE sheet). */
  const voiceLeg = (ts: number, a: string, b: string, dur: number, type: 'MO' | 'MT', on: (typeof ONNET)[string]) => {
    const [lac, ci, name, cell, tumbol, amphur, province, lat, lon] = cellCols(on.site, rand);
    voice.push([dtacTime(ts), a, b, String(dur), type, lac, ci, on.imei, on.imsi, 'VMGSC2I', type === 'MO' ? 'ZTRACO' : '7G382CO', name, cell, tumbol, amphur, province, lat, lon]);
  };
  /**
   * One call: the target's VoLTE record plus, for an on-net peer, the peer's
   * own leg — logged in IMS, in VOICE, or in BOTH (the duplication the
   * parser must collapse). A VOICE leg of an unanswered attempt is written
   * several seconds after the IMS row, as in real exports.
   */
  const call = (ts: number, out: boolean, peer: string, dur: number | null) => {
    const a = out ? T : intl66(peer);
    const b = out ? intl66(peer) : T.startsWith('66') && rand() < 0.3 ? SAMPLE_TARGETS.C : T;
    imsRow(ts, a, b, dur, out ? 'ORIGINATING_ROLE' : 'TERMINATING_ROLE', C_IMSI, C_IMEI, siteAt(ts));
    const on = ONNET[peer];
    if (!on) return;
    const how = rand();
    if (how < 0.6 || how >= 0.85) {
      const lag = rand() < 0.2 ? 1000 : 0;
      imsRow(ts + lag, a, b, dur === null ? null : Math.max(0, dur - (lag ? 1 : 0)), out ? 'TERMINATING_ROLE' : 'ORIGINATING_ROLE', on.imsi, on.imei, on.site);
    }
    if (how >= 0.6) {
      const lag = dur === null ? (8 + Math.floor(rand() * 8)) * 1000 : 0;
      voiceLeg(ts + lag, a, b, dur === null ? 0 : dur + (rand() < 0.5 ? 1 : 0), out ? 'MT' : 'MO', on);
    }
  };

  const offnet = ['0910000505', '0920000606', '0930000707', '0940000808'];
  for (let d = 0; d < DAYS; d++) {
    const day = BASE + d * DAY;
    const n = 3 + Math.floor(rand() * 6);
    for (let k = 0; k < n; k++) {
      const h = 7 + Math.floor(rand() * 15);
      const ts = day + h * HOUR + Math.floor(rand() * 3600) * 1000;
      const r = rand();
      const peer = r < 0.35 ? X2 : r < 0.45 ? P404 : offnet[Math.floor(rand() * offnet.length)];
      const answered = rand() > 0.08;
      call(ts, rand() < 0.55, peer, answered ? 8 + Math.floor(rand() * 400) : null);
    }
    if (d % 11 === 5) call(day + 15 * HOUR + 20 * MIN, true, '60120000777', 60 + Math.floor(rand() * 120));
  }
  for (const c of bcCalls) call(c.ts, !c.out, SAMPLE_TARGETS.B, c.dur);
  call(meet - 10 * MIN, true, X2, 42);

  // VOICE (circuit-switched) — a few off-net calls plus forwarding to voicemail.
  for (let k = 0; k < 14; k++) {
    const ts = BASE + Math.floor(rand() * DAYS) * DAY + (9 + Math.floor(rand() * 10)) * HOUR + Math.floor(rand() * 3600) * 1000;
    const out = rand() < 0.5;
    const peer = offnet[Math.floor(rand() * offnet.length)];
    const [lac, ci, name, cell, tumbol, amphur, province, lat, lon] = cellCols(siteAt(ts), rand);
    voice.push([dtacTime(ts), out ? T : intl66(peer), out ? intl66(peer) : SAMPLE_TARGETS.C, String(rand() < 0.15 ? 0 : 5 + Math.floor(rand() * 200)), out ? 'MO' : 'MT', lac, ci, C_IMEI, C_IMSI, 'VMGSC2I', 'ZTRACO', name, cell, tumbol, amphur, province, lat, lon]);
  }
  for (let k = 0; k < 3; k++) {
    const ts = BASE + (10 + k * 17) * DAY + 14 * HOUR + k * 7 * MIN;
    voice.push([dtacTime(ts), T, '66800000', '0', 'CF', '-', '-', null, '520050000000999', 'VMGRB2I', 'ZTRACO', '-', '-', '-', '-', '-', '-', '-']);
  }

  // SMS — the export only carries SMS-MT, so the target's own outgoing SMS show
  // up only as the on-net recipient's record.
  const SMS_HEADER = ['START TIME', 'A NUMBER', 'B NUMBER', 'EVENT TYPE', 'LAC ID', 'CELL ID', 'IMEI', 'IMSI', 'SITE_NAME', 'CELL_ID', 'TUMBON', 'AMPHUR', 'PROVINCE', 'LATITUDE', 'LONGITUDE'];
  const sms: (string | null)[][] = [SMS_HEADER];
  for (let d = 0; d < DAYS; d++) {
    const day = BASE + d * DAY;
    const n = Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const ts = day + (8 + Math.floor(rand() * 13)) * HOUR + Math.floor(rand() * 3600) * 1000;
      const [lac, ci, name, cell, tumbol, amphur, province, lat, lon] = cellCols(siteAt(ts), rand);
      sms.push([dtacTime(ts), rand() < 0.6 ? 'dtac' : rand() < 0.5 ? 'KBank' : intl66(X2), T, 'SMS-MT', lac, ci, C_IMEI, C_IMSI, name, cell, tumbol, amphur, province, lat, lon]);
    }
    if (d % 6 === 1) {
      const ts = day + 20 * HOUR + Math.floor(rand() * 3600) * 1000;
      const on = ONNET[X2];
      const [lac, ci, name, cell, tumbol, amphur, province, lat, lon] = cellCols(on.site, rand);
      sms.push([dtacTime(ts), T, intl66(X2), 'SMS-MT', lac, ci, on.imei, on.imsi, name, cell, tumbol, amphur, province, lat, lon]);
    }
  }

  // DATA sessions — dense trail, two-hourly partial records plus short bursts.
  const DATA_HEADER = ['START TIME', 'A NUMBER', 'DURATION', 'LAC ID', 'CELL ID', 'VOLUME', 'IP ADDRESS', 'IMEI', 'IMSI', 'SITE_NAME', 'CELL_ID', 'TUMBON', 'AMPHUR', 'PROVINCE', 'PUBLIC LAND MOBILE NETWORK', 'LATITUDE', 'LONGITUDE'];
  const data: (string | null)[][] = [DATA_HEADER];
  for (let d = 0; d < DAYS; d++) {
    const day = BASE + d * DAY;
    const travelling = d >= tripStart && d <= tripEnd;
    for (let h = 0; h < 24; h += travelling ? 1 : 2) {
      const ts = day + h * HOUR + (travelling ? Math.floor(rand() * 40) * MIN : 0);
      const [lac, ci, name, cell, tumbol, amphur, province, lat, lon] = cellCols(siteAt(ts), rand);
      data.push([dtacTime(ts), T, String(travelling ? 60 + Math.floor(rand() * 900) : 7200), lac, ci, String(Math.floor(rand() * 5_000_000)), rand() < 0.2 ? `100.64.${Math.floor(rand() * 255)}.${Math.floor(rand() * 255)}` : null, C_IMEISV, C_IMSI, name, cell, tumbol, amphur, province, '52005', lat, lon]);
    }
  }
  const meetData = cellCols(C_SITES.bkk, rand);
  data.push([dtacTime(meet), T, '420', meetData[0], meetData[1], '1834221', null, C_IMEISV, C_IMSI, meetData[2], meetData[3], meetData[4], meetData[5], meetData[6], '52005', meetData[7], meetData[8]]);

  const WIFI_HEADER = ['Acct-Start-Time', 'UserName', 'Calling-Station-ID', 'Acct-Session-ID', 'Acc-Status-Type', 'Acct-Session-Time', 'Acct-Input-Octets', 'Acct-Output-Octets', 'Acct-End-Time', 'Location', 'TUMBON', 'AMPHUR', 'PROVINCE', 'Framed-IP-Address', 'IMSI', 'Called-Station-ID', 'IMEI'];
  const wStart = BASE + 30 * DAY + 19 * HOUR + 4 * MIN;
  const wifi: (string | null)[][] = [
    WIFI_HEADER,
    [dtacTime(wStart), T, SAMPLE_TARGETS.C, 'SIMSESSION0001', '1', '0', null, null, dtacTime(wStart), 'EAP_SIM-HDY_E1', 'UNKNOW', 'UNKNOW', 'UNKNOW', '10.200.1.20', C_IMSI, 'securessid', C_IMEI],
    [dtacTime(wStart), T, SAMPLE_TARGETS.C, 'SIMSESSION0001', '2', '640', '251000', '3120000', dtacTime(wStart + 640_000), 'EAP_SIM-HDY_E1', 'UNKNOW', 'UNKNOW', 'UNKNOW', '10.200.1.20', C_IMSI, 'securessid', null],
  ];

  const sortBody = (rows: (string | null)[][]) => [rows[0], ...rows.slice(1).sort((x, y) => String(x[0]).localeCompare(String(y[0])))];
  const count = (rows: unknown[]) => `Show ${rows.length - 1} records.`;
  const info: RawSheet = {
    name: 'Info',
    rows: [
      ['ข้อมูลสมมติสำหรับทดสอบโปรแกรม — ไม่ใช่ข้อมูลจริง', null],
      [null, null],
      [null, null],
      ['Period of data:', '2026/07/01 00:00:00 to 2026/08/31 23:59:59'],
      ['Search by:', `MSISDN=${T}`],
      ['Service:', 'VOICE service,DATA service,SMS service,IMS service,WIFI Service'],
      ['Result:', null],
      ['VOICE service:', count(voice)],
      ['DATA service:', count(data)],
      ['SMS service:', count(sms)],
      ['IMS service:', count(ims)],
      ['WIFI Service:', count(wifi)],
    ],
  };
  return {
    fileName: 'sample-dtac-0630000303.xlsx',
    sheets: [
      info,
      { name: 'VOICE service', rows: sortBody(voice) },
      { name: 'DATA service', rows: sortBody(data) },
      { name: 'SMS service', rows: sortBody(sms) },
      { name: 'IMS service', rows: sortBody(ims) },
      { name: 'WIFI Service', rows: wifi },
    ],
  };
}

export function generateSamples(seed = 20260701): RawWorkbook[] {
  const rand = mulberry32(seed);
  const relays = [5, 12, 19, 26, 33, 47, 54].map((d) => BASE + d * DAY + 21 * HOUR + Math.floor(rand() * 30) * MIN);
  const bcCalls = [3, 9, 17, 24, 31, 38, 45, 58].map((d) => ({
    ts: BASE + d * DAY + (10 + Math.floor(rand() * 9)) * HOUR + Math.floor(rand() * 3600) * 1000,
    out: rand() < 0.5,
    dur: 25 + Math.floor(rand() * 300),
  }));
  const meet = BASE + 50 * DAY + 14 * HOUR + 3 * MIN; // 2026-08-20 14:03
  return [buildA(rand, relays), buildB(rand, relays, bcCalls, meet), buildC(rand, bcCalls, meet)];
}
