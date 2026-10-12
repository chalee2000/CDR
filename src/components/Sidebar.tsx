import { useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { decodeText } from '../lib/io/readWorkbook';
import { normHeader } from '../lib/parsers/table';
import { summarize } from '../lib/analysis/summary';
import { fmtDate } from '../lib/time';
import type { ImportedCoords } from '../lib/analysis/locations';
import { useStore } from '../state/store';
import { Swatch } from './bits';

export function ImportPanel() {
  const { addFiles, loadSamples, busy } = useStore();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <section className="side-section">
      <h2>นำเข้าไฟล์ CDR</h2>
      <div
        className={`dropzone${over ? ' over' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void addFiles([...e.dataTransfer.files]);
        }}
      >
        <strong>{busy ? 'กำลังอ่านไฟล์…' : 'ลากไฟล์มาวาง หรือคลิกเพื่อเลือก'}</strong>
        <p>.xlsx หรือ .csv เลือกได้หลายไฟล์ (AIS, True/DTAC และตารางทั่วไป)</p>
      </div>
      <input
        ref={input}
        type="file"
        accept=".xlsx,.xlsm,.csv,.txt"
        multiple
        hidden
        data-testid="file-input"
        onChange={(e) => {
          void addFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      <button className="btn" type="button" style={{ width: '100%', marginTop: 8 }} onClick={loadSamples}>
        ใช้ข้อมูลตัวอย่าง (สมมติ)
      </button>
    </section>
  );
}

export function DatasetList() {
  const { datasets, selectedId, select, removeDataset, setLabel, clearAll, settings } = useStore();
  const [editing, setEditing] = useState<string>();
  const summaries = useMemo(() => new Map(datasets.map((d) => [d.id, summarize(d, settings)])), [datasets, settings]);
  if (datasets.length === 0) return null;
  return (
    <section className="side-section">
      <h2 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>เป้าหมาย ({datasets.length})</span>
        <button className="btn ghost small danger" type="button" onClick={clearAll}>
          ล้างทั้งหมด
        </button>
      </h2>
      <ul className="ds-list">
        {datasets.map((d) => {
          const s = summaries.get(d.id)!;
          return (
            <li key={d.id} className="ds-item" aria-current={d.id === selectedId} onClick={() => select(d.id)}>
              <Swatch slot={d.slot} />
              <div style={{ minWidth: 0 }}>
                <div className="num mono">{d.target || '(ไม่พบหมายเลข)'}</div>
                {editing === d.id ? (
                  <input
                    className="input"
                    autoFocus
                    defaultValue={d.label === d.target ? '' : d.label}
                    placeholder="ชื่อเรียก เช่น นาย ก."
                    aria-label="ชื่อเรียกของเป้าหมาย"
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      setLabel(d.id, e.target.value);
                      setEditing(undefined);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setEditing(undefined);
                    }}
                    style={{ width: '100%', margin: '2px 0' }}
                  />
                ) : (
                  d.label !== d.target && <div style={{ fontSize: 13.5 }}>{d.label}</div>
                )}
                <div className="meta">
                  {d.meta.operator ?? d.meta.formatLabel} · {s.records.toLocaleString('th-TH')} รายการ
                </div>
                <div className="meta">
                  {fmtDate(s.firstTs, settings.yearStyle)} – {fmtDate(s.lastTs, settings.yearStyle)}
                </div>
                <div className="meta" title={d.fileName} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.fileName}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <button
                  className="icon-btn"
                  type="button"
                  title="ตั้งชื่อเรียก"
                  aria-label={`ตั้งชื่อเรียก ${d.target}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(d.id);
                  }}
                >
                  ✎
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  title="นำออก"
                  aria-label={`นำ ${d.target} ออก`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeDataset(d.id);
                  }}
                >
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Cell coordinates CSV: one id column (ECI / CELL_ID / CI / SITE_NAME) + LAT + LON. */
function parseCoordCsv(text: string): ImportedCoords {
  const rows = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' }).data;
  const header = (rows[0] ?? []).map(normHeader);
  const find = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const lat = find('LAT', 'LATITUDE', 'ละติจูด');
  const lon = find('LON', 'LNG', 'LONG', 'LONGITUDE', 'ลองจิจูด');
  const eci = find('ECI', 'ECGI');
  const cell = find('CELL_ID', 'CELL_NAME', 'CELL', 'CELLNAME');
  const lac = find('LAC', 'LAC_ID');
  const ci = find('CI', 'CID');
  const site = find('SITE_NAME', 'SITE', 'ชื่อเสา', 'ชื่อสถานี');
  if (lat < 0 || lon < 0) throw new Error('ต้องมีคอลัมน์ LAT/LATITUDE และ LON/LONGITUDE');
  const out: ImportedCoords = new Map();
  for (const r of rows.slice(1)) {
    const la = Number(r[lat]);
    const lo = Number(r[lon]);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || la === 0 || lo === 0) continue;
    const v: [number, number] = [la, lo];
    if (eci >= 0 && r[eci]) out.set(`ECI:${r[eci].trim()}`, v);
    if (cell >= 0 && r[cell]) out.set(`CELL:${r[cell].trim().toUpperCase()}`, v);
    if (ci >= 0 && r[ci]) {
      out.set(`CI:${lac >= 0 ? (r[lac] ?? '').trim() : ''}-${r[ci].trim()}`, v);
      out.set(`CI:${r[ci].trim()}`, v);
    }
    if (site >= 0 && r[site]) out.set(`SITE:${r[site].trim().toUpperCase()}`, v);
  }
  return out;
}

