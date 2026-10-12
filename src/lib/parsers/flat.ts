import type { ColumnMapping, FlatField, Interaction, Observation, RawSheet, SheetStat, ZMode } from '../types';
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
      notes,
      zMode,
      hasCoordinates,
    },
  };
}
