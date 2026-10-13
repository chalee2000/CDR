import { imeiCore } from '../imei';
import type { ColumnMapping, FlatField, ImsiCheck, ImsiOwners, Interaction, Observation, RawSheet, SheetStat, ZMode } from '../types';
import { normalizeNumber, operatorFromPlmn } from '../phone';
import { parseDateAndClock, parseWallClock } from '../time';
import { clean, countBy, mode, toNumber } from '../util';
import { makeCell, rowSignature } from './table';
import { classifyDirection, classifyType, invert } from './typecodes';
import type { DatasetDraft } from './index';

const AIS_HEADERS = ['START_DATETIME', 'A_NUMBER', 'B_NUMBER', 'RECORD_TYPE', 'DURATION', 'IMSI', 'IMEI', 'ECI', 'SITE_NAME', 'TUMBOL'];

export function looksLikeAis(headers: (string | null)[]): boolean {
  const set = new Set(headers.map((h) => String(h ?? '').trim().toUpperCase()));
  return AIS_HEADERS.every((h) => set.has(h));
}

/** Choose the target: the dominant served number, else the most frequent party overall. */
export function detectFlatTarget(aKeys: string[], bKeys: string[]): string | undefined {
  const aCounts = countBy(aKeys, (k) => k || undefined);
  const topA = mode(aKeys, (k) => k || undefined);
  if (topA && (aCounts.get(topA) ?? 0) >= 0.6 * aKeys.filter(Boolean).length) return topA;
  return mode([...aKeys, ...bKeys], (k) => k || undefined);
}

