import { useEffect, useMemo, useRef, useState } from 'react';
import type { FlatField } from '../lib/types';
import { useStore } from '../state/store';

const FIELDS: { key: FlatField; label: string; required?: boolean }[] = [
  { key: 'time', label: 'วันเวลาเริ่ม (หรือเลือก "วันที่" + "เวลา")' },
  { key: 'date', label: 'วันที่ (กรณีแยกคอลัมน์)' },
  { key: 'clock', label: 'เวลา (กรณีแยกคอลัมน์)' },
  { key: 'a', label: 'หมายเลข A (ต้นทาง/เป้าหมาย)', required: true },
  { key: 'b', label: 'หมายเลข B (ปลายทาง/คู่สาย)', required: true },
  { key: 'type', label: 'ประเภทรายการ (MOC/MTC/SMS…)' },
  { key: 'duration', label: 'ระยะเวลา (วินาที)' },
  { key: 'imei', label: 'IMEI' },
  { key: 'imsi', label: 'IMSI' },
  { key: 'site', label: 'ชื่อเสา/สถานี' },
  { key: 'ci', label: 'Cell ID' },
  { key: 'tumbol', label: 'ตำบล' },
  { key: 'amphur', label: 'อำเภอ' },
  { key: 'province', label: 'จังหวัด' },
  { key: 'lat', label: 'ละติจูด' },
  { key: 'lon', label: 'ลองจิจูด' },
];

/** Shown when a file's columns cannot be recognised automatically. */
export function ColumnMappingDialog() {
  const { mappingRequest, resolveMapping } = useStore();
  const [sheetName, setSheetName] = useState<string>();
  const [cols, setCols] = useState<Partial<Record<FlatField, number>>>({});
  const [target, setTarget] = useState('');
  const first = useRef<HTMLSelectElement>(null);

  const suggestion = useMemo(() => {
    if (!mappingRequest) return undefined;
    return mappingRequest.suggestions.find((s) => s.sheet === sheetName) ?? mappingRequest.suggestions[0];
  }, [mappingRequest, sheetName]);

  useEffect(() => {
    if (suggestion) setCols(suggestion.columns);
  }, [suggestion]);

  useEffect(() => {
    setSheetName(undefined);
    setTarget('');
    first.current?.focus();
  }, [mappingRequest]);

  if (!mappingRequest || !suggestion) return null;
  const valid = (cols.time !== undefined || cols.date !== undefined) && cols.a !== undefined && cols.b !== undefined;

  return (
    <>
      <div className="backdrop" />
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="map-title">
        <h2 id="map-title" style={{ fontSize: 18 }}>
          ระบุคอลัมน์ของไฟล์ {mappingRequest.file.raw.fileName}
        </h2>
        <p className="note warn" style={{ margin: 0 }}>
          {mappingRequest.reason}
        </p>
        {mappingRequest.suggestions.length > 1 && (
          <label className="field">
            <span>ชีต</span>
            <select className="input" value={suggestion.sheet} onChange={(e) => setSheetName(e.target.value)}>
              {mappingRequest.suggestions.map((s) => (
                <option key={s.sheet} value={s.sheet}>
                  {s.sheet}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="grid three" style={{ gap: 10 }}>
          {FIELDS.map((f, i) => (
            <label className="field" key={f.key}>
              <span>
                {f.label}
                {f.required && ' *'}
              </span>
              <select
                ref={i === 0 ? first : undefined}
                className="input"
                value={cols[f.key] ?? ''}
                onChange={(e) => setCols((c) => ({ ...c, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) }))}
              >
                <option value="">— ไม่มี —</option>
                {suggestion.headers.map((h, idx) => (
                  <option key={idx} value={idx}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="field">
            <span>หมายเลขเป้าหมาย (ถ้าทราบ)</span>
            <input className="input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="เช่น 0812345678" />
          </label>
        </div>
        <div className="table-wrap" style={{ maxHeight: 180, overflow: 'auto' }}>
          <table className="data" aria-label="ตัวอย่างข้อมูล">
            <thead>
              <tr>
                {suggestion.headers.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {suggestion.sampleRows.map((r, i) => (
                <tr key={i}>
                  {suggestion.headers.map((_, j) => (
                    <td key={j} className="nowrap">
                      {r[j] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" type="button" onClick={() => resolveMapping(null)}>
            ข้ามไฟล์นี้
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={!valid}
            onClick={() => resolveMapping({ sheet: suggestion.sheet, headerRow: suggestion.headerRow, columns: cols, target: target.trim() || undefined })}
          >
            วิเคราะห์ไฟล์นี้
          </button>
        </div>
      </div>
    </>
  );
}

export function Toasts() {
  const { messages, dismiss } = useStore();
  useEffect(() => {
    const infos = messages.filter((m) => m.kind === 'info');
    if (!infos.length) return;
    const t = setTimeout(() => infos.forEach((m) => dismiss(m.id)), 7000);
    return () => clearTimeout(t);
  }, [messages, dismiss]);
  if (!messages.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {messages.map((m) => (
        <div key={m.id} className={`toast ${m.kind}`}>
          <p>{m.text}</p>
          <button className="icon-btn" type="button" aria-label="ปิด" onClick={() => dismiss(m.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
