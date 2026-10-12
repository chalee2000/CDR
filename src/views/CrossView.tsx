import { useMemo } from 'react';
import { coLocations, commonContacts, directLinks, relayChains, sharedDevices, type CoLocation, type CommonContact, type DirectLink, type RelayChain, type SharedDevice } from '../lib/analysis/cross';
import { CoordResolver } from '../lib/analysis/locations';
import { PEER_KIND_TH } from '../lib/labels';
import { fmtDate, fmtDateTime, fmtDuration, fmtTime, isoText } from '../lib/time';
import { fmtInt } from '../lib/util';
import { DataTable, type Column } from '../components/DataTable';
import { Caveat, NumberLink, Section, Swatch } from '../components/bits';
import { useStore } from '../state/store';

export function CrossView() {
  const { datasets, settings, coordImport } = useStore();
  const byId = useMemo(() => new Map(datasets.map((d) => [d.id, d])), [datasets]);
  const direct = useMemo(() => directLinks(datasets, settings), [datasets, settings]);
  const common = useMemo(() => commonContacts(datasets, settings), [datasets, settings]);
  const relays = useMemo(() => relayChains(datasets, settings), [datasets, settings]);
  const devices = useMemo(() => sharedDevices(datasets, settings), [datasets, settings]);
  const coloc = useMemo(() => coLocations(datasets, settings, new CoordResolver(coordImport?.coords)), [datasets, settings, coordImport]);
  const y = settings.yearStyle;

  if (datasets.length < 2) {
    return (
      <div className="note">
        ต้องมีไฟล์อย่างน้อย 2 เป้าหมายจึงจะวิเคราะห์ความเชื่อมโยงข้ามเป้าหมายได้ (ผู้ติดต่อร่วม การติดต่อกันโดยตรง ลำดับการติดต่อทอด อุปกรณ์ร่วม และการอยู่พื้นที่เดียวกัน)
      </div>
    );
  }

  const tag = (id: string, target: string) => {
    const d = byId.get(id);
    return (
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} className="nowrap">
        {d && <Swatch slot={d.slot} round />}
        <span className="mono">{target}</span>
      </span>
    );
  };

  const directCols: Column<DirectLink>[] = [
    { key: 'from', header: 'จากไฟล์ของ', render: (l) => tag(l.fromId, l.fromTarget), sortValue: (l) => l.fromTarget },
    { key: 'to', header: 'ติดต่อกับเป้าหมาย', render: (l) => tag(l.toId, l.toTarget), sortValue: (l) => l.toTarget },
    { key: 'n', header: 'รวม', num: true, render: (l) => fmtInt(l.events), sortValue: (l) => l.events },
    { key: 'calls', header: 'โทร', num: true, render: (l) => fmtInt(l.calls), sortValue: (l) => l.calls },
    { key: 'sms', header: 'SMS', num: true, render: (l) => fmtInt(l.sms), sortValue: (l) => l.sms },
    { key: 'talk', header: 'เวลาสนทนา', num: true, render: (l) => fmtDuration(l.talkSec), sortValue: (l) => l.talkSec },
    { key: 'first', header: 'ครั้งแรก', render: (l) => fmtDateTime(l.firstTs, y), sortValue: (l) => l.firstTs, csv: (l) => isoText(l.firstTs) },
    { key: 'last', header: 'ล่าสุด', render: (l) => fmtDateTime(l.lastTs, y), sortValue: (l) => l.lastTs, csv: (l) => isoText(l.lastTs) },
  ];
  const commonCols: Column<CommonContact>[] = [
    { key: 'peer', header: 'ผู้ติดต่อร่วม', render: (c) => <NumberLink peer={c.peer} kind={c.kind} country={c.country} />, sortValue: (c) => c.peer },
    { key: 'kind', header: 'ประเภท', render: (c) => PEER_KIND_TH[c.kind], sortValue: (c) => c.kind },
    { key: 'nt', header: 'จำนวนเป้าหมาย', num: true, render: (c) => c.perTarget.length, sortValue: (c) => c.perTarget.length },
    { key: 'total', header: 'รวม', num: true, render: (c) => fmtInt(c.total), sortValue: (c) => c.total },
    {
      key: 'per',
      header: 'แยกตามเป้าหมาย (ครั้ง · ช่วงเวลา)',
      render: (c) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {c.perTarget.map((p) => (
            <span key={p.datasetId} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {tag(p.datasetId, p.target)}
              <span>
                {fmtInt(p.total)} ครั้ง · {fmtDate(p.firstTs, y)} – {fmtDate(p.lastTs, y)}
              </span>
            </span>
          ))}
        </div>
      ),
      csv: (c) => c.perTarget.map((p) => `${p.target}:${p.total}`).join(' '),
    },
    { key: 'ov', header: 'ช่วงเวลาทับกัน', render: (c) => (c.overlap ? 'ใช่' : 'ไม่'), sortValue: (c) => Number(c.overlap) },
  ];
  const relayCols: Column<RelayChain>[] = [
    { key: 't1', header: 'เวลา 1', render: (r) => <span className="nowrap">{fmtDateTime(r.first.ts, y)}</span>, sortValue: (r) => r.first.ts, csv: (r) => isoText(r.first.ts) },
    { key: 'a', header: 'เป้าหมาย 1', render: (r) => tag(r.first.datasetId, r.first.target), sortValue: (r) => r.first.target },
    { key: 'e1', header: 'รายการ 1', render: (r) => r.first.label, sortValue: (r) => r.first.label },
    { key: 'via', header: 'ผ่าน', render: (r) => <NumberLink peer={r.via} />, sortValue: (r) => r.via },
    { key: 't2', header: 'เวลา 2', render: (r) => <span className="nowrap">{fmtTime(r.second.ts)}</span>, sortValue: (r) => r.second.ts, csv: (r) => isoText(r.second.ts) },
    { key: 'b', header: 'เป้าหมาย 2', render: (r) => tag(r.second.datasetId, r.second.target), sortValue: (r) => r.second.target },
    { key: 'e2', header: 'รายการ 2', render: (r) => r.second.label, sortValue: (r) => r.second.label },
    { key: 'gap', header: 'ห่าง (นาที)', num: true, render: (r) => r.gapMin.toFixed(1), sortValue: (r) => r.gapMin },
    { key: 'flow', header: 'ทิศทางต่อเนื่อง', render: (r) => (r.flow ? <span className="badge warn">1 → X → 2</span> : ''), sortValue: (r) => Number(r.flow), csv: (r) => (r.flow ? 'ใช่' : '') },
  ];
  const deviceRows = devices.flatMap((d) => d.uses.map((u) => ({ d, u })));
  const deviceCols: Column<{ d: SharedDevice; u: SharedDevice['uses'][number] }>[] = [
    { key: 'kind', header: 'ชนิด', render: (x) => x.d.kind, sortValue: (x) => x.d.kind },
    { key: 'value', header: 'ค่า', render: (x) => <span className="mono">{x.d.value}</span>, sortValue: (x) => x.d.value },
    { key: 'num', header: 'เลขหมายที่ใช้', render: (x) => <NumberLink peer={x.u.number} />, sortValue: (x) => x.u.number },
    { key: 'role', header: 'พบในฐานะ', render: (x) => (x.u.role === 'target' ? 'เป้าหมาย' : 'คู่สาย'), sortValue: (x) => x.u.role },
    { key: 'file', header: 'จากไฟล์ของ', render: (x) => tag(x.u.datasetId, x.u.target), sortValue: (x) => x.u.target },
    { key: 'n', header: 'ครั้ง', num: true, render: (x) => fmtInt(x.u.count), sortValue: (x) => x.u.count },
    { key: 'first', header: 'ครั้งแรก', render: (x) => fmtDateTime(x.u.firstTs, y), sortValue: (x) => x.u.firstTs, csv: (x) => isoText(x.u.firstTs) },
    { key: 'last', header: 'ล่าสุด', render: (x) => fmtDateTime(x.u.lastTs, y), sortValue: (x) => x.u.lastTs, csv: (x) => isoText(x.u.lastTs) },
  ];
  const colocCols: Column<CoLocation>[] = [
    { key: 'day', header: 'วันที่', render: (c) => fmtDate(Date.parse(c.day), y), sortValue: (c) => c.day },
    { key: 'a', header: 'เป้าหมาย A', render: (c) => tag(c.aId, c.aTarget), sortValue: (c) => c.aTarget },
    { key: 'sa', header: 'เสาของ A', render: (c) => c.siteA, sortValue: (c) => c.siteA },
    { key: 'b', header: 'เป้าหมาย B', render: (c) => tag(c.bId, c.bTarget), sortValue: (c) => c.bTarget },
    { key: 'sb', header: 'เสาของ B', render: (c) => c.siteB, sortValue: (c) => c.siteB },
    { key: 'from', header: 'ช่วงเวลา', render: (c) => `${fmtTime(c.firstTs)}–${fmtTime(c.lastTs)}`, sortValue: (c) => c.firstTs, csv: (c) => `${isoText(c.firstTs)} - ${isoText(c.lastTs)}` },
    { key: 'n', header: 'คู่ที่ตรงกัน', num: true, render: (c) => fmtInt(c.matches), sortValue: (c) => c.matches },
    { key: 'gap', header: 'ห่างน้อยสุด (นาที)', num: true, render: (c) => c.minGapMin.toFixed(1), sortValue: (c) => c.minGapMin },
    { key: 'km', header: 'ระยะ (กม.)', num: true, render: (c) => (c.distanceKm !== undefined ? c.distanceKm.toFixed(2) : 'เสาเดียวกัน'), sortValue: (c) => c.distanceKm ?? 0 },
  ];

  return (
    <>
      <Section title="การติดต่อกันโดยตรงระหว่างเป้าหมาย" sub="นับจากไฟล์ของแต่ละฝ่าย (การติดต่อเดียวกันอาจปรากฏในทั้งสองไฟล์)">
        <DataTable label="การติดต่อกันโดยตรง" rows={direct} columns={directCols} initialSort={{ key: 'n', dir: 'desc' }} empty="ไม่พบการติดต่อกันโดยตรงระหว่างเป้าหมาย" csvName="direct-links" />
      </Section>
      <Section title="ผู้ติดต่อร่วม" sub={`เลขหมายที่ติดต่อกับเป้าหมายตั้งแต่ 2 รายขึ้นไป${settings.includeServiceNumbers ? ' (รวมเลขบริการ)' : ' (เฉพาะเลขหมายบุคคล)'}`}>
        <DataTable label="ผู้ติดต่อร่วม" rows={common} columns={commonCols} initialSort={{ key: 'nt', dir: 'desc' }} empty="ไม่พบผู้ติดต่อร่วม" csvName="common-contacts" />
      </Section>
      <Section title={`ลำดับการติดต่อทอด (ภายใน ${settings.relayMinutes} นาที) — Candidate`} sub="เป้าหมาย 1 ติดต่อกับ X แล้ว X ติดต่อกับเป้าหมาย 2 ภายในเวลาที่กำหนด">
        <DataTable label="ลำดับการติดต่อทอด" rows={relays} columns={relayCols} initialSort={{ key: 't1', dir: 'asc' }} pageSize={25} empty="ไม่พบลำดับการติดต่อทอดตามเกณฑ์" csvName="relay-chains" />
        <div style={{ marginTop: 8 }}>
          <Caveat>ลำดับเวลาที่ตรงกันไม่ได้พิสูจน์ว่ามีการส่งต่อข้อมูลหรือคำสั่ง ("1 → X → 2" หมายถึงเป้าหมาย 1 เป็นฝ่ายโทร/ส่งหา X แล้ว X เป็นฝ่ายโทร/ส่งหาเป้าหมาย 2)</Caveat>
        </div>
      </Section>
      <Section title="อุปกรณ์หรือซิมร่วม" sub="IMEI/IMSI เดียวกันปรากฏกับเลขหมายต่างกัน (รวมเครื่องของคู่สายที่ผู้ให้บริการแนบมา)">
        <DataTable label="อุปกรณ์ร่วม" rows={deviceRows} columns={deviceCols} initialSort={{ key: 'value', dir: 'asc' }} empty="ไม่พบอุปกรณ์หรือซิมที่ใช้ร่วมกัน" csvName="shared-devices" />
      </Section>
      <Section title={`อยู่ในพื้นที่เดียวกัน ± ${settings.coLocationMinutes} นาที — Co-location Candidate`} sub={`เสาเดียวกัน หรือห่างกันไม่เกิน ${settings.coLocationKm} กม. เมื่อมีพิกัดจริงทั้งสองฝ่าย`}>
        <DataTable label="อยู่พื้นที่เดียวกัน" rows={coloc} columns={colocCols} initialSort={{ key: 'day', dir: 'asc' }} pageSize={25} empty="ไม่พบช่วงที่อยู่พื้นที่เดียวกันตามเกณฑ์" csvName="co-location" />
        <div style={{ marginTop: 8 }}>
          <Caveat>การใช้เสาเดียวกันไม่ได้ยืนยันว่าอยู่ด้วยกัน เสาหนึ่งครอบคลุมพื้นที่กว้าง และผู้ให้บริการต่างรายใช้ชื่อเสาต่างกัน</Caveat>
        </div>
      </Section>
    </>
  );
}
