import { useMemo, useState } from 'react';
import { activeInteractions } from '../lib/dataset';
import { siteLabelOf } from '../lib/analysis/locations';
import { categoryOf, CATEGORY_TH, interactionLabel, SOURCE_TH, type Category } from '../lib/labels';
import { dayKey, fmtDateTime, fmtDuration, isoText } from '../lib/time';
import type { Interaction } from '../lib/types';
import { formatBytes } from '../lib/util';
import { DataTable, type Column } from '../components/DataTable';
import { DatasetPicker, NumberLink, Section } from '../components/bits';
import { useStore } from '../state/store';

const CATS: Category[] = ['callOut', 'callIn', 'callFwd', 'smsOut', 'smsIn', 'data', 'wifi', 'other'];

export function RecordsView() {
  const { selected: ds, settings } = useStore();
  const [cats, setCats] = useState<Set<Category>>(new Set(CATS.filter((c) => c !== 'data')));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const items = useMemo(() => (ds ? activeInteractions(ds, settings) : []), [ds, settings]);
  const present = useMemo(() => new Set(items.map((i) => categoryOf(i.service, i.direction))), [items]);
  const rows = useMemo(
    () =>
      items.filter((i) => {
        if (!cats.has(categoryOf(i.service, i.direction))) return false;
        const d = dayKey(i.ts);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      }),
    [items, cats, from, to],
  );
  if (!ds) return null;
  const y = settings.yearStyle;

  const cols: Column<Interaction>[] = [
    { key: 'ts', header: 'วันเวลา', render: (i) => <span className="nowrap mono">{fmtDateTime(i.ts, y)}</span>, sortValue: (i) => i.ts, csv: (i) => isoText(i.ts) },
    { key: 'type', header: 'ประเภท', render: (i) => interactionLabel(i), sortValue: (i) => interactionLabel(i) },
    { key: 'peer', header: 'คู่ติดต่อ', render: (i) => (i.peer ? <NumberLink peer={i.peer} kind={i.peerKind} country={i.peerCountry} /> : '-'), sortValue: (i) => i.peer },
    {
      key: 'dur',
      header: 'ระยะเวลา / ข้อมูล',
      num: true,
      render: (i) => (i.service === 'data' || i.service === 'wifi' ? formatBytes(i.bytes) : i.service === 'call' ? fmtDuration(i.durationSec) : '-'),
      sortValue: (i) => (i.service === 'data' || i.service === 'wifi' ? i.bytes : i.durationSec),
    },
    { key: 'site', header: 'เสาของเป้าหมาย', render: (i) => (i.targetObs?.cell ? siteLabelOf(i.targetObs.cell).label : '-'), sortValue: (i) => (i.targetObs?.cell ? siteLabelOf(i.targetObs.cell).label : undefined) },
    { key: 'area', header: 'อำเภอ / จังหวัด', render: (i) => [i.targetObs?.cell?.amphur, i.targetObs?.cell?.province].filter(Boolean).join(' · ') || '-', sortValue: (i) => `${i.targetObs?.cell?.province ?? ''}${i.targetObs?.cell?.amphur ?? ''}` },
    { key: 'cell', header: 'เซลล์', render: (i) => <span className="mono">{i.targetObs?.cell?.cellId ?? '-'}</span>, sortValue: (i) => i.targetObs?.cell?.cellId },
    { key: 'imei', header: 'IMEI', render: (i) => <span className="mono">{i.targetObs?.imei ?? '-'}</span>, sortValue: (i) => i.targetObs?.imei },
    { key: 'peerSite', header: 'เสาของคู่สาย', render: (i) => (i.peerObs?.cell ? siteLabelOf(i.peerObs.cell).label : ''), sortValue: (i) => (i.peerObs?.cell ? siteLabelOf(i.peerObs.cell).label : undefined) },
    { key: 'src', header: 'แหล่ง', render: (i) => SOURCE_TH[i.source], sortValue: (i) => i.source },
    {
      key: 'row',
      header: 'แถวในไฟล์',
      render: (i) => (
        <span className="mono" title={i.extra ? Object.entries(i.extra).map(([k, v]) => `${k}: ${v}`).join('\n') : undefined}>
          {i.rowRefs.join(', ')}
          {i.dupOfPrev ? ' (ซ้ำ)' : ''}
        </span>
      ),
      csv: (i) => i.rowRefs.join(' '),
    },
  ];

  return (
    <>
      <DatasetPicker />
      <Section title={`รายการทั้งหมดของ ${ds.target}`} sub="อ้างอิงกลับไปยังชีตและแถวในไฟล์ต้นฉบับได้ (คอลัมน์ “แถวในไฟล์”)">
        <div className="filters" style={{ marginBottom: 10 }}>
          {CATS.filter((c) => present.has(c)).map((c) => (
            <button
              key={c}
              type="button"
              className="chip"
              aria-pressed={cats.has(c)}
              onClick={() =>
                setCats((s) => {
                  const n = new Set(s);
                  if (n.has(c)) n.delete(c);
                  else n.add(c);
                  return n;
                })
              }
            >
              {CATEGORY_TH[c]}
            </button>
          ))}
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <span>ตั้งแต่</span>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <span>ถึง</span>
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <DataTable
          label="รายการข้อมูล"
          rows={rows}
          columns={cols}
          initialSort={{ key: 'ts', dir: 'asc' }}
          pageSize={100}
          search={(i) => `${i.peer ?? ''} ${i.peerRaw ?? ''} ${i.targetObs?.cell ? siteLabelOf(i.targetObs.cell).label : ''} ${i.targetObs?.cell?.cellId ?? ''} ${i.targetObs?.cell?.amphur ?? ''} ${i.targetObs?.cell?.province ?? ''} ${i.targetObs?.imei ?? ''}`}
          searchPlaceholder="ค้นหาเลขหมาย เสา อำเภอ IMEI…"
          csvName={`records-${ds.target}`}
        />
      </Section>
    </>
  );
}
