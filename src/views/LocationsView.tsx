import { useMemo, useState } from 'react';
import { CoordResolver, homeWorkCandidates, locatedDays, pathPoints, peerSites, siteStats, stays, type AreaLevel, type SiteStat, type Stay } from '../lib/analysis/locations';
import { approxLevelTh } from '../lib/labels';
import { personName } from '../lib/profiles';
import { fmtDate, fmtDateTime, fmtHours, fmtTime, isoText } from '../lib/time';
import { fmtInt, pct } from '../lib/util';
import { DataTable, type Column } from '../components/DataTable';
import { MapView, type MapPath, type MapSite } from '../components/MapView';
import { Caveat, DatasetPicker, Kpi, Section, Swatch } from '../components/bits';
import { useEffectiveTheme, useStore } from '../state/store';

export function LocationsView() {
  const { selected: ds, datasets, settings, coordImport, profiles } = useStore();
  const mode = useEffectiveTheme();
  const [scope, setScope] = useState<'one' | 'all'>('one');
  const [day, setDay] = useState('');
  const [level, setLevel] = useState<AreaLevel>('province');
  const [showPeers, setShowPeers] = useState(true);

  const resolver = useMemo(() => new CoordResolver(coordImport?.coords), [coordImport]);
  const sitesById = useMemo(() => new Map(datasets.map((d) => [d.id, siteStats(d, settings, resolver)])), [datasets, settings, resolver]);
  const sites = ds ? (sitesById.get(ds.id) ?? []) : [];
  const places = useMemo(() => (ds ? homeWorkCandidates(ds, settings, sites) : {}), [ds, settings, sites]);
  const stayRows = useMemo(() => (ds ? stays(ds, settings, level) : []), [ds, settings, level]);
  const days = useMemo(() => (ds ? locatedDays(ds, settings) : []), [ds, settings]);
  const dayPath = useMemo(() => (ds && day ? pathPoints(ds, settings, resolver, day) : []), [ds, settings, resolver, day]);

  const peerById = useMemo(() => new Map(datasets.map((d) => [d.id, peerSites(d, settings, resolver)])), [datasets, settings, resolver]);
  const peerCount = (scope === 'all' ? datasets : ds ? [ds] : []).reduce((n, d) => n + (peerById.get(d.id)?.filter((s) => s.coord).length ?? 0), 0);

  const mapSites: MapSite[] = useMemo(() => {
    const list = scope === 'all' ? datasets : ds ? [ds] : [];
    // A number followed by the name typed in for it, when there is one.
    const named = (n: string) => {
      const name = personName(profiles[n]);
      return name ? `${n} ${name}` : n;
    };
    // The other party's positions (squares) go first, under the target's own.
    const others: MapSite[] = !showPeers
      ? []
      : list.flatMap((d) =>
          (peerById.get(d.id) ?? [])
            .filter((s) => s.coord)
            .map((s) => ({
              key: `${d.id}|peer|${s.key}`,
              lat: s.coord!.lat,
              lon: s.coord!.lon,
              slot: d.slot,
              label: s.label,
              count: s.count,
              approx: s.coord!.source === 'approx',
              approxLevel: s.coord!.level,
              shape: 'square' as const,
              lines: [
                `ตำแหน่งของคู่สาย — ไม่ใช่ตำแหน่งของเป้าหมาย ${named(d.target)}`,
                `คู่สาย: ${s.peers.slice(0, 5).map((p) => [`${p.peer} (${p.count.toLocaleString('th-TH')})`, personName(profiles[p.peer])].filter(Boolean).join(' ')).join(', ')}${s.peers.length > 5 ? ` และอีก ${s.peers.length - 5} เลข` : ''}`,
                [s.tumbol, s.amphur, s.province].filter(Boolean).join(' · '),
                `${s.count.toLocaleString('th-TH')} รายการ` + (s.inferred ? ` (${s.inferred.toLocaleString('th-TH')} รายการมาจากแถว IMS ของเป้าหมายที่ไม่มี IMEI — น่าจะเป็นตำแหน่งฝั่งคู่สาย)` : ' (จากแถวที่ IMSI เป็นของคู่สาย)'),
                `ครั้งแรก ${fmtDateTime(s.firstTs, settings.yearStyle)}`,
                `ล่าสุด ${fmtDateTime(s.lastTs, settings.yearStyle)}`,
              ],
            })),
        );
    return others.concat(list.flatMap((d) =>
      (sitesById.get(d.id) ?? [])
        .filter((s) => s.coord)
        .map((s) => ({
          key: `${d.id}|${s.key}`,
          lat: s.coord!.lat,
          lon: s.coord!.lon,
          slot: d.slot,
          label: s.label,
          count: s.count,
          approx: s.coord!.source === 'approx',
          approxLevel: s.coord!.level,
          lines: [
            `เป้าหมาย ${named(d.target)}`,
            [s.tumbol, s.amphur, s.province].filter(Boolean).join(' · '),
            `${s.count.toLocaleString('th-TH')} รายการ (${s.days} วัน) · กลางคืน ${s.nightCount.toLocaleString('th-TH')}`,
            `ครั้งแรก ${fmtDateTime(s.firstTs, settings.yearStyle)}`,
            `ล่าสุด ${fmtDateTime(s.lastTs, settings.yearStyle)}`,
          ],
        })),
    ));
  }, [scope, datasets, ds, sitesById, peerById, showPeers, settings.yearStyle, profiles]);

  const paths: MapPath[] = useMemo(
    () => (ds && dayPath.length ? [{ slot: ds.slot, points: dayPath.map((p) => ({ lat: p.lat, lon: p.lon, label: p.label, time: fmtTime(p.ts) })) }] : []),
    [ds, dayPath],
  );

  if (!ds) return null;
  const y = settings.yearStyle;
  const approx = sites.some((s) => s.coord?.source === 'approx');
  const missing = sites.filter((s) => !s.coord).length;

  const hasData = sites.some((s) => s.dataCount > 0);
  const siteColsAll: Column<SiteStat>[] = [
    { key: 'label', header: 'เสา/สถานี', render: (s) => s.label, sortValue: (s) => s.label },
    { key: 'area', header: 'ตำบล / อำเภอ / จังหวัด', render: (s) => [s.tumbol, s.amphur, s.province].filter(Boolean).join(' · ') || '-', sortValue: (s) => `${s.province ?? ''}${s.amphur ?? ''}` },
    { key: 'count', header: 'ครั้ง', num: true, render: (s) => fmtInt(s.count), sortValue: (s) => s.count },
    { key: 'share', header: 'สัดส่วน', num: true, render: (s) => pct(s.count, sites.reduce((n, x) => n + x.count, 0)), sortValue: (s) => s.share },
    { key: 'comm', header: 'โทร/SMS', num: true, render: (s) => fmtInt(s.commCount), sortValue: (s) => s.commCount },
    { key: 'data', header: 'Data', num: true, render: (s) => fmtInt(s.dataCount), sortValue: (s) => s.dataCount },
    { key: 'night', header: 'กลางคืน', num: true, render: (s) => fmtInt(s.nightCount), sortValue: (s) => s.nightCount },
    { key: 'days', header: 'จำนวนวัน', num: true, render: (s) => fmtInt(s.days), sortValue: (s) => s.days },
    { key: 'first', header: 'ครั้งแรก', render: (s) => <span className="nowrap">{fmtDateTime(s.firstTs, y)}</span>, sortValue: (s) => s.firstTs, csv: (s) => isoText(s.firstTs) },
    { key: 'last', header: 'ล่าสุด', render: (s) => <span className="nowrap">{fmtDateTime(s.lastTs, y)}</span>, sortValue: (s) => s.lastTs, csv: (s) => isoText(s.lastTs) },
    { key: 'cells', header: 'เซลล์', render: (s) => <span className="mono">{s.cells.slice(0, 4).join(', ')}{s.cells.length > 4 ? ` +${s.cells.length - 4}` : ''}</span>, csv: (s) => s.cells.join(' ') },
    { key: 'coord', header: 'พิกัด', render: (s) => (s.coord ? (s.coord.source === 'file' ? 'จากไฟล์' : s.coord.source === 'import' ? 'นำเข้า' : `≈ ${approxLevelTh(s.coord.level)}`) : '-'), sortValue: (s) => s.coord?.source },
  ];
  const siteCols = hasData ? siteColsAll : siteColsAll.filter((c) => c.key !== 'comm' && c.key !== 'data');
  const stayCols: Column<Stay>[] = [
    { key: 'area', header: level === 'province' ? 'จังหวัด' : level === 'amphur' ? 'อำเภอ' : 'เสา', render: (s) => s.area, sortValue: (s) => s.area },
    { key: 'from', header: 'ตั้งแต่', render: (s) => <span className="nowrap">{fmtDateTime(s.from, y)}</span>, sortValue: (s) => s.from, csv: (s) => isoText(s.from) },
    { key: 'to', header: 'ถึง', render: (s) => <span className="nowrap">{fmtDateTime(s.to, y)}</span>, sortValue: (s) => s.to, csv: (s) => isoText(s.to) },
    { key: 'dur', header: 'ช่วงเวลา', num: true, render: (s) => fmtHours(s.to - s.from), sortValue: (s) => s.to - s.from },
    { key: 'n', header: 'รายการ', num: true, render: (s) => fmtInt(s.count), sortValue: (s) => s.count },
  ];

  return (
    <>
      <DatasetPicker />
      <Section
        title="แผนที่เสาสัญญาณ"
        sub="● วงกลม = ตำแหน่งของเป้าหมาย · ■ สี่เหลี่ยม = ตำแหน่งของคู่สาย (ไม่ใช่ของเป้าหมาย) · ขนาดตามจำนวนครั้ง · คลิกเพื่อดูรายละเอียด"
        actions={
          <div className="filters">
            {datasets.length > 1 && (
              <div className="seg" role="group" aria-label="ขอบเขตแผนที่">
                <button type="button" aria-pressed={scope === 'one'} onClick={() => setScope('one')}>
                  เป้าหมายที่เลือก
                </button>
                <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
                  ทุกเป้าหมาย
                </button>
              </div>
            )}
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <span>เส้นทางวันที่</span>
              <select className="input" value={day} onChange={(e) => setDay(e.target.value)}>
                <option value="">— ไม่แสดง —</option>
                {days.map((d) => (
                  <option key={d} value={d}>
                    {fmtDate(Date.parse(d), y)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        }
      >
        <div className="legend" aria-label="คำอธิบายสัญลักษณ์แผนที่">
          {(scope === 'all' ? datasets : [ds]).map((d) => (
            <span key={d.id}>
              <Swatch slot={d.slot} round /> {d.target}
            </span>
          ))}
          <span>
            <i className="legend-shape round" aria-hidden="true" /> ตำแหน่งของเป้าหมาย
          </span>
          {peerCount > 0 && (
            <label className="check" style={{ alignItems: 'center' }}>
              <input type="checkbox" checked={showPeers} onChange={(e) => setShowPeers(e.target.checked)} />
              <i className="legend-shape" aria-hidden="true" /> ตำแหน่งของคู่สาย ({fmtInt(peerCount)} เสา)
            </label>
          )}
        </div>
        <MapView sites={mapSites} paths={paths} showBasemap={settings.showBasemap} mode={mode} fitKey={`${scope}|${ds.id}|${day}|${coordImport?.name ?? ''}`} />
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {approx && (
            <Caveat>
              ไฟล์นี้ไม่มีพิกัดเสา วงกลมสีอ่อนจึงวางไว้ที่จุดกลางของตำบลตามชื่อพื้นที่ในไฟล์ (ถ้าไม่พบตำบลใช้อำเภอ แล้วจึงจังหวัด) เพื่อบอกพื้นที่ ไม่ใช่ตำแหน่งจริงของเสา
              (นำเข้าไฟล์พิกัดเสาได้ที่การตั้งค่า)
            </Caveat>
          )}
          {missing > 0 && <Caveat>{missing} เสาไม่มีข้อมูลจังหวัดหรือพิกัด จึงไม่แสดงบนแผนที่</Caveat>}
          {day && dayPath.length === 0 && <Caveat>วันที่เลือกไม่มีตำแหน่งที่แสดงบนแผนที่ได้</Caveat>}
          {peerCount > 0 && (
            <Caveat>
              สี่เหลี่ยมคือพิกัดที่ไฟล์บันทึกไว้แต่ไม่ใช่ของเป้าหมาย: แถวที่ IMSI เป็นของคู่สาย และแถว IMS ที่ใช้ IMSI ของเป้าหมายแต่ไม่มี IMEI (พิกัดอยู่ฝั่งคู่สาย)
              ไม่ถูกนับในเสาที่ใช้บ่อย พื้นที่ที่อาจเป็นที่พัก และเส้นทางของเป้าหมาย
            </Caveat>
          )}
          <Caveat>เสาสัญญาณแสดงพื้นที่ให้บริการ ไม่ใช่พิกัด GPS ของเครื่อง และเครื่องอาจเกาะเสาที่ไม่ใช่เสาที่ใกล้ที่สุด</Caveat>
        </div>
      </Section>
      <Section title="พื้นที่ที่ปรากฏบ่อย (Candidate)" sub="นับจำนวนคืน/วันทำการที่พบที่เสานั้น — เป็นข้อสังเกต ต้องยืนยันด้วยข้อมูลภาคสนาม">
        <div className="kpis">
          <Kpi label={`กลางคืน (${String(settings.nightStart).padStart(2, '0')}:00–${String(settings.nightEnd).padStart(2, '0')}:00)`} value={places.home?.site.label ?? 'ข้อมูลไม่พอ'} hint={places.home ? `${places.home.support} จาก ${places.home.outOf} คืนที่มีข้อมูลตำแหน่ง` : undefined} />
          <Kpi label="วันทำการ 09:00–17:00" value={places.work?.site.label ?? 'ข้อมูลไม่พอ'} hint={places.work ? `${places.work.support} จาก ${places.work.outOf} วัน` : undefined} />
          <Kpi label="จำนวนเสา" value={fmtInt(sites.length)} hint={`${fmtInt(sites.reduce((n, s) => n + s.cells.length, 0))} เซลล์`} />
        </div>
      </Section>
      <Section title="เสาที่ใช้" sub="เรียงตามจำนวนครั้ง (รวมรายการ data ถ้ามี)">
        <DataTable label="ตารางเสาสัญญาณ" rows={sites} columns={siteCols} initialSort={{ key: 'count', dir: 'desc' }} pageSize={25} search={(s) => `${s.label} ${s.tumbol ?? ''} ${s.amphur ?? ''} ${s.province ?? ''} ${s.cells.join(' ')}`} csvName={`sites-${ds.target}`} />
      </Section>
      <Section
        title="การอยู่และการย้ายพื้นที่"
        sub="รวมรายการต่อเนื่องที่อยู่ในพื้นที่เดียวกันเป็นช่วงเดียว"
        actions={
          <div className="seg" role="group" aria-label="ระดับพื้นที่">
            {(['province', 'amphur', 'site'] as AreaLevel[]).map((l) => (
              <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(l)}>
                {l === 'province' ? 'จังหวัด' : l === 'amphur' ? 'อำเภอ' : 'เสา'}
              </button>
            ))}
          </div>
        }
      >
        <DataTable label="การย้ายพื้นที่" rows={stayRows} columns={stayCols} initialSort={{ key: 'from', dir: 'asc' }} pageSize={25} csvName={`stays-${level}-${ds.target}`} />
      </Section>
    </>
  );
}