export function SettingsPanel() {
  const { settings: s, setSettings, resetSettings, coordImport, setCoordImport } = useStore();
  const coordInput = useRef<HTMLInputElement>(null);
  const [coordError, setCoordError] = useState<string>();
  const num = (key: keyof typeof s, min: number, max: number) => ({
    type: 'number' as const,
    min,
    max,
    value: s[key] as number,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value);
      if (Number.isFinite(v) && v >= min && v <= max) setSettings({ [key]: v } as never);
    },
  });
  const hours = Array.from({ length: 24 }, (_, i) => i);
  return (
    <section className="side-section">
      <details className="settings">
        <summary>การตั้งค่าการวิเคราะห์</summary>
        <div className="settings-grid">
          <div className="field">
            <span>เวลาในไฟล์ที่ลงท้ายด้วย "Z"</span>
            <div className="seg" role="group" aria-label="การตีความเวลา">
              <button type="button" aria-pressed={s.zMode === 'local'} onClick={() => setSettings({ zMode: 'local' })}>
                เวลาไทยตามไฟล์
              </button>
              <button type="button" aria-pressed={s.zMode === 'utc'} onClick={() => setSettings({ zMode: 'utc' })}>
                UTC → +7 ชม.
              </button>
            </div>
          </div>
          <div className="row2">
            <label className="field">
              <span>กลางคืนเริ่ม</span>
              <select className="input" value={s.nightStart} onChange={(e) => setSettings({ nightStart: Number(e.target.value) })}>
                {hours.map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>กลางคืนสิ้นสุด</span>
              <select className="input" value={s.nightEnd} onChange={(e) => setSettings({ nightEnd: Number(e.target.value) })}>
                {hours.map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={s.dedupeExact} onChange={(e) => setSettings({ dedupeExact: e.target.checked })} />
            <span>รวมแถวที่ซ้ำกันทุกคอลัมน์ให้เหลือรายการเดียว</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={s.includeServiceNumbers} onChange={(e) => setSettings({ includeServiceNumbers: e.target.checked })} />
            <span>รวมเลขบริการ/ชื่อผู้ส่ง (เช่น AIS, 900515) ในผังเครือข่ายและผู้ติดต่อร่วม</span>
          </label>
          <div className="row2">
            <label className="field">
              <span>อยู่พื้นที่เดียวกัน ± นาที</span>
              <input className="input" {...num('coLocationMinutes', 1, 720)} />
            </label>
            <label className="field">
              <span>ระยะห่าง (กม.)</span>
              <input className="input" step={0.5} {...num('coLocationKm', 0.1, 50)} />
            </label>
          </div>
          <div className="row2">
            <label className="field">
              <span>ติดต่อทอด ภายใน นาที</span>
              <input className="input" {...num('relayMinutes', 1, 1440)} />
            </label>
            <label className="field">
              <span>ช่วงเงียบ ≥ ชม.</span>
              <input className="input" {...num('silenceHours', 1, 720)} />
            </label>
          </div>
          <div className="row2">
            <label className="field">
              <span>โทรถี่ ≥ ครั้ง</span>
              <input className="input" {...num('burstCount', 2, 100)} />
            </label>
            <label className="field">
              <span>ภายใน นาที</span>
              <input className="input" {...num('burstMinutes', 1, 240)} />
            </label>
          </div>
          <div className="field">
            <span>การแสดงปี</span>
            <div className="seg" role="group" aria-label="การแสดงปี">
              <button type="button" aria-pressed={s.yearStyle === 'ce'} onClick={() => setSettings({ yearStyle: 'ce' })}>
                ค.ศ.
              </button>
              <button type="button" aria-pressed={s.yearStyle === 'be'} onClick={() => setSettings({ yearStyle: 'be' })}>
                พ.ศ.
              </button>
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={s.showBasemap} onChange={(e) => setSettings({ showBasemap: e.target.checked })} />
            <span>แผนที่ฐานออนไลน์ (OpenStreetMap) — ต้องใช้อินเทอร์เน็ต และผู้ให้บริการแผนที่จะทราบพื้นที่ที่เปิดดู</span>
          </label>
          <div className="field">
            <span>พิกัดเสาเพิ่มเติม (CSV: ECI/CELL_ID/SITE_NAME + LAT + LON)</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn small" type="button" onClick={() => coordInput.current?.click()}>
                นำเข้าไฟล์พิกัด
              </button>
              {coordImport && (
                <button className="btn small ghost" type="button" onClick={() => setCoordImport(undefined)}>
                  ล้าง ({coordImport.coords.size.toLocaleString('th-TH')} รายการ)
                </button>
              )}
            </div>
            {coordError && <span style={{ color: 'var(--danger)' }}>{coordError}</span>}
            <input
              ref={coordInput}
              type="file"
              accept=".csv,.txt"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  const coords = parseCoordCsv(decodeText(await f.arrayBuffer()));
                  setCoordImport({ name: f.name, coords });
                  setCoordError(undefined);
                } catch (err) {
                  setCoordError(err instanceof Error ? err.message : String(err));
                }
              }}
            />
          </div>
          <button className="btn small ghost" type="button" onClick={resetSettings}>
            คืนค่าเริ่มต้น
          </button>
        </div>
      </details>
    </section>
  );
}
