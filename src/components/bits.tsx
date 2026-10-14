import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { datasetName } from '../lib/dataset';
import { PEER_KIND_TH } from '../lib/labels';
import { slotColor } from '../lib/palette';
import { personName } from '../lib/profiles';
import type { Dataset, PeerKind } from '../lib/types';
import { useEffectiveTheme, useStore } from '../state/store';

/** A party number that opens the contact drawer (with the person's name when known). */
export function NumberLink({ peer, kind, country, showName = true }: { peer?: string; kind?: PeerKind; country?: string; showName?: boolean }) {
  const { openPeer, datasets, profiles } = useStore();
  if (!peer) return <span>-</span>;
  const isTarget = datasets.some((d) => d.target === peer);
  const name = showName ? personName(profiles[peer]) : undefined;
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <button className="link-btn mono" type="button" onClick={() => openPeer(peer)} title="ดูรายละเอียดการติดต่อ">
        {peer}
      </button>
      {name && (
        <span className="person-tag" title="ข้อมูลบุคคลที่ผู้ใช้กรอก">
          {name}
        </span>
      )}
      {isTarget && <span className="badge accent">เป้าหมาย</span>}
      {kind && kind !== 'mobile' && (
        <span className="badge" title={PEER_KIND_TH[kind]}>
          {kind === 'intl' && country ? country : PEER_KIND_TH[kind]}
        </span>
      )}
    </span>
  );
}

export function Swatch({ slot, round }: { slot: number; round?: boolean }) {
  const mode = useEffectiveTheme();
  return <i aria-hidden="true" className={`swatch${round ? ' round' : ''}`} style={{ background: slotColor(slot, mode) }} />;
}

export function TargetTag({ ds }: { ds: Pick<Dataset, 'slot' | 'label' | 'target'> }) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <Swatch slot={ds.slot} />
      <span className="mono">{datasetName(ds)}</span>
    </span>
  );
}

/** Metric families: each colours a tile's rule and icon (the text stays in ink). */
export type KpiTone = 'call' | 'sms' | 'night' | 'time' | 'people' | 'place' | 'device' | 'data';

export function Kpi({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: KpiTone; icon?: IconName }) {
  return (
    <div className="kpi" data-tone={tone}>
      <div className="label">
        {icon && (
          <span className="kpi-icon">
            <Icon name={icon} size={15} />
          </span>
        )}
        <span>{label}</span>
      </div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Caveat({ children }: { children: ReactNode }) {
  return (
    <p className="caveat" style={{ margin: 0 }}>
      <span aria-hidden="true">ⓘ</span>
      <span>{children}</span>
    </p>
  );
}

/** Target picker for the per-target views: one filter row above the content. */
export function DatasetPicker() {
  const { datasets, selectedId, select } = useStore();
  if (datasets.length < 2) return null;
  return (
    <div className="filters" role="group" aria-label="เลือกเป้าหมาย">
      <span className="caveat">เป้าหมาย:</span>
      {datasets.map((d) => (
        <button key={d.id} type="button" className="chip" aria-pressed={d.id === selectedId} onClick={() => select(d.id)}>
          <Swatch slot={d.slot} />
          <span className="mono">{datasetName(d)}</span>
        </button>
      ))}
    </div>
  );
}

export function Section({ title, sub, children, actions }: { title: string; sub?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      <header>
        <div>
          <h3>{title}</h3>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {actions && <div className="no-print">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