export function parseFlatSheet(
  sheet: RawSheet,
  mapping: Pick<ColumnMapping, 'headerRow' | 'columns' | 'target'>,
  fileName: string,
  zMode: ZMode,
  imsiOwners: ImsiOwners = {},
): DatasetDraft {
  const cols = mapping.columns;
  const get = (row: (string | null)[], f: FlatField): string | null => {
    const i = cols[f];
    return i === undefined ? null : (row[i] ?? null);
  };
  const headerRow = sheet.rows[mapping.headerRow] ?? [];
  const isAis = looksLikeAis(headerRow);

  const body = sheet.rows.slice(mapping.headerRow + 1);
  const aKeys = body.map((r) => normalizeNumber(get(r, 'a')).key);
  const bKeys = body.map((r) => normalizeNumber(get(r, 'b')).key);
  const target = mapping.target ? normalizeNumber(mapping.target).key : (detectFlatTarget(aKeys, bKeys) ?? '');

  const stat: SheetStat = {
    sheet: sheet.name,
    rows: body.length,
    used: 0,
    skippedNoTime: 0,
    peerOwned: 0,
    noLocation: 0,
    unknownTypes: {},
    duplicates: 0,
  };
  const interactions: Interaction[] = [];
  const seen = new Set<string>();
  let zSeen = false;
  let notInvolving = 0;
  let hasCoordinates = false;

  body.forEach((row, i) => {
    if (row.every((c) => c == null || String(c).trim() === '')) {
      stat.rows--;
      return;
    }
    const rowNo = mapping.headerRow + 1 + i + 1; // 1-based Excel row number
    const rawTime = get(row, 'time');
    if (rawTime && /z$/i.test(rawTime.trim())) zSeen = true;
    const ts = cols.time !== undefined ? parseWallClock(rawTime, zMode) : parseDateAndClock(get(row, 'date'), get(row, 'clock'), zMode);
    if (Number.isNaN(ts)) {
      stat.skippedNoTime++;
      return;
    }

    const sig = rowSignature(row);
    const dup = seen.has(sig);
    if (dup) stat.duplicates++;
    else seen.add(sig);

    const rawType = clean(get(row, 'type')) ?? '';
    const t = classifyType(rawType);
    if (rawType && !t.known) stat.unknownTypes[rawType] = (stat.unknownTypes[rawType] ?? 0) + 1;
    const explicitDir = classifyDirection(get(row, 'direction'));
    const servedDir = explicitDir ?? t.direction;

    const aKey = aKeys[i];
    const bKey = bKeys[i];
    let direction = servedDir ?? 'na';
    let peerRaw: string | null;
    let targetIsServed = true;
    if (aKey === target) {
      peerRaw = get(row, 'b');
      if (!servedDir) direction = 'out';
    } else if (bKey === target) {
      peerRaw = get(row, 'a');
      targetIsServed = !t.known; // row is the other party's record in a combined file
      direction = t.known ? (invert(servedDir) ?? 'na') : explicitDir ? invert(explicitDir)! : 'in';
    } else {
      peerRaw = get(row, 'b');
      notInvolving++;
    }
    const peer = normalizeNumber(peerRaw);

    let service = t.service;
    if (!t.known && rawType === '' && peer.kind !== 'none') service = 'call';

    const end = parseWallClock(get(row, 'end'), zMode);
    let durationSec = toNumber(get(row, 'duration'));
    if (durationSec === undefined && !Number.isNaN(end)) durationSec = Math.max(0, Math.round((end - ts) / 1000));

    const cell = makeCell({
      lac: get(row, 'lac'),
      ci: get(row, 'ci'),
      tac: get(row, 'tac'),
      eci: get(row, 'eci'),
      cellName: get(row, 'cellName'),
      site: get(row, 'site'),
      location: get(row, 'location'),
      tumbol: get(row, 'tumbol'),
      amphur: get(row, 'amphur'),
      province: get(row, 'province'),
      region: get(row, 'region'),
      lat: get(row, 'lat'),
      lon: get(row, 'lon'),
    });
    if (!cell) stat.noLocation++;
    if (cell?.lat !== undefined) hasCoordinates = true;
    const obs: Observation = {};
    const imsi = clean(get(row, 'imsi'));
    const imei = clean(get(row, 'imei'));
    if (imsi) obs.imsi = imsi;
    if (imei) obs.imei = imei;
    if (cell) obs.cell = cell;

    const it: Interaction = {
      id: interactions.length,
      ts,
      service,
      direction: service === 'data' ? 'na' : direction,
      peerKind: peer.kind,
      rawType,
      source: 'FLAT',
      rowRefs: [`${sheet.name}!${rowNo}`],
    };
    if (!Number.isNaN(end) && end >= ts) it.endTs = end;
    if (durationSec !== undefined) it.durationSec = durationSec;
    if (service === 'call' && durationSec !== undefined && direction !== 'fwd') it.answered = durationSec > 0;
    if (peer.key && service !== 'data') {
      it.peer = peer.key;
      it.peerRaw = clean(peerRaw);
      if (peer.country) it.peerCountry = peer.country;
    }
    if (targetIsServed) it.targetObs = obs;
    else {
      it.peerObs = obs;
      stat.peerOwned++;
    }
    if (dup) it.dupOfPrev = true;
    interactions.push(it);
    stat.used++;
  });

  // ---- One SIM per target: the IMSI used most in the target's own rows.
  // A row with any other IMSI was written for another subscriber, so its
  // cell and handset (IMEI) are the other party's, not the target's.
  const autoMain = mode(interactions, (it) => it.targetObs?.imsi);
  const isTargetSim = (imsi: string) => (imsiOwners[imsi] ? imsiOwners[imsi] === 'target' : imsi === autoMain);
  let foreign = 0;
  for (const it of interactions) {
    const imsi = it.targetObs?.imsi;
    if (!imsi || isTargetSim(imsi)) continue;
    it.peerObs = it.targetObs;
    delete it.targetObs;
    stat.peerOwned++;
    foreign++;
  }
  const imsiCheck = flatImsiCheck(interactions, target, autoMain, imsiOwners);
  const manual = imsiCheck.filter((c) => c.basis === 'manual').length;

  const plmn = mode(body, (r) => clean(get(r, 'plmn')));
  const operator = operatorFromPlmn(plmn) ?? (isAis ? 'AIS' : undefined);
  const notes: string[] = [];
  if (!hasCoordinates) {
    notes.push('ไฟล์ไม่มีพิกัดเสา (LATITUDE/LONGITUDE) แผนที่จะแสดงตำแหน่งโดยประมาณระดับจังหวัด เว้นแต่จะนำเข้าไฟล์พิกัดเสาเพิ่มเติม');
  }
  if (zSeen) {
    notes.push(
      zMode === 'local'
        ? 'เวลาในไฟล์ลงท้ายด้วย "Z" แต่ถือเป็นเวลาไทยตามที่เขียนไว้ (เปลี่ยนได้ที่การตั้งค่า "การตีความเวลา")'
        : 'เวลาในไฟล์ลงท้ายด้วย "Z" และถูกแปลงจาก UTC เป็นเวลาไทย (+7 ชม.)',
    );
  }
  if (stat.duplicates > 0) {
    notes.push(`พบแถวที่ซ้ำกันทุกคอลัมน์ ${stat.duplicates} แถว (ส่วนใหญ่มักเป็น SMS ที่ถูกแบ่งเป็นหลายท่อน) ยังนับรวมอยู่ เว้นแต่เปิดตัวเลือก "รวมแถวซ้ำ"`);
  }
  if (notInvolving > 0) {
    notes.push(`มี ${notInvolving} แถวที่ทั้งฝั่ง A และ B ไม่ใช่หมายเลขเป้าหมาย`);
  }
  if (foreign > 0) {
    const others = imsiCheck.filter((c) => c.owner === 'peer' && c.imsi).length;
    notes.push(
      `เป้าหมายใช้ IMSI เดียว แต่ไฟล์มี IMSI อื่นอีก ${others} ค่า (${foreign.toLocaleString('th-TH')} แถว) แถวเหล่านี้ถือเป็นของคู่สาย ทั้งพิกัดและเครื่อง (IMEI) จึงไม่นับเป็นของเป้าหมาย (ดูตาราง "ตรวจเจ้าของพิกัดจาก IMSI")`,
    );
  }
  if (manual > 0) notes.push(`ผู้ใช้กำหนดเจ้าของ IMSI เอง ${manual} ค่า (แทนผลที่ระบบตัดสิน) พิกัดและเครื่องของซิมเหล่านี้นับตามที่กำหนด`);

  return {
    fileName,
    target,
    interactions,
    meta: {
      format: isAis ? 'ais' : 'flat',
      formatLabel: isAis ? `ตารางเดียวแบบ AIS${operator && operator !== 'AIS' ? ` (${operator})` : ''}` : 'ตารางเดียว (จับคู่หัวคอลัมน์อัตโนมัติ)',
      operator,
      sheets: [stat],
      targetImsis: [...new Set(interactions.filter((x) => x.targetObs?.imsi).map((x) => x.targetObs!.imsi!))],
      ...(imsiCheck.length ? { imsiCheck } : {}),
      notes,
      zMode,
      hasCoordinates,
    },
  };
}

