import { useEffect, useMemo, useRef, useState } from 'react';
import { allBursts, burstBase, burstNetwork, burstPeers, simultaneousBursts, type BurstPair, type BurstPeerStats, type CallBurst } from '../lib/analysis/bursts';
import { siteLabelOf } from '../lib/analysis/locations';
import { datasetName } from '../lib/dataset';
import { interactionLabel, PEER_KIND_TH } from '../lib/labels';
import { slotColor } from '../lib/palette';
import { fmtDate, fmtDateTime, fmtDuration, fmtTime, isoText } from '../lib/time';
import { SETTING_LIMITS, type Interaction } from '../lib/types';
import { fmtInt, pct } from '../lib/util';
import { ChartCard, EChart } from '../components/Chart';
import { burstOption } from '../components/charts';
import { DataTable, type Column } from '../components/DataTable';
import { LinkChart } from '../components/LinkChart';
import { Caveat, Kpi, NumberLink, Section, Swatch } from '../components/bits';
import { useEffectiveTheme, useStore } from '../state/store';

export function BurstView() {
  const { datasets, settings, setSettings, profiles, openPeer } = useStore();
  const mode = useEffectiveTheme();
  const [only, setOnly] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const detail = useRef<HTMLDivElement>(null);
  const y = settings.yearStyle;

  const shown = useMemo(() => (only ? datasets.filter((d) => d.id === only) : datasets), [datasets, only]);
  const bursts = useMemo(() => allBursts(shown, settings), [shown, settings]);
  const base = useMemo(() => shown.reduce((s, d) => s + burstBase(d, settings), 0), [shown, settings]);
  const peers = useMemo(() => burstPeers(bursts), [bursts]);
  const pairs = useMemo(() => (datasets.length > 1 ? simultaneousBursts(allBursts(datasets, settings), settings.burstMinutes) : []), [datasets, settings]);
  const range = useMemo<[number, number]>(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const d of shown)
      for (const it of d.interactions) {
        if (it.ts < lo) lo = it.ts;
        if (it.ts > hi) hi = it.ts;
      }
    return Number.isFinite(lo) ? [lo, hi] : [0, 0];
  }, [shown]);
  const targets = useMemo(() => shown.map((d) => ({ id: d.id, slot: d.slot, target: d.target, label: datasetName(d) })), [shown]);
  const option = useMemo(() => burstOption(bursts, targets, range, mode, { start: settings.nightStart, end: settings.nightEnd }), [bursts, targets, range, mode, settings.nightStart, settings.nightEnd]);
  const selected = bursts.find((b) => b.id === selectedId);
  const net = useMemo(() => (selected ? burstNetwork(selected, datasets) : undefined), [selected, datasets]);

  useEffect(() => {
    if (selectedId) detail.current?.scrollIntoView({ block: 'start' });
  }, [selectedId]);

  const byId = new Map(datasets.map((d) => [d.id, d]));
  const tag = (id: string) => {
    const d = byId.get(id);
    return d ? (
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} className="nowrap">
        <Swatch slot={d.slot} round />
        <span className="mono">{datasetName(d)}</span>
      </span>
    ) : null;
  };
  const num = (key: 'burstCount' | 'burstMinutes') => {
    const { min, max, int } = SETTING_LIMITS[key];
    return {
      type: 'number' as const,
      min,
      max,
      value: settings[key],
      style: { width: 70 },
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v >= min && v <= max && (!int || Number.isInteger(v))) setSettings({ [key]: v });
      },
    };
  };

  const total = bursts.reduce((s, b) => s + b.count, 0);
  const densest = bursts.reduce<CallBurst | undefined>((m, b) => (!m || b.count / Math.max(1, b.minutes) > m.count / Math.max(1, m.minutes) ? b : m), undefined);
  const biggest = bursts.reduce<CallBurst | undefined>((m, b) => (!m || b.count > m.count ? b : m), undefined);
  const multi = shown.length > 1;

  const burstCols: Column<CallBurst>[] = [
    {
      key: 'act',
      header: '',
      render: (b) => (
        <button className="btn small" type="button" aria-pressed={b.id === selectedId} onClick={() => setSelectedId(b.id === selectedId ? undefined : b.id)}>
          {b.id === selectedId ? 'ซ่อน' : 'ดูรายละเอียด'}
        </button>
      ),
      csv: () => '',
    },
    ...(multi ? [{ key: 'ds', header: 'เป้าหมาย', render: (b: CallBurst) => tag(b.datasetId), sortValue: (b: CallBurst) => b.target } as Column<CallBurst>] : []),
    { key: 'from', header: 'เริ่ม', render: (b) => <span className="nowrap">{fmtDateTime(b.from, y)}</span>, sortValue: (b) => b.from, csv: (b) => isoText(b.from) },
    { key: 'to', header: 'สิ้นสุด', render: (b) => fmtTime(b.to), sortValue: (b) => b.to, csv: (b) => isoText(b.to) },
    { key: 'min', header: 'นาที', num: true, render: (b) => b.minutes.toFixed(1), sortValue: (b) => b.minutes },
    { key: 'n', header: 'ครั้ง', num: true, render: (b) => <strong>{fmtInt(b.count)}</strong>, sortValue: (b) => b.count },
    { key: 'out', header: 'โทรออก', num: true, render: (b) => fmtInt(b.callsOut), sortValue: (b) => b.callsOut },
    { key: 'in', header: 'โทรเข้า', num: true, render: (b) => fmtInt(b.callsIn), sortValue: (b) => b.callsIn },
    { key: 'sms', header: 'SMS', num: true, render: (b) => fmtInt(b.sms), sortValue: (b) => b.sms },
    {
      key: 'peers',
      header: 'คู่ติดต่อ',
      render: (b) => (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', alignItems: 'center', maxWidth: 360 }}>
          <span className="muted small">{fmtInt(b.peers.length)} ราย:</span>
          {b.peers.slice(0, 3).map((p) => (
            <span key={p.peer} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <NumberLink peer={p.peer} />
              <span className="muted small">×{p.count}</span>
            </span>
          ))}
          {b.peers.length > 3 && <span className="muted small">…</span>}
        </span>
      ),
      sortValue: (b) => b.peers.length,
      csv: (b) => b.peers.map((p) => `${p.peer}:${p.count}`).join(' '),
    },
    { key: 'site', header: 'เสาที่ปรากฏมาก', render: (b) => b.topSite ?? '-', sortValue: (b) => b.topSite },
    { key: 'night', header: 'กลางคืน', render: (b) => (b.night ? <span className="badge warn">กลางคืน</span> : ''), sortValue: (b) => Number(b.night), csv: (b) => (b.night ? 'ใช่' : '') },
  ];

  const eventCols: Column<Interaction>[] = [
    { key: 'ts', header: 'เวลา', render: (e) => <span className="nowrap mono">{fmtTime(e.ts)}</span>, sortValue: (e) => e.ts, csv: (e) => isoText(e.ts) },
    { key: 'type', header: 'ประเภท', render: (e) => interactionLabel(e), sortValue: (e) => interactionLabel(e) },
    { key: 'peer', header: 'คู่ติดต่อ', render: (e) => <NumberLink peer={e.peer} kind={e.peerKind} country={e.peerCountry} />, sortValue: (e) => e.peer },
    { key: 'dur', header: 'ระยะเวลา', num: true, render: (e) => (e.service === 'call' ? fmtDuration(e.durationSec) : '-'), sortValue: (e) => e.durationSec },
    { key: 'site', header: 'เสาของเป้าหมาย', render: (e) => (e.targetObs?.cell ? siteLabelOf(e.targetObs.cell).label : '-'), sortValue: (e) => (e.targetObs?.cell ? siteLabelOf(e.targetObs.cell).label : undefined) },
    { key: 'psite', header: 'เสาของคู่สาย', render: (e) => (e.peerObs?.cell ? siteLabelOf(e.peerObs.cell).label : ''), sortValue: (e) => (e.peerObs?.cell ? siteLabelOf(e.peerObs.cell).label : undefined) },
  ];

  const peerCols: Column<BurstPeerStats>[] = [
    { key: 'peer', header: 'คู่ติดต่อ', render: (p) => <NumberLink peer={p.peer} kind={p.kind} />, sortValue: (p) => p.peer },
    { key: 'kind', header: 'ประเภท', render: (p) => PEER_KIND_TH[p.kind], sortValue: (p) => p.kind },
    { key: 'b', header: 'จำนวนช่วงที่ปรากฏ', num: true, render: (p) => <strong>{fmtInt(p.bursts)}</strong>, sortValue: (p) => p.bursts },
    { key: 'e', header: 'ครั้งในช่วงถี่', num: true, render: (p) => fmtInt(p.events), sortValue: (p) => p.events },
    {
      key: 'ds',
      header: 'เป้าหมาย',
      render: (p) => (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {p.datasetIds.map((id) => (
            <span key={id}>{tag(id)}</span>
          ))}
        </span>
      ),
      sortValue: (p) => p.datasetIds.length,
      csv: (p) => p.datasetIds.map((id) => byId.get(id)?.target ?? id).join(' '),
    },
    { key: 'first', header: 'ครั้งแรก', render: (p) => fmtDateTime(p.firstTs, y), sortValue: (p) => p.firstTs, csv: (p) => isoText(p.firstTs) },
    { key: 'last', header: 'ล่าสุด', render: (p) => fmtDateTime(p.lastTs, y), sortValue: (p) => p.lastTs, csv: (p) => isoText(p.lastTs) },
  ];

  const side = (b: CallBurst) => (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {tag(b.datasetId)}
      <span className="nowrap">
        {fmtTime(b.from)}–{fmtTime(b.to)} · {fmtInt(b.count)} ครั้ง
      </span>
    </span>
  );
  const pairCols: Column<BurstPair>[] = [
    { key: 'day', header: 'วันที่', render: (p) => fmtDate(Math.min(p.a.from, p.b.from), y), sortValue: (p) => Math.min(p.a.from, p.b.from), csv: (p) => isoText(Math.min(p.a.from, p.b.from)) },
    { key: 'a', header: 'ช่วงที่ 1', render: (p) => side(p.a), sortValue: (p) => p.a.from, csv: (p) => `${p.a.target} ${isoText(p.a.from)}-${isoText(p.a.to)} (${p.a.count})` },
    { key: 'b', header: 'ช่วงที่ 2', render: (p) => side(p.b), sortValue: (p) => p.b.from, csv: (p) => `${p.b.target} ${isoText(p.b.from)}-${isoText(p.b.to)} (${p.b.count})` },
    {
      key: 'gap',
      header: 'ซ้อนกัน / ห่างกัน',
      render: (p) => (p.overlapMin > 0 ? `ซ้อนกัน ${p.overlapMin.toFixed(1)} นาที` : `ห่าง ${p.gapMin.toFixed(1)} นาที`),
      sortValue: (p) => (p.overlapMin > 0 ? -p.overlapMin : p.gapMin),
    },
    {
      key: 'shared',
      header: 'คู่ติดต่อร่วม',
      render: (p) =>
        p.sharedPeers.length ? (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
            {p.sharedPeers.map((x) => (
              <NumberLink key={x} peer={x} />
            ))}
          </span>
        ) : (
          '-'
        ),
      sortValue: (p) => p.sharedPeers.length,
      csv: (p) => p.sharedPeers.join(' '),
    },
    { key: 'direct', header: 'ติดต่อกันเองในช่วงนี้', render: (p) => (p.direct ? <span className="badge warn">ใช่</span> : ''), sortValue: (p) => Number(p.direct), csv: (p) => (p.direct ? 'ใช่' : '') },
  ];

  const legend = shown.filter((d) => bursts.some((b) => b.datasetId === d.id)).map((d) => ({ color: slotColor(d.slot, mode), label: `${datasetName(d)}`, shape: 'dot' as const }));
  const crit = `≥ ${settings.burstCount} ครั้ง ภายใน ${settings.burstMinutes} นาที (${settings.burstSms ? 'โทร + SMS' : 'เฉพาะการโทร'})`;

  return (
    <>
      <div className="filters card" role="group" aria-label="เกณฑ์การติดต่อถี่">
        <span className="field inline">
          <span>ติดต่ออย่างน้อย</span>
          <input className="input" aria-label="จำนวนครั้งขั้นต่ำ" {...num('burstCount')} />
          <span>ครั้ง ภายใน</span>
          <input className="input" aria-label="ภายในกี่นาที" {...num('burstMinutes')} />
          <span>นาที</span>
        </span>
        <div className="seg" role="group" aria-label="สิ่งที่นับ">
          <button type="button" aria-pressed={settings.burstSms} onClick={() => setSettings({ burstSms: true })}>
            โทร + SMS
          </button>
          <button type="button" aria-pressed={!settings.burstSms} onClick={() => setSettings({ burstSms: false })}>
            เฉพาะการโทร
          </button>
        </div>
        {datasets.length > 1 && (
          <div className="filters" role="group" aria-label="เลือกเป้าหมาย">
            <button type="button" className="chip" aria-pressed={!only} onClick={() => setOnly(undefined)}>
              ทุกเป้าหมาย
            </button>
            {datasets.map((d) => (
              <button key={d.id} type="button" className="chip" aria-pressed={only === d.id} onClick={() => setOnly(d.id)}>
                <Swatch slot={d.slot} />
                <span className="mono">{datasetName(d)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <Section title="ภาพรวมการติดต่อถี่ (Call burst)" sub={`เกณฑ์ ${crit} · นับเฉพาะเลขหมายบุคคล · ช่วงที่ซ้อนกันนับเป็นช่วงเดียว · SMS หลายท่อนจากเลขเดียวกันภายใน 1 นาทีนับเป็น 1 ข้อความ`}>
        <div className="kpis">
          <Kpi label="ช่วงติดต่อถี่" value={fmtInt(bursts.length)} hint={`กลางคืน ${fmtInt(bursts.filter((b) => b.night).length)} ช่วง`} />
          <Kpi label="รายการในช่วงถี่" value={fmtInt(total)} hint={`${pct(total, base)} ของการติดต่อกับเลขบุคคล`} />
          <Kpi label="ช่วงที่ใหญ่ที่สุด" value={biggest ? `${fmtInt(biggest.count)} ครั้ง` : '-'} hint={biggest ? `${fmtDateTime(biggest.from, y)} · ${biggest.minutes.toFixed(0)} นาที` : undefined} />
          <Kpi label="ถี่ที่สุด" value={densest ? `${(densest.count / Math.max(1, densest.minutes)).toFixed(1)} ครั้ง/นาที` : '-'} hint={densest ? fmtDateTime(densest.from, y) : undefined} />
          <Kpi label="คู่ติดต่อที่เกี่ยวข้อง" value={fmtInt(peers.length)} hint={`ปรากฏตั้งแต่ 2 ช่วง ${fmtInt(peers.filter((p) => p.bursts > 1).length)} ราย`} />
          {datasets.length > 1 && <Kpi label="ติดต่อถี่พร้อมกัน (Candidate)" value={fmtInt(pairs.length)} hint="ต่างเป้าหมาย ช่วงเวลาซ้อนหรือใกล้กัน" />}
        </div>
      </Section>

      {bursts.length === 0 ? (
        <div className="note">ไม่พบช่วงติดต่อถี่ตามเกณฑ์ {crit} ลองลดจำนวนครั้งหรือเพิ่มเวลา</div>
      ) : (
        <>
          <ChartCard
            title="เวลาที่เกิดการติดต่อถี่"
            sub="แต่ละจุดคือหนึ่งช่วง · ขนาดตามจำนวนครั้ง · แถบสีจางคือช่วงกลางคืน · คลิกจุดเพื่อดูรายละเอียด"
            legend={legend}
            table={{ columns: ['เป้าหมาย', 'วันที่', 'เริ่ม', 'สิ้นสุด', 'ครั้ง'], rows: bursts.map((b) => [b.target, fmtDate(b.from, y), fmtTime(b.from), fmtTime(b.to), b.count]) }}
          >
            <EChart
              option={option}
              height={300}
              label={`กราฟเวลาที่เกิดการติดต่อถี่ ${bursts.length} ช่วง`}
              onClick={(p) => {
                const v = (p.data as { value?: unknown[] } | undefined)?.value;
                if (typeof v?.[3] === 'string') setSelectedId(v[3]);
              }}
            />
          </ChartCard>

          <Section title="รายการช่วงติดต่อถี่" sub={`${fmtInt(bursts.length)} ช่วง · กด "ดูรายละเอียด" เพื่อดูทุกรายการและผังของช่วงนั้น`}>
            <DataTable label="รายการช่วงติดต่อถี่" rows={bursts} columns={burstCols} initialSort={{ key: 'from', dir: 'asc' }} pageSize={20} search={(b) => `${b.target} ${b.peers.map((p) => p.peer).join(' ')} ${b.topSite ?? ''}`} csvName="call-bursts" />
          </Section>

          {selected && net && (
            <div ref={detail} className="card burst-detail" role="region" aria-label="รายละเอียดช่วงติดต่อถี่">
              <header>
                <div>
                  <h3>
                    ช่วง {fmtDateTime(selected.from, y)}–{fmtTime(selected.to)} · {byId.get(selected.datasetId) ? datasetName(byId.get(selected.datasetId)!) : selected.target}
                  </h3>
                  <div className="sub">
                    {fmtInt(selected.count)} ครั้งใน {selected.minutes.toFixed(1)} นาที · โทรออก {selected.callsOut} · โทรเข้า {selected.callsIn} · SMS {selected.sms}
                    {selected.talkSec > 0 && ` · สนทนารวม ${fmtDuration(selected.talkSec)}`}
                    {selected.topSite && ` · เสาที่ปรากฏมาก: ${selected.topSite}`}
                    {' · ดับเบิลคลิกผังเพื่อดูเต็มจอ'}
                  </div>
                </div>
                <button className="btn small" type="button" onClick={() => setSelectedId(undefined)}>
                  ปิด ✕
                </button>
              </header>
              <div className="grid two" style={{ alignItems: 'start' }}>
                <DataTable label="รายการในช่วงติดต่อถี่" rows={selected.events} columns={eventCols} initialSort={{ key: 'ts', dir: 'asc' }} pageSize={50} csvName={`burst-${selected.target}-${isoText(selected.from).slice(0, 16).replace(/[^0-9]/g, '')}`} />
                <div className="net-box mini">
                  <LinkChart
                    network={net}
                    mode={mode}
                    profiles={profiles}
                    unit="ครั้ง"
                    yearStyle={y}
                    label={`ผังการติดต่อในช่วง ${fmtDateTime(selected.from, y)}`}
                    height={320}
                    compact
                    allLabels
                    allEdgeLabels
                    expandable
                    onSelect={(sel) => {
                      if (sel?.type === 'node' && sel.id !== selected.target) openPeer(sel.id);
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          <Section title="คู่ติดต่อที่ปรากฏในช่วงติดต่อถี่" sub="เรียงตามจำนวนช่วงที่ปรากฏ — เลขที่ปรากฏซ้ำหลายช่วงควรตรวจสอบเพิ่มเติม">
            <DataTable label="คู่ติดต่อในช่วงติดต่อถี่" rows={peers} columns={peerCols} initialSort={{ key: 'b', dir: 'desc' }} pageSize={20} search={(p) => p.peer} csvName="burst-contacts" />
          </Section>
        </>
      )}

      {datasets.length > 1 && (
        <Section title="ช่วงที่หลายเป้าหมายติดต่อถี่พร้อมกัน — Candidate" sub={`ช่วงติดต่อถี่ของต่างเป้าหมายที่ซ้อนกันหรือห่างกันไม่เกิน ${settings.burstMinutes} นาที (ทุกเป้าหมาย ไม่ขึ้นกับตัวกรองด้านบน)`}>
          <DataTable label="ติดต่อถี่พร้อมกัน" rows={pairs} columns={pairCols} initialSort={{ key: 'day', dir: 'asc' }} pageSize={20} empty="ไม่พบช่วงที่หลายเป้าหมายติดต่อถี่พร้อมกัน" csvName="simultaneous-bursts" />
        </Section>
      )}

      <Caveat>
        ช่วงติดต่อถี่เป็นข้อสังเกตเชิงเวลาจากจำนวนครั้งที่ติดต่อเท่านั้น ใช้จัดลำดับช่วงเวลาที่ควรตรวจสอบต่อ (เช่น เทียบกับเหตุการณ์ การเดินทาง หรือข้อมูลอื่น) ไม่ใช่หลักฐานว่ามีการกระทำผิด
        และการติดต่อถี่พร้อมกันของหลายเป้าหมายอาจเป็นเรื่องบังเอิญ
      </Caveat>
    </>
  );
}
