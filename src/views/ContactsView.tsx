import { useMemo, useState } from 'react';
import { contactStats, type ContactStat } from '../lib/analysis/contacts';
import { PEER_KIND_TH } from '../lib/labels';
import { fmtDateTime, fmtDuration, isoText } from '../lib/time';
import { fmtInt } from '../lib/util';
import { DataTable, type Column } from '../components/DataTable';
import { Caveat, DatasetPicker, NumberLink, Section, Swatch } from '../components/bits';
import { useStore } from '../state/store';

export function ContactsView() {
  const { selected: ds, settings, datasets } = useStore();
  const [personOnly, setPersonOnly] = useState(true);
  const all = useMemo(() => (ds ? contactStats(ds, settings) : []), [ds, settings]);
  // Which other loaded targets also talk to each party.
  const elsewhere = useMemo(() => {
    const m = new Map<string, typeof datasets>();
    for (const other of datasets) {
      if (!ds || other.id === ds.id) continue;
      for (const c of contactStats(other, settings)) {
        if (!m.has(c.peer)) m.set(c.peer, []);
        m.get(c.peer)!.push(other);
      }
    }
    return m;
  }, [datasets, ds, settings]);
  if (!ds) return null;
  const rows = personOnly ? all.filter((c) => c.isPerson) : all;
  const y = settings.yearStyle;

  const columns: Column<ContactStat>[] = [
    { key: 'peer', header: 'คู่ติดต่อ', render: (c) => <NumberLink peer={c.peer} kind={c.kind} country={c.country} />, sortValue: (c) => c.peer },
    { key: 'kind', header: 'ประเภท', render: (c) => PEER_KIND_TH[c.kind], sortValue: (c) => PEER_KIND_TH[c.kind] },
    { key: 'total', header: 'รวม', num: true, render: (c) => fmtInt(c.total), sortValue: (c) => c.total },
    { key: 'out', header: 'โทรออก', num: true, render: (c) => fmtInt(c.callsOut), sortValue: (c) => c.callsOut },
    { key: 'in', header: 'โทรเข้า', num: true, render: (c) => fmtInt(c.callsIn), sortValue: (c) => c.callsIn },
    { key: 'miss', header: 'ไม่สำเร็จ', num: true, render: (c) => fmtInt(c.unanswered), sortValue: (c) => c.unanswered },
    { key: 'talk', header: 'เวลาสนทนา', num: true, render: (c) => fmtDuration(c.talkSec), sortValue: (c) => c.talkSec },
    { key: 'sms', header: 'SMS ส่ง/รับ', num: true, render: (c) => `${fmtInt(c.smsOut)} / ${fmtInt(c.smsIn)}`, sortValue: (c) => c.smsOut + c.smsIn },
    { key: 'days', header: 'จำนวนวัน', num: true, render: (c) => fmtInt(c.activeDays), sortValue: (c) => c.activeDays },
    { key: 'night', header: 'กลางคืน', num: true, render: (c) => fmtInt(c.night), sortValue: (c) => c.night },
    { key: 'first', header: 'ครั้งแรก', render: (c) => <span className="nowrap">{fmtDateTime(c.firstTs, y)}</span>, sortValue: (c) => c.firstTs, csv: (c) => isoText(c.firstTs) },
    { key: 'last', header: 'ล่าสุด', render: (c) => <span className="nowrap">{fmtDateTime(c.lastTs, y)}</span>, sortValue: (c) => c.lastTs, csv: (c) => isoText(c.lastTs) },
    {
      key: 'other',
      header: 'พบในเป้าหมายอื่น',
      render: (c) => {
        const o = elsewhere.get(c.peer);
        return o ? (
          <span style={{ display: 'inline-flex', gap: 4 }}>
            {o.map((d) => (
              <span key={d.id} className="badge accent" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                <Swatch slot={d.slot} round /> {d.target}
              </span>
            ))}
          </span>
        ) : (
          ''
        );
      },
      sortValue: (c) => elsewhere.get(c.peer)?.length ?? 0,
      csv: (c) => (elsewhere.get(c.peer) ?? []).map((d) => d.target).join(' '),
    },
  ];

  return (
    <>
      <DatasetPicker />
      <Section
        title={`คู่ติดต่อของ ${ds.target}`}
        sub={`${fmtInt(all.filter((c) => c.isPerson).length)} บุคคล · ${fmtInt(all.filter((c) => !c.isPerson).length)} เลขบริการ/ชื่อผู้ส่ง`}
        actions={
          <label className="check">
            <input type="checkbox" checked={personOnly} onChange={(e) => setPersonOnly(e.target.checked)} />
            <span>เฉพาะเลขหมายบุคคล</span>
          </label>
        }
      >
        <DataTable
          label="ตารางคู่ติดต่อ"
          rows={rows}
          columns={columns}
          initialSort={{ key: 'total', dir: 'desc' }}
          search={(c) => `${c.peer} ${c.rawValues.join(' ')} ${c.country ?? ''}`}
          searchPlaceholder="ค้นหาเลขหมาย…"
          csvName={`contacts-${ds.target}`}
        />
        <div style={{ marginTop: 8 }}>
          <Caveat>คลิกเลขหมายเพื่อดูไทม์ไลน์การติดต่อทั้งหมด (ทุกเป้าหมาย) · ความถี่การติดต่อสูงไม่ได้แปลว่ามีความเกี่ยวข้องกับการกระทำผิด ควรพิจารณาร่วมกับข้อมูลอื่น</Caveat>
        </div>
      </Section>
    </>
  );
}
