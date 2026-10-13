import writeXlsxFile from 'write-excel-file/universal';
import type { Sheet } from 'write-excel-file/universal';
import { activeInteractions, datasetName } from '../dataset';
import { PEER_KIND_TH, SOURCE_TH, imsiBasisTh, imsiUseTh, interactionLabel } from '../labels';
import { isoText } from '../time';
import type { Dataset, Settings } from '../types';
import { allBursts, simultaneousBursts, type CallBurst } from '../analysis/bursts';
import { contactStats } from '../analysis/contacts';
import { coLocations, commonContacts, directLinks, relayChains, sharedDevices } from '../analysis/cross';
import { deviceStats } from '../analysis/devices';
import { CoordResolver, siteLabelOf, siteStats, stays, type ImportedCoords } from '../analysis/locations';
import { buildNetwork, DEFAULT_NETWORK_OPTIONS } from '../analysis/network';
import { summarize } from '../analysis/summary';
import { personName, recordLines, type ProfileMap } from '../profiles';

type Cell = string | number | null;
type Table = { sheet: string; header: string[]; rows: Cell[][]; widths?: number[] };

const text = (v: string | undefined | null) => v ?? '';

/** Every analysis as plain tables (pure; also used by tests). */
export function analysisTables(datasets: Dataset[], settings: Settings, imported?: ImportedCoords, profiles: ProfileMap = {}): Table[] {
  const resolver = new CoordResolver(imported);
  const tables: Table[] = [];
  const nameOf = (n: string | undefined) => (n ? text(personName(profiles[n])) : '');

  tables.push({
    sheet: 'สรุป',
    header: ['เป้าหมาย', 'ชื่อเรียก', 'ไฟล์', 'รูปแบบ', 'ผู้ให้บริการ', 'ตั้งแต่', 'ถึง', 'จำนวนวัน', 'วันที่มีกิจกรรม', 'รายการ', 'โทรออก', 'โทรเข้า', 'โทรไม่สำเร็จ', 'เวลาสนทนารวม (วินาที)', 'ส่ง SMS', 'รับ SMS', 'Data session', 'ปริมาณข้อมูล (ไบต์)', 'ผู้ติดต่อ (บุคคล)', 'ผู้ติดต่อ (บริการ)', 'เลขต่างประเทศ', 'IMSI', 'IMEI (14 หลักแรก)', 'จำนวนเสา', 'จังหวัด'],
    rows: datasets.map((ds) => {
      const s = summarize(ds, settings);
      return [ds.target, ds.label, ds.fileName, ds.meta.formatLabel, text(ds.meta.operator), isoText(s.firstTs), isoText(s.lastTs), s.spanDays, s.activeDays, s.records, s.callsOut, s.callsIn, s.callsUnanswered, s.talkSec, s.smsOut, s.smsIn, s.dataSessions, s.dataBytes, s.contactsPerson, s.contactsService, s.intlContacts, s.imsis.join(', '), s.imeiCores.join(', '), s.sites, s.provinces.join(', ')];
    }),
  });

  tables.push({
    sheet: 'คู่ติดต่อ',
    header: ['เป้าหมาย', 'คู่ติดต่อ', 'ชื่อ (ข้อมูลบุคคล)', 'ประเภทเลข', 'ประเทศ', 'ค่าดิบในไฟล์', 'รวม', 'โทรออก', 'โทรเข้า', 'ไม่สำเร็จ', 'เวลาสนทนา (วินาที)', 'นานสุด (วินาที)', 'ส่ง SMS', 'รับ SMS', 'จำนวนวัน', 'กลางคืน', 'ครั้งแรก', 'ล่าสุด', 'IMEI คู่สาย', 'เสาของคู่สาย'],
    rows: datasets.flatMap((ds) =>
      contactStats(ds, settings).map((c) => [ds.target, c.peer, nameOf(c.peer), PEER_KIND_TH[c.kind], text(c.country), c.rawValues.join(' | '), c.total, c.callsOut, c.callsIn, c.unanswered, c.talkSec, c.maxTalkSec, c.smsOut, c.smsIn, c.activeDays, c.night, isoText(c.firstTs), isoText(c.lastTs), c.peerImeis.join(', '), c.peerSites.join(', ')]),
    ),
  });

  tables.push({
    sheet: 'เสาสัญญาณ',
    header: ['เป้าหมาย', 'เสา/สถานี', 'ชื่ออังกฤษ', 'ตำบล', 'อำเภอ', 'จังหวัด', 'ละติจูด', 'ลองจิจูด', 'ที่มาของพิกัด', 'เซลล์', 'ครั้ง', 'โทร/SMS', 'Data', 'กลางวัน', 'กลางคืน', 'จำนวนวัน', 'ครั้งแรก', 'ล่าสุด'],
    rows: datasets.flatMap((ds) =>
      siteStats(ds, settings, resolver).map((s) => [ds.target, s.label, text(s.locationName), text(s.tumbol), text(s.amphur), text(s.province), s.coord?.lat ?? null, s.coord?.lon ?? null, s.coord ? (s.coord.source === 'file' ? 'จากไฟล์' : s.coord.source === 'import' ? 'นำเข้า' : 'ประมาณจากจังหวัด') : '', s.cells.join(', '), s.count, s.commCount, s.dataCount, s.dayCount, s.nightCount, s.days, isoText(s.firstTs), isoText(s.lastTs)]),
    ),
  });

  tables.push({
    sheet: 'การเดินทาง',
    header: ['เป้าหมาย', 'จังหวัด', 'ตั้งแต่', 'ถึง', 'จำนวนรายการ'],
    rows: datasets.flatMap((ds) => stays(ds, settings, 'province').map((s) => [ds.target, s.area, isoText(s.from), isoText(s.to), s.count])),
  });

  tables.push({
    sheet: 'อุปกรณ์',
    header: ['เป้าหมาย', 'ชนิด', 'ค่า', 'IMEI 15 หลัก (คำนวณ check digit)', 'TAC', 'ค่าดิบในไฟล์', 'ครั้ง', 'ครั้งแรก', 'ล่าสุด'],
    rows: datasets.flatMap((ds) => {
      const d = deviceStats(ds, settings);
      return [
        ...d.imeis.map((x) => [ds.target, 'IMEI', x.core, x.imei15, x.tac, x.rawValues.join(', '), x.count, isoText(x.firstTs), isoText(x.lastTs)] as Cell[]),
        ...d.imsis.map((x) => [ds.target, 'IMSI', x.imsi, '', '', '', x.count, isoText(x.firstTs), isoText(x.lastTs)] as Cell[]),
      ];
    }),
  });

  tables.push({
    sheet: 'ผู้ติดต่อร่วม',
    header: ['คู่ติดต่อ', 'ประเภทเลข', 'จำนวนเป้าหมาย', 'ช่วงเวลาทับกัน', 'เป้าหมาย', 'รวม', 'โทร', 'SMS', 'ครั้งแรก', 'ล่าสุด'],
    rows: commonContacts(datasets, settings).flatMap((c) => c.perTarget.map((p) => [c.peer, PEER_KIND_TH[c.kind], c.perTarget.length, c.overlap ? 'ใช่' : 'ไม่', p.target, p.total, p.calls, p.sms, isoText(p.firstTs), isoText(p.lastTs)])),
  });

  tables.push({
    sheet: 'ติดต่อตรงระหว่างเป้าหมาย',
    header: ['ไฟล์ของเป้าหมาย', 'คู่ติดต่อ (เป้าหมายอื่น)', 'รวม', 'โทร', 'SMS', 'เวลาสนทนา (วินาที)', 'ครั้งแรก', 'ล่าสุด'],
    rows: directLinks(datasets, settings).map((l) => [l.fromTarget, l.toTarget, l.events, l.calls, l.sms, l.talkSec, isoText(l.firstTs), isoText(l.lastTs)]),
  });

  tables.push({
    sheet: 'ลำดับการติดต่อทอด',
    header: ['ผ่านคู่ติดต่อ', 'เป้าหมายที่ 1', 'เวลา 1', 'รายการ 1', 'เป้าหมายที่ 2', 'เวลา 2', 'รายการ 2', 'ห่างกัน (นาที)', 'ทิศทางต่อเนื่อง'],
    rows: relayChains(datasets, settings).map((r) => [r.via, r.first.target, isoText(r.first.ts), r.first.label, r.second.target, isoText(r.second.ts), r.second.label, Math.round(r.gapMin * 10) / 10, r.flow ? 'ใช่' : '']),
  });

  const bursts = allBursts(datasets, settings);
  const peerList = (b: CallBurst) => b.peers.map((p) => `${p.peer}${nameOf(p.peer) ? ` (${nameOf(p.peer)})` : ''} ×${p.count}`).join(', ');
  tables.push({
    sheet: 'การติดต่อถี่',
    header: ['เป้าหมาย', 'เริ่ม', 'สิ้นสุด', 'นาที', 'จำนวนครั้ง', 'โทรออก', 'โทรเข้า', 'SMS', 'เวลาสนทนา (วินาที)', 'จำนวนคู่ติดต่อ', 'คู่ติดต่อ (ครั้ง)', 'เสาที่ปรากฏมาก', 'กลางคืน', 'เกณฑ์'],
    rows: bursts.map((b) => [b.target, isoText(b.from), isoText(b.to), Math.round(b.minutes * 10) / 10, b.count, b.callsOut, b.callsIn, b.sms, b.talkSec, b.peers.length, peerList(b), text(b.topSite), b.night ? 'ใช่' : '', `≥${settings.burstCount} ครั้ง/${settings.burstMinutes} นาที ${settings.burstSms ? 'โทร+SMS' : 'เฉพาะโทร'}`]),
  });
  const together = simultaneousBursts(bursts, settings.burstMinutes);
  if (together.length) {
    tables.push({
      sheet: 'ติดต่อถี่พร้อมกัน',
      header: ['เป้าหมาย 1', 'เริ่ม 1', 'สิ้นสุด 1', 'ครั้ง 1', 'เป้าหมาย 2', 'เริ่ม 2', 'สิ้นสุด 2', 'ครั้ง 2', 'ซ้อนกัน (นาที)', 'ห่างกัน (นาที)', 'คู่ติดต่อร่วม', 'ติดต่อกันเอง'],
      rows: together.map((p) => [p.a.target, isoText(p.a.from), isoText(p.a.to), p.a.count, p.b.target, isoText(p.b.from), isoText(p.b.to), p.b.count, Math.round(p.overlapMin * 10) / 10, Math.round(p.gapMin * 10) / 10, p.sharedPeers.join(', '), p.direct ? 'ใช่' : '']),
    });
  }

  tables.push({
    sheet: 'อยู่พื้นที่เดียวกัน',
    header: ['เป้าหมาย A', 'เป้าหมาย B', 'วันที่', 'เสาของ A', 'เสาของ B', 'ตั้งแต่', 'ถึง', 'จำนวนคู่ที่ตรงกัน', 'ห่างกันน้อยสุด (นาที)', 'ระยะ (กม.)'],
    rows: coLocations(datasets, settings, resolver).map((c) => [c.aTarget, c.bTarget, c.day, c.siteA, c.siteB, isoText(c.firstTs), isoText(c.lastTs), c.matches, Math.round(c.minGapMin * 10) / 10, c.distanceKm !== undefined ? Math.round(c.distanceKm * 100) / 100 : null]),
  });

  tables.push({
    sheet: 'อุปกรณ์ร่วม',
    header: ['ชนิด', 'ค่า', 'เลขหมายที่ใช้', 'บทบาท', 'จากไฟล์ของ', 'ครั้ง', 'ครั้งแรก', 'ล่าสุด'],
    rows: sharedDevices(datasets, settings).flatMap((d) => d.uses.map((u) => [d.kind, d.value, u.number, u.role === 'target' ? 'เป้าหมาย' : 'คู่สาย', u.target, u.count, isoText(u.firstTs), isoText(u.lastTs)])),
  });

  const net = buildNetwork(datasets, settings, { ...DEFAULT_NETWORK_OPTIONS, topN: 0 });
  tables.push({
    sheet: 'เครือข่าย_โหนด',
    header: ['โหนด', 'ชื่อ (ข้อมูลบุคคล)', 'เป็นเป้าหมาย', 'ประเภท', 'Degree', 'Weighted degree', 'Betweenness (normalized)', 'PageRank', 'Community', 'ติดต่อกับเป้าหมาย'],
    rows: net.nodes.map((n) => [n.id, nameOf(n.id), n.isTarget ? 'ใช่' : '', n.kind === 'target' ? 'เป้าหมาย' : PEER_KIND_TH[n.kind], n.degree, n.weightedDegree, Math.round(n.betweenness * 10000) / 10000, Math.round(n.pagerank * 10000) / 10000, n.community + 1, n.datasetIds.length]),
  });
  tables.push({
    sheet: 'เครือข่าย_เส้น',
    header: ['Source', 'Target', 'รวม', 'Source→Target', 'Target→Source', 'โทร', 'SMS', 'เวลาสนทนา (วินาที)', 'ครั้งแรก', 'ล่าสุด'],
    rows: net.edges.map((e) => [e.source, e.target, e.events, e.ab, e.ba, e.calls, e.sms, e.talkSec, isoText(e.firstTs), isoText(e.lastTs)]),
  });

  tables.push({
    sheet: 'รายการทั้งหมด',
    header: ['เป้าหมาย', 'วันเวลา', 'ประเภท', 'คู่ติดต่อ', 'ประเภทเลข', 'ค่าดิบ', 'ระยะเวลา (วินาที)', 'ปริมาณข้อมูล (ไบต์)', 'เสาของเป้าหมาย', 'อำเภอ', 'จังหวัด', 'เซลล์', 'IMEI', 'IMSI', 'เสาของคู่สาย', 'แหล่ง', 'แถวในไฟล์ต้นฉบับ', 'แถวซ้ำ'],
    rows: datasets.flatMap((ds) =>
      activeInteractions(ds, settings).map((it) => {
        const c = it.targetObs?.cell;
        return [ds.target, isoText(it.ts), interactionLabel(it), text(it.peer), it.peer ? PEER_KIND_TH[it.peerKind] : '', text(it.peerRaw), it.durationSec ?? null, it.bytes ?? null, c ? siteLabelOf(c).label : '', text(c?.amphur), text(c?.province), text(c?.cellId), text(it.targetObs?.imei), text(it.targetObs?.imsi), it.peerObs?.cell ? siteLabelOf(it.peerObs.cell).label : '', SOURCE_TH[it.source], it.rowRefs.join(', '), it.dupOfPrev ? 'ใช่' : ''];
      }),
    ),
  });

  const people = Object.values(profiles).sort((a, b) => a.number.localeCompare(b.number));
  if (people.length) {
    tables.push({
      sheet: 'ข้อมูลบุคคล',
      header: ['เลขหมาย', 'ชื่อ', 'นามสกุล', 'ชื่อเล่น/ฉายา', 'ที่อยู่', 'ประวัติคดีอาญา', 'จำนวนคดี', 'หมายเหตุ', 'มีรูป', 'แก้ไขล่าสุด', 'ที่มา'],
      rows: people.map((p) => [p.number, text(p.firstName), text(p.lastName), text(p.nickname), text(p.address), recordLines(p).join(' | '), recordLines(p).length, text(p.notes), p.photo ? 'มี' : '', p.updatedAt ? isoText(p.updatedAt) : '', 'ผู้ใช้กรอกเอง (ไม่ได้มาจากไฟล์ CDR)']),
    });
  }

  const sims = datasets.flatMap((ds) => (ds.meta.imsiCheck ?? []).map((c) => ({ ds, c })));
  if (sims.length) {
    tables.push({
      sheet: 'ตรวจเจ้าของพิกัด_IMSI',
      header: ['เป้าหมาย', 'IMSI', 'เป็นของ', 'เลขหมายที่ใช้ซิมนี้', 'IMEI ที่ใช้กับซิมนี้', 'แถว', 'แถวที่มีพิกัด', 'ใช้พิกัดเป็น', 'ครั้งแรก', 'ล่าสุด', 'เหตุผล'],
      rows: sims.map(({ ds, c }) => [
        ds.target,
        c.imsi || '(ไม่มี IMSI)',
        (c.owner === 'target' ? 'เป้าหมาย' : c.basis === 'review' ? 'คู่สาย (ควรตรวจสอบ)' : 'คู่สาย') + (c.basis === 'manual' ? ' (กำหนดเอง)' : ''),
        text(c.number),
        c.imeis.join(' '),
        c.rows,
        c.withCell,
        imsiUseTh(c),
        isoText(c.firstTs),
        isoText(c.lastTs),
        imsiBasisTh(c),
      ]),
    });
  }

  tables.push({
    sheet: 'คุณภาพข้อมูล',
    header: ['เป้าหมาย', 'ชีต', 'แถว', 'ใช้ได้', 'เวลาอ่านไม่ได้', 'แถวซ้ำ', 'แถวของคู่สาย', 'ไม่มีตำแหน่ง', 'ประเภทที่ไม่รู้จัก'],
    rows: [
      ...datasets.flatMap((ds) =>
        ds.meta.sheets.map((s) => [ds.target, s.sheet, s.rows, s.used, s.skippedNoTime, s.duplicates, s.peerOwned, s.noLocation, Object.entries(s.unknownTypes).map(([k, v]) => `${k}:${v}`).join(', ')] as Cell[]),
      ),
      ...datasets.flatMap((ds) => ds.meta.notes.map((n) => [ds.target, 'หมายเหตุ', n, null, null, null, null, null, null] as Cell[])),
    ],
  });

  return tables;
}

function toSheet(t: Table): Sheet<Blob> {
  return {
    sheet: t.sheet.slice(0, 31),
    stickyRowsCount: 1,
    columns: t.header.map((h) => ({ width: Math.min(40, Math.max(10, h.length + 4)) })),
    data: [t.header.map((h) => ({ value: h, fontWeight: 'bold' as const })), ...t.rows.map((r) => r.map((v) => (v === null || v === '' ? null : v)))],
  };
}

export async function exportAnalysisXlsx(datasets: Dataset[], settings: Settings, imported?: ImportedCoords, profiles: ProfileMap = {}): Promise<Blob> {
  const sheets = analysisTables(datasets, settings, imported, profiles).map(toSheet);
  return writeXlsxFile(sheets, { fontFamily: 'Tahoma', fontSize: 10 }).toBlob();
}

export function exportFileName(datasets: Dataset[]): string {
  const names = datasets.map((d) => datasetName(d).replace(/[^\w฀-๿-]+/g, '_')).slice(0, 3);
  return `CDR-analysis_${names.join('_') || 'empty'}.xlsx`;
}
