import { useMemo, useRef, useState } from 'react';
import type { ECharts } from 'echarts/core';
import { buildNetwork, DEFAULT_NETWORK_OPTIONS, type EdgeWeight, type NetNode, type NetworkOptions } from '../lib/analysis/network';
import { PEER_KIND_TH } from '../lib/labels';
import { CHROME, slotColor } from '../lib/palette';
import { fmtInt } from '../lib/util';
import { DataTable, type Column } from '../components/DataTable';
import { NetworkGraph, type NetColorBy } from '../components/NetworkGraph';
import { downloadDataUrl } from '../components/download';
import { Caveat, NumberLink, Section, Swatch } from '../components/bits';
import { useEffectiveTheme, useStore } from '../state/store';

export function NetworkView() {
  const { datasets, settings, setSettings, openPeer } = useStore();
  const mode = useEffectiveTheme();
  const [opts, setOpts] = useState<NetworkOptions>(DEFAULT_NETWORK_OPTIONS);
  const [colorBy, setColorBy] = useState<NetColorBy>('role');
  const chart = useRef<ECharts>(null);
  const net = useMemo(() => buildNetwork(datasets, settings, opts), [datasets, settings, opts]);

  // Largest communities take palette slots in order; the rest stay grey.
  const communitySlots = useMemo(() => {
    const sizes = new Map<number, number>();
    for (const n of net.nodes) sizes.set(n.community, (sizes.get(n.community) ?? 0) + 1);
    const order = [...sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
    return new Map(order.map(([c], i) => [c, i]));
  }, [net]);

  const c = CHROME[mode];
  const legend =
    colorBy === 'role'
      ? [
          ...datasets.map((d) => ({ key: d.id, color: slotColor(d.slot, mode), label: `เป้าหมาย ${d.label !== d.target ? `${d.label} ` : ''}${d.target}` })),
          { key: 'shared', color: c.ink2, label: 'ติดต่อกับเป้าหมาย ≥ 2 ราย' },
          { key: 'other', color: c.other, label: 'คู่ติดต่ออื่น' },
        ]
      : [
          ...[...communitySlots.entries()].map(([com, slot]) => ({ key: `c${com}`, color: slotColor(slot, mode), label: `กลุ่มที่ ${com + 1}` })),
          ...(net.communities > communitySlots.size ? [{ key: 'rest', color: c.other, label: 'กลุ่มอื่น ๆ' }] : []),
        ];

  const cols: Column<NetNode>[] = [
    { key: 'id', header: 'เลขหมาย', render: (n) => (n.isTarget ? <span className="mono" style={{ fontWeight: 650 }}>{n.label !== n.id ? `${n.label} (${n.id})` : n.id}</span> : <NumberLink peer={n.id} kind={n.kind === 'target' ? undefined : n.kind} />), sortValue: (n) => n.id },
    { key: 'role', header: 'บทบาท', render: (n) => (n.isTarget ? 'เป้าหมาย' : n.shared ? 'ผู้ติดต่อร่วม' : PEER_KIND_TH[n.kind as keyof typeof PEER_KIND_TH]), sortValue: (n) => (n.isTarget ? 0 : n.shared ? 1 : 2) },
    { key: 'deg', header: 'Degree', num: true, render: (n) => fmtInt(n.degree), sortValue: (n) => n.degree },
    { key: 'wdeg', header: 'Weighted degree', num: true, render: (n) => fmtInt(n.weightedDegree), sortValue: (n) => n.weightedDegree },
    { key: 'btw', header: 'Betweenness', num: true, render: (n) => n.betweenness.toFixed(3), sortValue: (n) => n.betweenness },
    { key: 'pr', header: 'PageRank', num: true, render: (n) => n.pagerank.toFixed(3), sortValue: (n) => n.pagerank },
    { key: 'com', header: 'กลุ่ม', num: true, render: (n) => n.community + 1, sortValue: (n) => n.community },
    { key: 'tg', header: 'เชื่อมเป้าหมาย', num: true, render: (n) => n.datasetIds.length, sortValue: (n) => n.datasetIds.length },
  ];

  const set = (patch: Partial<NetworkOptions>) => setOpts((o) => ({ ...o, ...patch }));

  return (
    <>
      <div className="filters card" role="group" aria-label="ตัวเลือกผังเครือข่าย">
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <span>น้ำหนักเส้น</span>
          <select className="input" value={opts.weight} onChange={(e) => set({ weight: e.target.value as EdgeWeight })}>
            <option value="events">จำนวนครั้ง (โทร + SMS)</option>
            <option value="calls">จำนวนสาย</option>
            <option value="talk">เวลาสนทนา (นาที)</option>
          </select>
        </label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <span>ขั้นต่ำ</span>
          <input className="input" type="number" min={1} max={1000} value={opts.minWeight} onChange={(e) => set({ minWeight: Math.max(1, Number(e.target.value) || 1) })} style={{ width: 80 }} />
        </label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <span>แสดงคู่ติดต่อสูงสุดต่อเป้าหมาย</span>
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
        <div className="seg" role="group" aria-label="สีของโหนด">
          <button type="button" aria-pressed={colorBy === 'role'} onClick={() => setColorBy('role')}>
            สีตามบทบาท
          </button>
          <button type="button" aria-pressed={colorBy === 'community'} onClick={() => setColorBy('community')}>
            สีตามกลุ่ม (Louvain)
          </button>
        </div>
      </div>
      <Section
        title="ผังความเชื่อมโยง (Link chart)"
        sub={`${fmtInt(net.nodes.length)} โหนด · ${fmtInt(net.edges.length)} เส้น · ${net.communities} กลุ่ม (modularity ${net.modularity.toFixed(2)}) · ลาก/ซูมได้ · คลิกโหนดเพื่อดูรายละเอียด`}
        actions={
          <button
            className="btn small"
            type="button"
            onClick={() => {
              const url = chart.current?.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: c.surface });
              if (url) downloadDataUrl(url, 'cdr-network.png');
            }}
          >
            บันทึกเป็นภาพ PNG
          </button>
        }
      >
        <div className="legend">
          {legend.map((l) => (
            <span key={l.key}>
              <i aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
        <div className="net-box">
          <NetworkGraph
            network={net}
            mode={mode}
            colorBy={colorBy}
            communitySlots={communitySlots}
            onNodeClick={(id) => {
              if (!datasets.some((d) => d.target === id)) openPeer(id);
            }}
            onReady={(ch) => (chart.current = ch)}
          />
        </div>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Caveat>โหนด = เลขหมาย · เส้น = มีการติดต่อระหว่างเป้าหมายกับเลขหมายนั้น (ไม่มีทิศทาง) · ความหนาของเส้นตามน้ำหนักที่เลือก · ถ้าเป้าหมายสองรายติดต่อกันเอง เส้นจะนับการติดต่อแต่ละครั้งเพียงครั้งเดียว</Caveat>
          <Caveat>Degree / Betweenness / PageRank / กลุ่ม เป็นตัวชี้วัดเชิงโครงสร้างภายใต้นิยามของผังนี้เท่านั้น ใช้จัดลำดับสิ่งที่ควรตรวจสอบต่อ ไม่ใช่หลักฐานว่าผู้ใดมีบทบาทในการกระทำผิด</Caveat>
        </div>
      </Section>
      <Section title="ตัวชี้วัดของแต่ละโหนด" sub="Betweenness คำนวณบนผังแบบไม่ถ่วงน้ำหนัก (normalized 0–1)">
        <DataTable label="ตัวชี้วัดเครือข่าย" rows={net.nodes} columns={cols} initialSort={{ key: 'btw', dir: 'desc' }} pageSize={25} search={(n) => `${n.id} ${n.label}`} csvName="network-nodes" />
      </Section>
      {datasets.length < 2 && (
        <p className="caveat">
          <Swatch slot={0} round /> เพิ่มไฟล์ของเป้าหมายรายอื่นเพื่อดูผู้ติดต่อร่วมและความเชื่อมโยงข้ามเป้าหมาย
        </p>
      )}
    </>
  );
}
