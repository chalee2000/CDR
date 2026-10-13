import { useMemo } from 'react';
import { contactStats } from '../lib/analysis/contacts';
import { CoordResolver, homeWorkCandidates, siteStats } from '../lib/analysis/locations';
import { summarize } from '../lib/analysis/summary';
import { datasetName } from '../lib/dataset';
import { IMSI_BASIS_TH, imsiUseTh } from '../lib/labels';
import { fmtDate, fmtDuration } from '../lib/time';
import type { Dataset, ImsiCheck } from '../lib/types';
import { formatBytes, fmtInt, pct } from '../lib/util';
import { Caveat, Kpi, NumberLink, Section, Swatch } from '../components/bits';
import { DataTable, type Column } from '../components/DataTable';
import { useStore } from '../state/store';

function DatasetOverview({ ds }: { ds: Dataset }) {
  const { settings } = useStore();
  const s = useMemo(() => summarize(ds, settings), [ds, settings]);
  const top = useMemo(() => contactStats(ds, settings).filter((c) => c.isPerson).slice(0, 5), [ds, settings]);
  const places = useMemo(() => {
    const sites = siteStats(ds, settings, new CoordResolver());
    return homeWorkCandidates(ds, settings, sites);
  }, [ds, settings]);
  const y = settings.yearStyle;
  return (
    <Section
      title={datasetName(ds)}
      sub={
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Swatch slot={ds.slot} /> {ds.meta.formatLabel}
          {ds.meta.operator && ` · ${ds.meta.operator}`} · {ds.fileName}
        </span>
      }
    >
      <div className="kpis">
        <Kpi label="ช่วงข้อมูล" value={`${s.spanDays} วัน`} hint={`${fmtDate(s.firstTs, y)} – ${fmtDate(s.lastTs, y)} · มีกิจกรรม ${s.activeDays} วัน`} />
        <Kpi label="โทรออก / โทรเข้า" value={`${fmtInt(s.callsOut)} / ${fmtInt(s.callsIn)}`} hint={s.callsUnanswered ? `ไม่สำเร็จ ${fmtInt(s.callsUnanswered)} ครั้ง` : 'ทุกสายมีระยะเวลาสนทนา'} />
        <Kpi label="เวลาสนทนารวม" value={fmtDuration(s.talkSec)} hint={`เฉลี่ย ${fmtDuration(s.avgTalkSec)} · นานสุด ${fmtDuration(s.maxTalkSec)}`} />
        <Kpi label="SMS ส่ง / รับ" value={`${fmtInt(s.smsOut)} / ${fmtInt(s.smsIn)}`} />
        {s.dataSessions > 0 && <Kpi label="ใช้อินเทอร์เน็ต" value={`${fmtInt(s.dataSessions)} ครั้ง`} hint={formatBytes(s.dataBytes)} />}
        <Kpi label="ผู้ติดต่อ (บุคคล)" value={fmtInt(s.contactsPerson)} hint={`เลขบริการ/ชื่อผู้ส่ง ${fmtInt(s.contactsService)}${s.intlContacts ? ` · ต่างประเทศ ${s.intlContacts}` : ''}`} />
        <Kpi label="ติดต่อช่วงกลางคืน" value={pct(s.nightComm, s.commTotal)} hint={`${fmtInt(s.nightComm)} จาก ${fmtInt(s.commTotal)} ครั้ง`} />
        <Kpi label="เสาสัญญาณ" value={fmtInt(s.sites)} hint={`${fmtInt(s.cells)} เซลล์ · ${s.provinces.length} จังหวัด`} />
        <Kpi label="เครื่อง (IMEI) / ซิม (IMSI)" value={`${s.imeiCores.length} / ${s.imsis.length}`} hint={s.imeiCores.length > 1 ? 'มีการใช้มากกว่า 1 เครื่อง' : undefined} />
      </div>
      <div className="grid two" style={{ marginTop: 14 }}>
        <div>
          <h4 style={{ fontSize: 14, marginBottom: 6 }}>คู่ติดต่อบุคคลที่ติดต่อบ่อยที่สุด</h4>
          {top.length === 0 ? (
            <p className="empty">ไม่มี</p>
          ) : (
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              {top.map((c) => (
                <li key={c.peer} style={{ marginBottom: 2 }}>
                  <NumberLink peer={c.peer} kind={c.kind} country={c.country} /> — {fmtInt(c.total)} ครั้ง ({c.activeDays} วัน)
                </li>
              ))}
            </ol>
          )}
        </div>
        <div>
          <h4 style={{ fontSize: 14, marginBottom: 6 }}>พื้นที่ที่ปรากฏบ่อย (Candidate)</h4>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>
              กลางคืน: {places.home ? `${places.home.site.label} (${places.home.support}/${places.home.outOf} คืน)` : 'ข้อมูลไม่พอ'}
            </li>
            <li>
              กลางวันวันทำการ: {places.work ? `${places.work.site.label} (${places.work.support}/${places.work.outOf} วัน)` : 'ข้อมูลไม่พอ'}
            </li>
            <li>จังหวัดที่ปรากฏ: {s.provinces.length ? s.provinces.join(', ') : '-'}</li>
          </ul>
        </div>
      </div>
      {ds.meta.notes.length > 0 && (
        <div className="note warn" style={{ marginTop: 14 }}>
          <strong>ข้อจำกัดของข้อมูลชุดนี้</strong>
          <ul>
            {ds.meta.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

type SimRow = ImsiCheck & { ds: Dataset; key: string };

/** True/DTAC: every SIM in the file, whose handset it is, and where its positions are counted. */
function ImsiCheckSection({ datasets }: { datasets: Dataset[] }) {
  const { settings } = useStore();
  const y = settings.yearStyle;
  const rows: SimRow[] = datasets.flatMap((ds) => (ds.meta.imsiCheck ?? []).map((c, i) => ({ ...c, ds, key: `${ds.id}-${i}` })));
  if (!rows.length) return null;
  const columns: Column<SimRow>[] = [
    { key: 'target', header: 'เป้าหมาย', render: (r) => <span className="mono">{r.ds.target}</span>, sortValue: (r) => r.ds.target, csv: (r) => r.ds.target },
    { key: 'imsi', header: 'IMSI', render: (r) => (r.imsi ? <span className="mono">{r.imsi}</span> : <span className="muted">(ไม่มี IMSI)</span>), sortValue: (r) => r.imsi, csv: (r) => r.imsi || '(ไม่มี IMSI)' },
    {
      key: 'owner',
      header: 'เป็นของ',
      render: (r) => (
        <span className={`badge ${r.owner === 'target' ? 'accent' : 'warn'}`}>{r.owner === 'target' ? 'เป้าหมาย' : r.basis === 'review' ? 'คู่สาย (ควรตรวจสอบ)' : 'คู่สาย'}</span>
      ),
      sortValue: (r) => (r.owner === 'target' ? 0 : 1),
      csv: (r) => (r.owner === 'target' ? 'เป้าหมาย' : 'คู่สาย'),
    },
    {
      key: 'number',
      header: 'เลขหมายที่ใช้ซิมนี้',
      render: (r) => (r.number && r.number !== r.ds.target ? <NumberLink peer={r.number} /> : <span className="mono">{r.number ?? '-'}</span>),
      sortValue: (r) => r.number,
      csv: (r) => r.number ?? '',
    },
    {
      key: 'imei',
      header: 'IMEI ที่ใช้กับซิมนี้',
      render: (r) => (r.imeis.length ? <span className="mono small">{r.imeis.slice(0, 3).join(', ') + (r.imeis.length > 3 ? ` +${r.imeis.length - 3}` : '')}</span> : '-'),
      csv: (r) => r.imeis.join(' '),
    },
    { key: 'rows', header: 'แถว', num: true, render: (r) => fmtInt(r.rows), sortValue: (r) => r.rows, csv: (r) => r.rows },
    { key: 'cell', header: 'มีพิกัด', num: true, render: (r) => fmtInt(r.withCell), sortValue: (r) => r.withCell, csv: (r) => r.withCell },
    { key: 'use', header: 'ใช้พิกัดเป็น', render: (r) => imsiUseTh(r), csv: (r) => imsiUseTh(r) },
    {
      key: 'period',
      header: 'ช่วงที่พบ',
      render: (r) => <span className="nowrap">{r.firstTs === r.lastTs ? fmtDate(r.firstTs, y) : `${fmtDate(r.firstTs, y)} – ${fmtDate(r.lastTs, y)}`}</span>,
      sortValue: (r) => r.firstTs,
      csv: (r) => `${fmtDate(r.firstTs, y)} – ${fmtDate(r.lastTs, y)}`,
    },
    { key: 'basis', header: 'เหตุผล', render: (r) => <span className="small">{IMSI_BASIS_TH[r.basis]}</span>, csv: (r) => IMSI_BASIS_TH[r.basis] },
  ];
  return (
    <Section
      title="ตรวจเจ้าของพิกัดจาก IMSI (True/DTAC)"
      sub="ชีต VOICE / IMS / SMS มีแถวที่บันทึกจากเครื่องของคู่สายด้วยเมื่อคู่สายอยู่เครือข่ายเดียวกัน แถวที่ IMSI ไม่ใช่ของเป้าหมายจึงเป็นพิกัดของคู่สาย ไม่ใช่ของเป้าหมาย"
    >
      <DataTable label="ตรวจเจ้าของพิกัดจาก IMSI" rows={rows} columns={columns} pageSize={15} csvName="imsi-owner-check" />
      <div style={{ marginTop: 8 }}>
        <Caveat>
          แผนที่ เสาที่ใช้บ่อย พื้นที่ที่อาจเป็นที่พัก และเส้นทาง ใช้เฉพาะพิกัดของแถวที่เป็นของเป้าหมาย พิกัดของคู่สายแสดงแยกในคอลัมน์ "เสาของคู่สาย" (แท็บรายการข้อมูล)
          และในหน้ารายละเอียดของเลขนั้น · IMEI ในแถวของคู่สายเป็นเครื่องของคู่สาย ไม่ถูกนับเป็นเครื่องของเป้าหมาย · ถือว่าเป้าหมายมีซิมเดียว
          ซิมอื่นนับเป็นของเป้าหมายเฉพาะเมื่อใช้ไม่ทับช่วงเวลาและใช้ในเครื่องเดียวกับซิมของเป้าหมาย (เปลี่ยนซิม)
        </Caveat>
      </div>
    </Section>
  );
}

export function OverviewView() {
  const { datasets, settings } = useStore();
  return (
    <>
      <div className="note">
        ตัวเลขทุกส่วนคำนวณจากไฟล์โดยตรง (ข้อเท็จจริง) ส่วนป้าย "Candidate" หรือ "ควรตรวจสอบเพิ่มเติม" เป็นข้อสังเกตจากรูปแบบข้อมูล ไม่ใช่ข้อสรุปว่าใครกระทำผิด
        ตำแหน่งจากเสาสัญญาณเป็นพื้นที่ให้บริการ ไม่ใช่พิกัด GPS
      </div>
      {datasets.map((ds) => (
        <DatasetOverview key={ds.id} ds={ds} />
      ))}
      <Section title="คุณภาพข้อมูล" sub="จำนวนแถวที่อ่านได้ในแต่ละชีต และแถวที่ถูกแยกหรือข้าม">
        <div className="table-wrap">
          <table className="data" aria-label="คุณภาพข้อมูล">
            <thead>
              <tr>
                <th scope="col">เป้าหมาย</th>
                <th scope="col">ชีต</th>
                <th scope="col" className="num">แถว</th>
                <th scope="col" className="num">ใช้ได้</th>
                <th scope="col" className="num">เวลาอ่านไม่ได้</th>
                <th scope="col" className="num">ซ้ำทุกคอลัมน์</th>
                <th scope="col" className="num">เป็นของคู่สาย</th>
                <th scope="col" className="num">ไม่มีตำแหน่ง</th>
                <th scope="col">ประเภทที่ไม่รู้จัก</th>
              </tr>
            </thead>
            <tbody>
              {datasets.flatMap((ds) =>
                ds.meta.sheets.map((st) => (
                  <tr key={`${ds.id}-${st.sheet}`}>
                    <td className="mono">{ds.target}</td>
                    <td>{st.sheet}</td>
                    <td className="num">{fmtInt(st.rows)}</td>
                    <td className="num">{fmtInt(st.used)}</td>
                    <td className="num">{fmtInt(st.skippedNoTime)}</td>
                    <td className="num">{fmtInt(st.duplicates)}</td>
                    <td className="num">{fmtInt(st.peerOwned)}</td>
                    <td className="num">{fmtInt(st.noLocation)}</td>
                    <td>
                      {Object.entries(st.unknownTypes)
                        .map(([k, v]) => `${k} (${v})`)
                        .join(', ') || '-'}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 8 }}>
          <Caveat>
            การตีความเวลาที่ลงท้ายด้วย Z: {settings.zMode === 'local' ? 'ถือเป็นเวลาไทยตามที่เขียนในไฟล์' : 'แปลงจาก UTC เป็นเวลาไทย (+7 ชม.)'} ·
            แถวซ้ำ: {settings.dedupeExact ? 'รวมเป็นรายการเดียว' : 'นับทุกแถวตามไฟล์ต้นฉบับ'}
          </Caveat>
        </div>
      </Section>
      <ImsiCheckSection datasets={datasets} />
    </>
  );
}
