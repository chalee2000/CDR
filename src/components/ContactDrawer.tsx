import { useEffect, useMemo, useRef } from 'react';
import { contactStats, interactionsWith } from '../lib/analysis/contacts';
import { siteLabelOf } from '../lib/analysis/locations';
import { buildNetwork, DEFAULT_NETWORK_OPTIONS, egoNetwork } from '../lib/analysis/network';
import { datasetName } from '../lib/dataset';
import { interactionLabel, PEER_KIND_TH } from '../lib/labels';
import { normalizeNumber } from '../lib/phone';
import { personName } from '../lib/profiles';
import { fmtDateTime, fmtDuration, isoText } from '../lib/time';
import type { Dataset, Interaction } from '../lib/types';
import { fmtInt } from '../lib/util';
import { ChartCard, EChart } from './Chart';
import { singleHourOption } from './charts';
import { DataTable, type Column } from './DataTable';
import { LinkChart } from './LinkChart';
import { PersonCard } from './PersonCard';
import { Caveat, Section, Swatch } from './bits';
import { useEffectiveTheme, useStore } from '../state/store';

export function ContactDrawer() {
  const { drawerPeer: peer, openPeer, datasets, settings, profiles, openProfileEditor } = useStore();
  const mode = useEffectiveTheme();
  const close = useRef<HTMLButtonElement>(null);

  // Who this number is linked to: the number, the targets it talked to and
  // the links between those targets. For a target, only its bridges to the
  // other targets (its own contacts would crowd a small chart).
  const ego = useMemo(() => {
    if (!peer) return undefined;
    const isTarget = datasets.some((d) => d.target === peer);
    const net = buildNetwork(datasets, { ...settings, includeServiceNumbers: true }, { ...DEFAULT_NETWORK_OPTIONS, topN: 0, onlyShared: isTarget });
    const e = egoNetwork(net, peer);
    return e.nodes.length > 1 ? e : undefined;
  }, [peer, datasets, settings]);

  useEffect(() => {
    if (!peer) return;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openPeer(undefined);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [peer, openPeer]);

  const events = useMemo(() => (peer ? interactionsWith(datasets, peer, settings) : []), [peer, datasets, settings]);
  const per = useMemo(
    () => (peer ? datasets.map((ds) => ({ ds, c: contactStats(ds, settings).find((c) => c.peer === peer) })).filter((x) => x.c) : []),
    [peer, datasets, settings],
  );
  const hours = useMemo(() => {
    const h = new Array(24).fill(0);
    for (const e of events) h[new Date(e.it.ts).getUTCHours()]++;
    return h;
  }, [events]);
  const hourOpt = useMemo(() => singleHourOption(hours, mode, 'ครั้ง'), [hours, mode]);

  if (!peer) return null;
  const info = normalizeNumber(peer);
  const asTarget = datasets.find((d) => d.target === peer);
  const raw = [...new Set(per.flatMap((p) => p.c!.rawValues))];
  const peerImeis = [...new Set(per.flatMap((p) => p.c!.peerImeis))];
  const peerSites = [...new Set(per.flatMap((p) => p.c!.peerSites))];
  const y = settings.yearStyle;
  const name = personName(profiles[peer]);

  const cols: Column<{ ds: Dataset; it: Interaction }>[] = [
    { key: 'ts', header: 'วันเวลา', render: (e) => <span className="nowrap mono">{fmtDateTime(e.it.ts, y)}</span>, sortValue: (e) => e.it.ts, csv: (e) => isoText(e.it.ts) },
    {
      key: 'ds',
      header: 'เป้าหมาย',
      render: (e) => (
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} className="nowrap">
          <Swatch slot={e.ds.slot} round />
          <span className="mono">{e.ds.target}</span>
        </span>
      ),
      sortValue: (e) => e.ds.target,
    },
    { key: 'type', header: 'ประเภท (มุมมองเป้าหมาย)', render: (e) => interactionLabel(e.it), sortValue: (e) => interactionLabel(e.it) },
    { key: 'dur', header: 'ระยะเวลา', num: true, render: (e) => (e.it.service === 'call' ? fmtDuration(e.it.durationSec) : '-'), sortValue: (e) => e.it.durationSec },
    { key: 'site', header: 'เสาของเป้าหมาย', render: (e) => (e.it.targetObs?.cell ? siteLabelOf(e.it.targetObs.cell).label : '-'), sortValue: (e) => (e.it.targetObs?.cell ? siteLabelOf(e.it.targetObs.cell).label : undefined) },
    { key: 'psite', header: 'เสาของเลขนี้', render: (e) => (e.it.peerObs?.cell ? siteLabelOf(e.it.peerObs.cell).label + (e.it.peerCellInferred ? ' (จากแถว IMS ไม่มี IMEI)' : '') : ''), sortValue: (e) => (e.it.peerObs?.cell ? siteLabelOf(e.it.peerObs.cell).label : undefined) },
    { key: 'row', header: 'แถวในไฟล์', render: (e) => <span className="mono">{e.it.rowRefs.join(', ')}</span>, csv: (e) => e.it.rowRefs.join(' ') },
  ];

  return (
    <>
      <div className="backdrop" onClick={() => openPeer(undefined)} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header>
          <div>
            {name && <div className="person-name-lg">{name}</div>}
            <h2 id="drawer-title" className="mono" style={{ fontSize: name ? 16 : 20 }}>
              {peer}
            </h2>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              <span className="badge">{PEER_KIND_TH[info.kind]}</span>
              {info.country && <span className="badge">{info.country}</span>}
              {asTarget && <span className="badge accent">เป้าหมาย {datasetName(asTarget)}</span>}
              {per.length > 1 && <span className="badge warn">ติดต่อกับเป้าหมาย {per.length} ราย</span>}
            </div>
            {raw.length > 0 && <div className="caveat" style={{ marginTop: 4 }}>ค่าในไฟล์: {raw.join(', ')}</div>}
          </div>
          <button ref={close} className="btn" type="button" onClick={() => openPeer(undefined)}>
            ปิด ✕
          </button>
        </header>
        <Section title="ข้อมูลบุคคล">
          <PersonCard number={peer} profile={profiles[peer]} onEdit={() => openProfileEditor(peer)} />
        </Section>
        {ego && (
          <Section title="ผังความเชื่อมโยงของเลขนี้" sub="ตัวเลขบนเส้น = จำนวนครั้ง (โทร + SMS) · ลูกศรชี้จากฝั่งที่โทรหรือส่ง">
            <div className="net-box mini">
              <LinkChart
                network={ego}
                mode={mode}
                profiles={profiles}
                unit="ครั้ง"
                yearStyle={y}
                label={`ผังความเชื่อมโยงของ ${peer}`}
                height={280}
                compact
                allLabels
                allEdgeLabels
                onSelect={(sel) => {
                  if (sel?.type === 'node' && sel.id !== peer) openPeer(sel.id);
                }}
              />
            </div>
          </Section>
        )}
        <Section title="สรุปแยกตามเป้าหมาย">
          <div className="table-wrap">
            <table className="data" aria-label="สรุปการติดต่อแยกตามเป้าหมาย">
              <thead>
                <tr>
                  <th scope="col">เป้าหมาย</th>
                  <th scope="col" className="num">รวม</th>
                  <th scope="col" className="num">โทรออก</th>
                  <th scope="col" className="num">โทรเข้า</th>
                  <th scope="col" className="num">ไม่สำเร็จ</th>
                  <th scope="col" className="num">เวลาสนทนา</th>
                  <th scope="col" className="num">SMS</th>
                  <th scope="col">ช่วงเวลา</th>
                </tr>
              </thead>
              <tbody>
                {per.map(({ ds, c }) => (
                  <tr key={ds.id}>
                    <td className="nowrap">
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <Swatch slot={ds.slot} round />
                        <span className="mono">{ds.target}</span>
                      </span>
                    </td>
                    <td className="num">{fmtInt(c!.total)}</td>
                    <td className="num">{fmtInt(c!.callsOut)}</td>
                    <td className="num">{fmtInt(c!.callsIn)}</td>
                    <td className="num">{fmtInt(c!.unanswered)}</td>
                    <td className="num">{fmtDuration(c!.talkSec)}</td>
                    <td className="num">{fmtInt(c!.smsOut + c!.smsIn)}</td>
                    <td className="nowrap">
                      {fmtDateTime(c!.firstTs, y)} – {fmtDateTime(c!.lastTs, y)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(peerImeis.length > 0 || peerSites.length > 0) && (
            <div className="note" style={{ marginTop: 10 }}>
              <strong>ข้อมูลเครื่องและตำแหน่งของเลขนี้ (จากบันทึกที่ผู้ให้บริการแนบมา)</strong>
              <ul>
                {peerImeis.length > 0 && (
                  <li>
                    IMEI (14 หลักแรก): <span className="mono">{peerImeis.join(', ')}</span>
                  </li>
                )}
                {peerSites.length > 0 && <li>เสาที่พบ: {peerSites.slice(0, 12).join(', ')}{peerSites.length > 12 ? ` และอีก ${peerSites.length - 12} แห่ง` : ''}</li>}
              </ul>
            </div>
          )}
        </Section>
        <ChartCard title="ช่วงเวลาที่ติดต่อ" sub="ทุกเป้าหมายรวมกัน" table={{ columns: ['ชั่วโมง', 'ครั้ง'], rows: hours.map((n, h) => [`${String(h).padStart(2, '0')}:00`, n]) }}>
          <EChart option={hourOpt} height={180} label={`ช่วงเวลาที่ติดต่อกับ ${peer}`} />
        </ChartCard>
        <Section title={`ไทม์ไลน์การติดต่อ (${fmtInt(events.length)} ครั้ง)`}>
          <DataTable label="ไทม์ไลน์การติดต่อ" rows={events} columns={cols} initialSort={{ key: 'ts', dir: 'asc' }} pageSize={50} csvName={`contact-${peer}`} />
        </Section>
        <Caveat>ข้อมูลแสดงเฉพาะการติดต่อที่ปรากฏในไฟล์ที่นำเข้า ไม่ใช่ประวัติทั้งหมดของเลขหมายนี้</Caveat>
      </aside>
    </>
  );
}
