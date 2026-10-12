import { useEffect, useMemo, useRef, useState } from 'react';
import type { ECharts } from 'echarts/core';
import { buildNetwork, DEFAULT_NETWORK_OPTIONS, egoNetwork, type EdgeWeight, type NetEdge, type NetNode, type NetworkOptions } from '../lib/analysis/network';
import { PEER_KIND_TH } from '../lib/labels';
import { CHROME } from '../lib/palette';
import { personName } from '../lib/profiles';
import { fmtDateTime, fmtDuration, isoText } from '../lib/time';
import { fmtInt } from '../lib/util';
import { DataTable, type Column } from '../components/DataTable';
import { LinkChart } from '../components/LinkChart';
import { LinkDetails } from '../components/LinkDetails';
import { LinkLegend } from '../components/LinkLegend';
import type { LinkColorBy, LinkLayoutMode, LinkSelection } from '../components/linkChartOption';
import { downloadDataUrl } from '../components/download';
import { Caveat, NumberLink, Section, Swatch } from '../components/bits';
import { useEffectiveTheme, useStore } from '../state/store';

export const WEIGHT_UNIT: Record<EdgeWeight, string> = { events: 'ครั้ง', calls: 'สาย', talk: 'นาที' };

/** Pixel position of a node on the chart (layout positions live in ECharts' model). */
function nodePixel(c: ECharts, id: string): [number, number] | undefined {
  try {
    const model = (c as unknown as { getModel(): { getSeriesByIndex(i: number): { getData(): { indexOfName(n: string): number; getItemLayout(i: number): number[] } } } }).getModel();
    const data = model.getSeriesByIndex(0).getData();
    const idx = data.indexOfName(id);
    if (idx < 0) return undefined;
    const p = c.convertToPixel({ seriesIndex: 0 }, data.getItemLayout(idx)) as number[];
    return Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [p[0], p[1]] : undefined;
  } catch {
    return undefined;
  }
}

