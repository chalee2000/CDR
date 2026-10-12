import { useMemo } from 'react';
import type { NetEdge, NetNode, Network } from '../lib/analysis/network';
import { PEER_KIND_TH } from '../lib/labels';
import type { ThemeMode } from '../lib/palette';
import { personName } from '../lib/profiles';
import { fmtDate, fmtDuration } from '../lib/time';
import { fmtInt } from '../lib/util';
import { useStore } from '../state/store';
import { iconUrl } from './linkIcons';
import { linkedSlots, nodeIcon, type LinkSelection } from './linkChartOption';
import { PersonCard } from './PersonCard';

interface Props {
  net: Network;
  selection: LinkSelection;
  onSelect: (s: LinkSelection | undefined) => void;
  focusId?: string;
  onFocus: (id: string | undefined) => void;
  mode: ThemeMode;
}

/** Panel over the link chart: what the selected number or link stands for. */
export function LinkDetails({ net, selection, onSelect, focusId, onFocus, mode }: Props) {
  const { profiles, openPeer, openProfileEditor, settings } = useStore();
  const y = settings.yearStyle;
  const slots = useMemo(() => linkedSlots(net), [net]);
  const byId = useMemo(() => new Map(net.nodes.map((n) => [n.id, n])), [net]);

  const icon = (n: NetNode, size: number) => (
    <img className="node-icon" src={iconUrl(nodeIcon(n, { mode, size, slots: slots.get(n.id), profile: profiles[n.id] }))} width={size} height={size} alt="" />
  );
  const nameOf = (n: NetNode) => personName(profiles[n.id]) ?? (n.isTarget && n.label !== n.id ? n.label : undefined);
  const who = (n: NetNode, size = 26) => (
    <button type="button" className="who" onClick={() => onSelect({ type: 'node', id: n.id })} title="เลือกเลขนี้ในผัง">
      {icon(n, size)}
      <span style={{ minWidth: 0 }}>
        {nameOf(n) && <span className="who-name">{nameOf(n)}</span>}
        <span className="mono who-num">{n.id}</span>
      </span>
    </button>
  );

  const close = (
    <button className="icon-btn panel-close" type="button" aria-label="ปิดรายละเอียด" title="ปิด" onClick={() => onSelect(undefined)}>
      ✕
    </button>
  );

  if (selection.type === 'edge') {
    const e = net.edges.find((x) => (x.source === selection.source && x.target === selection.target) || (x.source === selection.target && x.target === selection.source));
    const a = e && byId.get(e.source);
    const b = e && byId.get(e.target);
    if (!e || !a || !b) return null;
    const label = (n: NetNode) => nameOf(n) ?? n.id;
    const contact = !b.isTarget ? b : !a.isTarget ? a : b;
    return (
      <div className="link-panel floating" role="region" aria-label="รายละเอียดเส้นเชื่อมโยง">
        {close}
        <h4>เส้นเชื่อมโยง</h4>
        <div className="edge-ends">
          {who(a, 34)}
          <span aria-hidden="true" className="muted">
            ⇄
          </span>
          {who(b, 34)}
        </div>
        <dl className="facts">
          <dt>
            {label(a)} → {label(b)}
          </dt>
          <dd>{fmtInt(e.ab)} ครั้ง</dd>
          <dt>
            {label(b)} → {label(a)}
          </dt>
          <dd>{fmtInt(e.ba)} ครั้ง</dd>
          <dt>โทร</dt>
          <dd>
            {fmtInt(e.calls)} สาย · สนทนา {fmtDuration(e.talkSec)}
          </dd>
          <dt>SMS</dt>
          <dd>{fmtInt(e.sms)}</dd>
          <dt>ช่วงเวลา</dt>
          <dd>
            {fmtDate(e.firstTs, y)} – {fmtDate(e.lastTs, y)}
          </dd>
        </dl>
        <div className="panel-actions">
          <button className="btn small" type="button" onClick={() => openPeer(contact.id)}>
            ดูรายการติดต่อของ {contact.id}
          </button>
          <button className="btn small ghost" type="button" onClick={() => onSelect(undefined)}>
            ล้างการเลือก
          </button>
        </div>
      </div>
    );
  }

  const n = byId.get(selection.id);
  if (!n) return null;
  const mine: { e: NetEdge; other: NetNode }[] = net.edges
    .filter((e) => e.source === n.id || e.target === n.id)
    .map((e) => ({ e, other: byId.get(e.source === n.id ? e.target : e.source)! }))
    .filter((x) => x.other)
    .sort((p, q) => q.e.events - p.e.events);
  const kind = n.isTarget ? 'เป้าหมาย' : PEER_KIND_TH[n.kind as keyof typeof PEER_KIND_TH];
  return (
    <div className="link-panel floating" role="region" aria-label="รายละเอียดเลขหมาย">
      {close}
      <div className="panel-head">
        {icon(n, 52)}
        <div style={{ minWidth: 0 }}>
          <div className="who-name lg">{nameOf(n) ?? n.id}</div>
          {nameOf(n) && <div className="mono muted">{n.id}</div>}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
            <span className={`badge${n.isTarget ? ' accent' : ''}`}>{kind}</span>
            {n.shared && <span className="badge warn">ผู้ติดต่อร่วม {n.datasetIds.length} เป้าหมาย</span>}
          </div>
        </div>
      </div>
      <PersonCard number={n.id} profile={profiles[n.id]} onEdit={() => openProfileEditor(n.id)} compact />
      <h4>การติดต่อในผัง ({fmtInt(mine.length)} เส้น)</h4>
      <ul className="who-list">
        {mine.slice(0, 12).map(({ e, other }) => {
          const out = e.source === n.id ? e.ab : e.ba;
          const inn = e.source === n.id ? e.ba : e.ab;
          return (
            <li key={other.id} className="who-row">
              {who(other)}
              <span className="who-stats">
                <span>
                  ออก <strong>{fmtInt(out)}</strong> · เข้า <strong>{fmtInt(inn)}</strong>
                </span>
                <span className="muted">
                  {fmtDate(e.firstTs, y)}–{fmtDate(e.lastTs, y)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {mine.length > 12 && <p className="muted" style={{ margin: 0 }}>และอีก {fmtInt(mine.length - 12)} เส้น (ดูในตารางเส้นเชื่อมโยงด้านล่าง)</p>}
      <dl className="facts">
        <dt>Degree</dt>
        <dd>{fmtInt(n.degree)}</dd>
        <dt>Betweenness</dt>
        <dd>{n.betweenness.toFixed(3)}</dd>
        <dt>PageRank</dt>
        <dd>{n.pagerank.toFixed(3)}</dd>
        <dt>กลุ่ม (Louvain)</dt>
        <dd>{n.community + 1}</dd>
      </dl>
      <div className="panel-actions">
        <button className="btn small" type="button" onClick={() => openPeer(n.id)}>
          ดูรายการติดต่อทั้งหมด
        </button>
        {focusId === n.id ? (
          <button className="btn small" type="button" onClick={() => onFocus(undefined)}>
            แสดงทั้งผัง
          </button>
        ) : (
          <button className="btn small" type="button" onClick={() => onFocus(n.id)}>
            แสดงเฉพาะเครือข่ายรอบเลขนี้
          </button>
        )}
        <button className="btn small ghost" type="button" onClick={() => onSelect(undefined)}>
          ล้างการเลือก
        </button>
      </div>
    </div>
  );
}
