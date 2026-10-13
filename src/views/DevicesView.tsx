import { useMemo } from 'react';
import { deviceStats, type DeviceRun, type DeviceUse, type ImsiUse, type PeerDevice } from '../lib/analysis/devices';
import { sharedDevices } from '../lib/analysis/cross';
import { fmtDateTime, isoText } from '../lib/time';
import { fmtInt } from '../lib/util';
import { DataTable, type Column } from '../components/DataTable';
import { Caveat, DatasetPicker, NumberLink, Section } from '../components/bits';
import { useStore } from '../state/store';

export function DevicesView() {
  const { selected: ds, settings, datasets } = useStore();
  const d = useMemo(() => (ds ? deviceStats(ds, settings) : undefined), [ds, settings]);
  const shared = useMemo(() => sharedDevices(datasets, settings), [datasets, settings]);
  if (!ds || !d) return null;
  const y = settings.yearStyle;
  const mine = new Set([...d.imeis.map((x) => x.core), ...d.imsis.map((x) => x.imsi)]);
  const sharedMine = shared.filter((s) => mine.has(s.value));

  const imeiCols: Column<DeviceUse>[] = [
    { key: 'core', header: 'IMEI (14 หลักแรก)', render: (x) => <span className="mono">{x.core}</span>, sortValue: (x) => x.core },
    { key: 'i15', header: 'IMEI 15 หลัก (คำนวณ check digit)', render: (x) => <span className="mono">{x.imei15}</span>, sortValue: (x) => x.imei15 },
    { key: 'tac', header: 'TAC (รุ่นเครื่อง)', render: (x) => <span className="mono">{x.tac}</span>, sortValue: (x) => x.tac },
    { key: 'raw', header: 'ค่าในไฟล์', render: (x) => <span className="mono">{x.rawValues.join(', ')}</span>, csv: (x) => x.rawValues.join(' ') },
    { key: 'imsi', header: 'ใช้กับซิม (IMSI)', render: (x) => <span className="mono">{x.imsis.join(', ') || '-'}</span>, csv: (x) => x.imsis.join(' ') },
    { key: 'n', header: 'ครั้ง', num: true, render: (x) => fmtInt(x.count), sortValue: (x) => x.count },
    { key: 'days', header: 'จำนวนวัน', num: true, render: (x) => fmtInt(x.days), sortValue: (x) => x.days },
    { key: 'first', header: 'ใช้ครั้งแรก', render: (x) => fmtDateTime(x.firstTs, y), sortValue: (x) => x.firstTs, csv: (x) => isoText(x.firstTs) },
    { key: 'last', header: 'ใช้ล่าสุด', render: (x) => fmtDateTime(x.lastTs, y), sortValue: (x) => x.lastTs, csv: (x) => isoText(x.lastTs) },
  ];
  const imsiCols: Column<ImsiUse>[] = [
    { key: 'imsi', header: 'IMSI', render: (x) => <span className="mono">{x.imsi}</span>, sortValue: (x) => x.imsi },
    { key: 'n', header: 'ครั้ง', num: true, render: (x) => fmtInt(x.count), sortValue: (x) => x.count },
    { key: 'first', header: 'ครั้งแรก', render: (x) => fmtDateTime(x.firstTs, y), sortValue: (x) => x.firstTs, csv: (x) => isoText(x.firstTs) },
    { key: 'last', header: 'ล่าสุด', render: (x) => fmtDateTime(x.lastTs, y), sortValue: (x) => x.lastTs, csv: (x) => isoText(x.lastTs) },
  ];
  const runCols: Column<DeviceRun>[] = [
    { key: 'core', header: 'IMEI (14 หลักแรก)', render: (x) => <span className="mono">{x.core}</span>, sortValue: (x) => x.core },
    { key: 'from', header: 'ตั้งแต่', render: (x) => fmtDateTime(x.from, y), sortValue: (x) => x.from, csv: (x) => isoText(x.from) },
    { key: 'to', header: 'ถึง', render: (x) => fmtDateTime(x.to, y), sortValue: (x) => x.to, csv: (x) => isoText(x.to) },
    { key: 'n', header: 'รายการ', num: true, render: (x) => fmtInt(x.count), sortValue: (x) => x.count },
  ];
  const peerCols: Column<PeerDevice>[] = [
    { key: 'peer', header: 'คู่สาย', render: (x) => <NumberLink peer={x.peer} />, sortValue: (x) => x.peer },
    { key: 'core', header: 'IMEI (14 หลักแรก)', render: (x) => <span className="mono">{x.core}</span>, sortValue: (x) => x.core },
    { key: 'imsi', header: 'IMSI', render: (x) => <span className="mono">{x.imsi ?? '-'}</span>, sortValue: (x) => x.imsi },
    { key: 'n', header: 'ครั้ง', num: true, render: (x) => fmtInt(x.count), sortValue: (x) => x.count },
  ];

  return (
    <>
      <DatasetPicker />
      {(d.imeis.length > 1 || d.dualSim.length > 0 || sharedMine.length > 0) && (
        <div className="note warn">
          <strong>ข้อสังเกตด้านอุปกรณ์</strong>
          <ul>
            {d.imeis.length > 1 && (
              <li>
                ซิมนี้ปรากฏกับเครื่อง {d.imeis.length} เครื่อง (เปลี่ยนเครื่อง {d.switches} ครั้งตามลำดับเวลา) — ควรตรวจสอบว่าเป็นการเปลี่ยนเครื่องจริงหรือสลับช่องซิม
              </li>
            )}
            {d.dualSim.map(([a, b]) => (
              <li key={a + b}>
                IMEI <span className="mono">{a}</span> และ <span className="mono">{b}</span> เป็นรุ่นเดียวกันและเลขเรียงติดกัน อาจเป็นเครื่องเดียวกันแบบ 2 ซิม (Candidate)
              </li>
            ))}
            {sharedMine.map((s) => (
              <li key={s.kind + s.value}>
                {s.kind} <span className="mono">{s.value}</span> ปรากฏกับหลายเลขหมาย: {s.uses.map((u) => `${u.number} (${u.role === 'target' ? 'เป้าหมาย' : `คู่สายในไฟล์ ${u.target}`})`).join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Section title="เครื่องโทรศัพท์ (IMEI) ที่ใช้กับซิมเป้าหมาย" sub="เทียบด้วย 14 หลักแรก เพราะผู้ให้บริการบันทึก check digit / IMEISV ต่างกัน">
        <DataTable label="IMEI" rows={d.imeis} columns={imeiCols} initialSort={{ key: 'first', dir: 'asc' }} csvName={`imei-${ds.target}`} empty="ไม่มีข้อมูล IMEI" />
      </Section>
      <div className="grid two">
        <Section title="ซิม (IMSI)">
          <DataTable label="IMSI" rows={d.imsis} columns={imsiCols} initialSort={{ key: 'first', dir: 'asc' }} empty="ไม่มีข้อมูล IMSI" />
        </Section>
        <Section title="ลำดับการใช้เครื่อง" sub="แต่ละแถวคือช่วงที่ใช้เครื่องเดิมต่อเนื่องกัน">
          <DataTable label="ลำดับการใช้เครื่อง" rows={d.runs} columns={runCols} initialSort={{ key: 'from', dir: 'asc' }} pageSize={15} />
        </Section>
      </div>
      {d.peerDevices.length > 0 && (
        <Section title="เครื่องของคู่สายที่ปรากฏในไฟล์" sub="มีเฉพาะไฟล์ที่ผู้ให้บริการแนบบันทึกของคู่สายที่เป็นลูกค้าเครือข่ายเดียวกัน (เช่น DTAC)">
          <DataTable label="เครื่องของคู่สาย" rows={d.peerDevices} columns={peerCols} initialSort={{ key: 'n', dir: 'desc' }} csvName={`peer-devices-${ds.target}`} />
        </Section>
      )}
      <Caveat>ไม่นับ IMEI จากรายการ Wi-Fi เพราะค่านี้ไม่ได้ระบุเครื่องโทรศัพท์ได้อย่างน่าเชื่อถือ · รุ่นเครื่องตรวจสอบได้จากเลข TAC ในฐานข้อมูล GSMA</Caveat>
    </>
  );
}