export function NetworkView() {
  const { datasets, settings, setSettings, profiles, notify } = useStore();
  const mode = useEffectiveTheme();
  const [opts, setOpts] = useState<NetworkOptions>(DEFAULT_NETWORK_OPTIONS);
  const [colorBy, setColorBy] = useState<LinkColorBy>('role');
  const [layoutMode, setLayoutMode] = useState<LinkLayoutMode>('hub');
  const [allLabels, setAllLabels] = useState(false);
  const [allEdgeLabels, setAllEdgeLabels] = useState(false);
  const [selection, setSelection] = useState<LinkSelection>();
  const [focusId, setFocusId] = useState<string>();
  const [resetKey, setResetKey] = useState(0);
  const [query, setQuery] = useState('');
  const [miss, setMiss] = useState(false);
  const [centerReq, setCenterReq] = useState<{ id: string; at: number }>();
  const [isFull, setIsFull] = useState(false);
  const chart = useRef<ECharts>(null);
  const box = useRef<HTMLElement>(null);

  const full = useMemo(() => buildNetwork(datasets, settings, opts), [datasets, settings, opts]);
  const net = useMemo(() => (focusId && full.nodes.some((n) => n.id === focusId) ? egoNetwork(full, focusId) : full), [full, focusId]);
  const unit = WEIGHT_UNIT[opts.weight];
  const y = settings.yearStyle;

  // Largest communities take palette slots in order; the rest stay grey.
  const communitySlots = useMemo(() => {
    const sizes = new Map<number, number>();
    for (const n of full.nodes) sizes.set(n.community, (sizes.get(n.community) ?? 0) + 1);
    const order = [...sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
    return new Map(order.map(([c], i) => [c, i]));
  }, [full]);

  const valid =
    selection &&
    (selection.type === 'node'
      ? net.nodes.some((n) => n.id === selection.id)
      : net.edges.some((e) => (e.source === selection.source && e.target === selection.target) || (e.source === selection.target && e.target === selection.source)))
      ? selection
      : undefined;

  const nameOf = (n: Pick<NetNode, 'id' | 'isTarget' | 'label'>) => personName(profiles[n.id]) ?? (n.isTarget && n.label !== n.id ? n.label : undefined);
  const searchable = useMemo(() => full.nodes.map((n) => ({ id: n.id, name: nameOf(n) ?? '' })), [full, profiles]); // eslint-disable-line react-hooks/exhaustive-deps

  const find = (q: string) => {
    const s = q.trim().toLowerCase();
    if (!s) return;
    const digits = s.replace(/[\s-]/g, '');
    const hit =
      searchable.find((o) => o.id.toLowerCase() === digits) ??
      (digits.length >= 3 ? searchable.find((o) => o.id.toLowerCase().includes(digits)) : undefined) ??
      searchable.find((o) => o.name && o.name.toLowerCase().includes(s));
    setMiss(!hit);
    if (!hit) return;
    if (focusId && !net.nodes.some((n) => n.id === hit.id)) setFocusId(undefined);
    setSelection({ type: 'node', id: hit.id });
    setCenterReq({ id: hit.id, at: Date.now() });
  };

  // Width of the chart not covered by the floating details panel.
  const openWidth = (c: ECharts) => (window.matchMedia('(min-width: 1101px)').matches ? c.getWidth() - 330 : c.getWidth());

  // Centre a searched node once the chart has drawn the selection.
  useEffect(() => {
    const c = chart.current;
    if (!c || !centerReq) return;
    const t = setTimeout(() => {
      const p = nodePixel(c, centerReq.id);
      if (p) c.dispatchAction({ type: 'graphRoam', seriesIndex: 0, dx: openWidth(c) / 2 - p[0], dy: c.getHeight() / 2 - p[1] });
    }, 30);
    return () => clearTimeout(t);
  }, [centerReq]);

  // A clicked node that ends up under the panel (or off screen) slides into view.
  useEffect(() => {
    const c = chart.current;
    if (!c || valid?.type !== 'node') return;
    const t = setTimeout(() => {
      const p = nodePixel(c, valid.id);
      if (!p) return;
      const w = openWidth(c);
      if (p[0] > w - 30 || p[0] < 30 || p[1] < 30 || p[1] > c.getHeight() - 30) {
        c.dispatchAction({ type: 'graphRoam', seriesIndex: 0, dx: w / 2 - p[0], dy: c.getHeight() / 2 - p[1] });
      }
    }, 60);
    return () => clearTimeout(t);
  }, [valid]);

  useEffect(() => {
    const on = () => setIsFull(!!box.current && document.fullscreenElement === box.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const zoom = (f: number) => {
    const c = chart.current;
    if (c) c.dispatchAction({ type: 'graphRoam', seriesIndex: 0, zoom: f, originX: c.getWidth() / 2, originY: c.getHeight() / 2 });
  };
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else box.current?.requestFullscreen?.().catch(() => notify('error', 'เบราว์เซอร์นี้ไม่อนุญาตให้แสดงผังเต็มจอ'));
  };
  const savePng = () => {
    const url = chart.current?.getDataURL({ type: 'png', pixelRatio: 3, backgroundColor: CHROME[mode].surface });
    if (url) downloadDataUrl(url, focusId ? `cdr-network-${focusId}.png` : 'cdr-network.png');
  };
  const set = (patch: Partial<NetworkOptions>) => setOpts((o) => ({ ...o, ...patch }));
  const focusNode = focusId ? full.nodes.find((n) => n.id === focusId) : undefined;

  const nodeCols: Column<NetNode>[] = [
    {
      key: 'id',
      header: 'เลขหมาย',
      render: (n) => (n.isTarget ? <span className="mono" style={{ fontWeight: 650 }}>{n.id}</span> : <NumberLink peer={n.id} kind={n.kind === 'target' ? undefined : n.kind} showName={false} />),
      sortValue: (n) => n.id,
    },
    { key: 'name', header: 'ชื่อ', render: (n) => nameOf(n) ?? '', sortValue: (n) => nameOf(n) ?? '' },
    { key: 'role', header: 'บทบาท', render: (n) => (n.isTarget ? 'เป้าหมาย' : n.shared ? 'ผู้ติดต่อร่วม' : PEER_KIND_TH[n.kind as keyof typeof PEER_KIND_TH]), sortValue: (n) => (n.isTarget ? 0 : n.shared ? 1 : 2) },
    { key: 'deg', header: 'Degree', num: true, render: (n) => fmtInt(n.degree), sortValue: (n) => n.degree },
    { key: 'wdeg', header: 'Weighted degree', num: true, render: (n) => fmtInt(n.weightedDegree), sortValue: (n) => n.weightedDegree },
    { key: 'btw', header: 'Betweenness', num: true, render: (n) => n.betweenness.toFixed(3), sortValue: (n) => n.betweenness },
    { key: 'pr', header: 'PageRank', num: true, render: (n) => n.pagerank.toFixed(3), sortValue: (n) => n.pagerank },
    { key: 'com', header: 'กลุ่ม', num: true, render: (n) => n.community + 1, sortValue: (n) => n.community },
    { key: 'tg', header: 'เชื่อมเป้าหมาย', num: true, render: (n) => n.datasetIds.length, sortValue: (n) => n.datasetIds.length },
  ];
  const end = (id: string) => {
    const n = full.nodes.find((x) => x.id === id);
    const name = n ? nameOf(n) : undefined;
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
        <NumberLink peer={id} showName={false} />
        {name && <span className="muted small">{name}</span>}
      </span>
    );
  };
  const edgeCols: Column<NetEdge>[] = [
    { key: 's', header: 'เลขหมาย ก', render: (e) => end(e.source), sortValue: (e) => e.source, csv: (e) => e.source },
    { key: 't', header: 'เลขหมาย ข', render: (e) => end(e.target), sortValue: (e) => e.target, csv: (e) => e.target },
    { key: 'ab', header: 'ก → ข', num: true, render: (e) => fmtInt(e.ab), sortValue: (e) => e.ab },
    { key: 'ba', header: 'ข → ก', num: true, render: (e) => fmtInt(e.ba), sortValue: (e) => e.ba },
    { key: 'n', header: 'รวม', num: true, render: (e) => fmtInt(e.events), sortValue: (e) => e.events },
    { key: 'calls', header: 'โทร', num: true, render: (e) => fmtInt(e.calls), sortValue: (e) => e.calls },
    { key: 'sms', header: 'SMS', num: true, render: (e) => fmtInt(e.sms), sortValue: (e) => e.sms },
    { key: 'talk', header: 'เวลาสนทนา', num: true, render: (e) => fmtDuration(e.talkSec), sortValue: (e) => e.talkSec },
    { key: 'first', header: 'ครั้งแรก', render: (e) => <span className="nowrap">{fmtDateTime(e.firstTs, y)}</span>, sortValue: (e) => e.firstTs, csv: (e) => isoText(e.firstTs) },
    { key: 'last', header: 'ล่าสุด', render: (e) => <span className="nowrap">{fmtDateTime(e.lastTs, y)}</span>, sortValue: (e) => e.lastTs, csv: (e) => isoText(e.lastTs) },
  ];

  return (
    <>
      <div className="filters card" role="group" aria-label="ตัวเลือกผังเครือข่าย">
        <label className="field inline">
          <span>น้ำหนักเส้น</span>
          <select className="input" value={opts.weight} onChange={(e) => set({ weight: e.target.value as EdgeWeight })}>
            <option value="events">จำนวนครั้ง (โทร + SMS)</option>
            <option value="calls">จำนวนสาย</option>
            <option value="talk">เวลาสนทนา (นาที)</option>
          </select>
        </label>
        <label className="field inline">
          <span>ขั้นต่ำ</span>
          <input className="input" type="number" min={1} max={1000} value={opts.minWeight} onChange={(e) => set({ minWeight: Math.max(1, Number(e.target.value) || 1) })} style={{ width: 80 }} />
        </label>
        <label className="field inline">
          <span>คู่ติดต่อสูงสุดต่อเป้าหมาย</span>
          <select className="input" value={opts.topN} onChange={(e) => set({ topN: Number(e.target.value) })}>
            {[10, 20, 40, 80, 0].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'ทั้งหมด' : n}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.onlyShared} onChange={(e) => set({ onlyShared: e.target.checked })} />
          <span>เฉพาะผู้ติดต่อร่วม</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.includeServiceNumbers} onChange={(e) => setSettings({ includeServiceNumbers: e.target.checked })} />
          <span>รวมเลขบริการ</span>
        </label>
      </div>

      <section className="card link-card" ref={box} aria-label="ผังความเชื่อมโยง">
        <header>
          <div>
            <h3>ผังความเชื่อมโยง (Link chart)</h3>
            <div className="sub">
              {fmtInt(net.nodes.length)} เลขหมาย · {fmtInt(net.edges.length)} เส้น · {full.communities} กลุ่ม (modularity {full.modularity.toFixed(2)})
            </div>
          </div>
        </header>
        <div className="link-toolbar no-print" role="toolbar" aria-label="เครื่องมือผัง">
          <div className="seg" role="group" aria-label="การจัดวาง">
            <button type="button" aria-pressed={layoutMode === 'hub'} onClick={() => setLayoutMode('hub')}>
              กลุ่มรอบเป้าหมาย
            </button>
            <button type="button" aria-pressed={layoutMode === 'force'} onClick={() => setLayoutMode('force')}>
              แรงดึงดูด
            </button>
          </div>
          <form
            className="link-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              find(query);
            }}
          >
            <input
              className={`input${miss ? ' invalid' : ''}`}
              type="search"
              list="link-search-options"
              placeholder="ค้นหาเลขหมายหรือชื่อ"
              aria-label="ค้นหาเลขหมายหรือชื่อในผัง"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setMiss(false);
                if (searchable.some((o) => o.id === e.target.value)) find(e.target.value);
              }}
            />
            <datalist id="link-search-options">
              {searchable.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </datalist>
            <button className="btn small" type="submit">
              ค้นหา
            </button>
          </form>
          <div className="btn-group" role="group" aria-label="ซูม">
            <button className="btn small" type="button" onClick={() => zoom(1.3)} aria-label="ซูมเข้า" title="ซูมเข้า">
              +
            </button>
            <button className="btn small" type="button" onClick={() => zoom(1 / 1.3)} aria-label="ซูมออก" title="ซูมออก">
              −
            </button>
            <button className="btn small" type="button" onClick={() => setResetKey((k) => k + 1)} title="จัดผังให้พอดีกรอบ">
              พอดีกรอบ
            </button>
          </div>
          <button className="btn small toggle" type="button" aria-pressed={allLabels} onClick={() => setAllLabels((v) => !v)}>
            ป้ายชื่อทุกเลข
          </button>
          <button className="btn small toggle" type="button" aria-pressed={allEdgeLabels} onClick={() => setAllEdgeLabels((v) => !v)}>
            ตัวเลขทุกเส้น
          </button>
          <div className="seg" role="group" aria-label="สีของโหนด">
            <button type="button" aria-pressed={colorBy === 'role'} onClick={() => setColorBy('role')}>
              สีตามเป้าหมาย
            </button>
            <button type="button" aria-pressed={colorBy === 'community'} onClick={() => setColorBy('community')}>
              สีตามกลุ่ม (Louvain)
            </button>
          </div>
          <span className="spacer" />
          <button className="btn small" type="button" onClick={toggleFull}>
            {isFull ? 'ออกจากเต็มจอ' : 'เต็มจอ'}
          </button>
          <button className="btn small" type="button" onClick={savePng}>
            บันทึกภาพ PNG
          </button>
        </div>
        {miss && (
          <p className="caveat" role="status" style={{ margin: 0 }}>
            ไม่พบ "{query}" ในผังนี้ (ลองเลือก "ทั้งหมด" ที่จำนวนคู่ติดต่อ หรือรวมเลขบริการ)
          </p>
        )}
        {focusNode && (
          <div className="focus-banner" role="status">
            กำลังแสดงเฉพาะเครือข่ายรอบ <strong>{nameOf(focusNode) ?? focusNode.id}</strong>
            <button className="btn small" type="button" onClick={() => setFocusId(undefined)}>
              แสดงทั้งผัง
            </button>
          </div>
        )}
        <LinkLegend net={net} datasets={datasets} mode={mode} profiles={profiles} unit={unit} colorBy={colorBy} communitySlots={communitySlots} communities={full.communities} />
        <div className="link-stage">
          <div className="net-box">
            <LinkChart
              network={net}
              mode={mode}
              profiles={profiles}
              unit={unit}
              yearStyle={y}
              label={`ผังความเชื่อมโยง ${net.nodes.length} เลขหมาย ${net.edges.length} เส้น`}
              height={isFull ? 'calc(100vh - 150px)' : 'var(--link-h)'}
              layoutMode={layoutMode}
              colorBy={colorBy}
              communitySlots={communitySlots}
              allLabels={allLabels}
              allEdgeLabels={allEdgeLabels}
              selection={valid}
              onSelect={setSelection}
              resetKey={resetKey}
              onReady={(c) => (chart.current = c)}
            />
          </div>
          {valid ? (
            <LinkDetails
              net={net}
              selection={valid}
              onSelect={setSelection}
              focusId={focusId}
              onFocus={(id) => {
                setFocusId(id);
                if (id) setSelection({ type: 'node', id });
              }}
              mode={mode}
            />
          ) : (
            <p className="link-hint no-print">คลิกเลขหมายหรือเส้นเพื่อดูรายละเอียดและใส่ข้อมูลบุคคล · ลากเลขหมายเพื่อจัดตำแหน่ง · ล้อเมาส์หรือสองนิ้วเพื่อซูม</p>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Caveat>
            โหนด = เลขหมาย · เส้น = มีการติดต่อระหว่างเป้าหมายกับเลขหมายนั้น · ลูกศรชี้จากฝั่งที่โทรหรือส่ง SMS ไปยังผู้รับ (มีทั้งสองหัวเมื่อติดต่อกันทั้งสองทาง) · ถ้าเป้าหมายสองรายติดต่อกันเอง
            เส้นจะนับการติดต่อแต่ละครั้งเพียงครั้งเดียว · ชื่อ ที่อยู่ ประวัติคดี และรูป เป็นข้อมูลที่ผู้ใช้กรอกเอง ไม่ได้มาจากไฟล์ CDR
          </Caveat>
          <Caveat>Degree / Betweenness / PageRank / กลุ่ม เป็นตัวชี้วัดเชิงโครงสร้างภายใต้นิยามของผังนี้เท่านั้น ใช้จัดลำดับสิ่งที่ควรตรวจสอบต่อ ไม่ใช่หลักฐานว่าผู้ใดมีบทบาทในการกระทำผิด</Caveat>
        </div>
      </section>

      <Section title="ตัวชี้วัดของแต่ละเลขหมาย" sub="Betweenness คำนวณบนผังแบบไม่ถ่วงน้ำหนัก (normalized 0–1)">
        <DataTable label="ตัวชี้วัดเครือข่าย" rows={net.nodes} columns={nodeCols} initialSort={{ key: 'btw', dir: 'desc' }} pageSize={25} search={(n) => `${n.id} ${nameOf(n) ?? ''}`} csvName="network-nodes" />
      </Section>
      <Section title="เส้นเชื่อมโยง" sub={`จำนวนครั้งแยกตามทิศทาง (ฝั่งที่โทรหรือส่งก่อน) · น้ำหนักเส้นในผังใช้หน่วย "${unit}"`}>
        <DataTable label="เส้นเชื่อมโยง" rows={net.edges} columns={edgeCols} initialSort={{ key: 'n', dir: 'desc' }} pageSize={25} search={(e) => `${e.source} ${e.target}`} csvName="network-edges" />
      </Section>
      {datasets.length < 2 && (
        <p className="caveat">
          <Swatch slot={0} round /> เพิ่มไฟล์ของเป้าหมายรายอื่นเพื่อดูผู้ติดต่อร่วมและความเชื่อมโยงข้ามเป้าหมาย
        </p>
      )}
    </>
  );
}