/** Every SIM in a single-table file, whose it is, and where its positions are counted. */
function flatImsiCheck(interactions: Interaction[], target: string, autoMain: string | undefined, imsiOwners: ImsiOwners): ImsiCheck[] {
  const sims = new Map<string, { rows: number; withCell: number; mine: boolean; numbers: Map<string, number>; imeis: Map<string, number>; firstTs: number; lastTs: number }>();
  for (const it of interactions) {
    const obs = it.targetObs ?? it.peerObs;
    if (!obs?.imsi) continue;
    let t = sims.get(obs.imsi);
    if (!t) {
      t = { rows: 0, withCell: 0, mine: !!it.targetObs, numbers: new Map(), imeis: new Map(), firstTs: it.ts, lastTs: it.ts };
      sims.set(obs.imsi, t);
    }
    t.rows++;
    if (obs.cell) t.withCell++;
    if (it.peerObs === obs && it.peer) t.numbers.set(it.peer, (t.numbers.get(it.peer) ?? 0) + 1);
    const core = imeiCore(obs.imei);
    if (core) t.imeis.set(core, (t.imeis.get(core) ?? 0) + 1);
    t.firstTs = Math.min(t.firstTs, it.ts);
    t.lastTs = Math.max(t.lastTs, it.ts);
  }
  if (sims.size === 0) return [];
  return [...sims]
    .map(([imsi, t]): ImsiCheck => {
      const owner = t.mine ? 'target' : 'peer';
      const auto = imsi === autoMain ? 'target' : 'peer';
      const number = owner === 'target' ? target : [...t.numbers].sort((x, y) => y[1] - x[1])[0]?.[0];
      return {
        imsi,
        owner,
        ...(number ? { number } : {}),
        basis: imsiOwners[imsi] && imsiOwners[imsi] !== auto ? 'manual' : auto === 'target' ? 'main' : 'other',
        auto,
        inData: false,
        imeis: [...t.imeis].sort((x, y) => y[1] - x[1]).map(([e]) => e),
        rows: t.rows,
        withCell: t.withCell,
        firstTs: t.firstTs,
        lastTs: t.lastTs,
      };
    })
    .sort((x, y) => (x.owner === y.owner ? y.rows - x.rows : x.owner === 'target' ? -1 : 1));
}
