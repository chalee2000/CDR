import { useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { decodeText } from '../lib/io/readWorkbook';
import { normHeader } from '../lib/parsers/table';
import { summarize } from '../lib/analysis/summary';
import { fmtDate } from '../lib/time';
import type { ImportedCoords } from '../lib/analysis/locations';
import { SETTING_LIMITS } from '../lib/types';
import { parseProfilesFile, personName, profilesFileName, serializeProfiles } from '../lib/profiles';
import { useStore } from '../state/store';
import { Swatch } from './bits';
import { downloadBlob } from './download';
import { reencodePhoto } from './photo';

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
        <p>.xlsx หรือ .csv เลือกได้หลายไฟล์ (AIS, True/DTAC และตารางทั่วไป) · วางไฟล์สำรอง .cdrbak เพื่อกู้งาน</p>
      </div>
      <input
        ref={input}
        type="file"
        accept=".xlsx,.xlsm,.csv,.txt,.cdrbak"
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
  const { datasets, selectedId, select, removeDataset, setLabel, clearAll, settings, profiles, openProfileEditor } = useStore();
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
                {personName(profiles[d.target]) && <div className="person-tag">{personName(profiles[d.target])}</div>}
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
                  title="ข้อมูลบุคคล (ชื่อ ที่อยู่ ประวัติคดี รูป)"
                  aria-label={`ข้อมูลบุคคลของ ${d.target}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    openProfileEditor(d.target);
                  }}
                >
                  👤
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

/** Person details: kept in page memory, saved to and opened from a file. */
export function ProfilePanel() {
  const { profiles, profilesDirty, loadProfiles, clearProfiles, markProfilesSaved, notify } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [opening, setOpening] = useState(false);
  const count = Object.keys(profiles).length;

  const save = () => {
    downloadBlob(new Blob([serializeProfiles(profiles)], { type: 'application/json' }), profilesFileName());
    markProfilesSaved();
  };
  const open = async (f: File) => {
    setOpening(true);
    try {
      const { profiles: list, skipped } = parseProfilesFile(await f.text());
      // Photos from a file are decoded and re-encoded before use.
      const clean = await Promise.all(list.map(async (p) => (p.photo ? { ...p, photo: await reencodePhoto(p.photo) } : p)));
      const { added, replaced } = loadProfiles(clean);
      notify('info', `เปิด ${f.name}: เพิ่ม ${added} รายการ${replaced ? ` แทนที่ ${replaced} รายการ` : ''}${skipped ? ` (ข้ามรายการที่ใช้ไม่ได้ ${skipped})` : ''}`);
    } catch (e) {
      notify('error', `${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setOpening(false);
    }
  };

  return (
    <section className="side-section">
      <h2 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <span>ข้อมูลบุคคล{count > 0 ? ` (${count})` : ''}</span>
        {profilesDirty && <span className="badge warn">ยังไม่ได้บันทึก</span>}
      </h2>
      <p className="meta" style={{ margin: '0 0 6px' }}>
        {count > 0 ? `มีชื่อ/ที่อยู่/ประวัติ/รูป ของ ${count} เลขหมาย` : 'คลิกเลขหมายในผังเครือข่ายหรือรายการติดต่อเพื่อเพิ่มชื่อ ที่อยู่ ประวัติคดี และรูป'}
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn small" type="button" onClick={() => input.current?.click()} disabled={opening}>
          {opening ? 'กำลังเปิด…' : 'เปิดไฟล์ข้อมูลบุคคล'}
        </button>
        <button className={`btn small${profilesDirty ? ' primary' : ''}`} type="button" onClick={save} disabled={count === 0}>
          บันทึกเป็นไฟล์
        </button>
        {count > 0 && (
          <button
            className="btn small ghost danger"
            type="button"
            onClick={() => {
              if (!profilesDirty || window.confirm('ข้อมูลบุคคลที่ยังไม่ได้บันทึกเป็นไฟล์จะหายไป ต้องการล้างหรือไม่')) clearProfiles();
            }}
          >
            ล้าง
          </button>
        )}
      </div>
      <p className="caveat" style={{ margin: '6px 0 0' }}>
        ข้อมูลอยู่ในหน้านี้เท่านั้น ปิดหน้าแล้วหาย · ไฟล์ที่บันทึกมีข้อมูลส่วนบุคคล ให้เก็บรักษาตามระเบียบของหน่วยงาน
      </p>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="profiles-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void open(f);
        }}
      />
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
  const num = (key: keyof typeof SETTING_LIMITS) => {
    const { min, max, int } = SETTING_LIMITS[key];
    return {
      type: 'number' as const,
      min,
      max,
      value: s[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v >= min && v <= max && (!int || Number.isInteger(v))) setSettings({ [key]: v });
      },
    };
  };
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
              <input className="input" {...num('coLocationMinutes')} />
            </label>
            <label className="field">
              <span>ระยะห่าง (กม.)</span>
              <input className="input" step={0.5} {...num('coLocationKm')} />
            </label>
          </div>
          <div className="row2">
            <label className="field">
              <span>ติดต่อทอด ภายใน นาที</span>
              <input className="input" {...num('relayMinutes')} />
            </label>
            <label className="field">
              <span>ช่วงเงียบ ≥ ชม.</span>
              <input className="input" {...num('silenceHours')} />
            </label>
          </div>
          <div className="row2">
            <label className="field">
              <span>โทรถี่ ≥ ครั้ง</span>
              <input className="input" {...num('burstCount')} />
            </label>
            <label className="field">
              <span>ภายใน นาที</span>
              <input className="input" {...num('burstMinutes')} />
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
