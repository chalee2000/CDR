import { useEffect, useRef, useState } from 'react';
import { cleanProfile, formatNationalId, nationalIdProblem, type PersonProfile, type ProfileTextField } from '../lib/profiles';
import { useStore } from '../state/store';
import { photoToDataUrl } from './photo';

const FIELDS: { key: ProfileTextField; label: string; rows?: number; placeholder?: string; wide?: boolean; check?: (v: string | undefined) => string | undefined }[] = [
  { key: 'firstName', label: 'ชื่อ (รวมคำนำหน้า)', placeholder: 'เช่น นายสมมติ' },
  { key: 'lastName', label: 'นามสกุล' },
  { key: 'nickname', label: 'ชื่อเล่น/ฉายา' },
  { key: 'nationalId', label: 'เลขบัตรประชาชน', placeholder: 'เลข 13 หลัก', check: nationalIdProblem },
  { key: 'address', label: 'ที่อยู่', rows: 2, wide: true },
  { key: 'criminalRecord', label: 'ประวัติคดีอาญา (บรรทัดละ 1 คดี)', rows: 4, wide: true, placeholder: 'เช่น ยาเสพติด (ครอบครองเพื่อจำหน่าย) คดีอาญาที่ …/2565 สภ.…' },
  { key: 'parcelLocation', label: 'พิกัดรับพัสดุ (บรรทัดละ 1 จุด)', rows: 2, wide: true, placeholder: 'เช่น 13.7563, 100.5018 — ที่รับพัสดุ/บริษัทขนส่ง' },
  { key: 'notes', label: 'หมายเหตุ', rows: 2, wide: true },
];

/** Add or edit the person behind a number: name, address, criminal record, photo. */
export function ProfileDialog() {
  const { profileEditor: number, openProfileEditor, profiles, saveProfile, removeProfile, datasets } = useStore();
  const [draft, setDraft] = useState<PersonProfile>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const first = useRef<HTMLInputElement>(null);

  // Start from the saved profile each time the dialog opens for a number.
  useEffect(() => {
    if (!number) return;
    const saved = profiles[number];
    // The ID is stored as bare digits; edit it as printed on the card.
    setDraft(saved ? { ...saved, nationalId: saved.nationalId && formatNationalId(saved.nationalId) } : { number, updatedAt: 0 });
    setError(undefined);
    const t = setTimeout(() => first.current?.focus(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [number]);

  useEffect(() => {
    if (!number) return;
    // Capture phase: Escape closes this dialog only, not the drawer beneath it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      openProfileEditor(undefined);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [number, openProfileEditor]);

  if (!number || !draft || draft.number !== number) return null;
  const close = () => openProfileEditor(undefined);
  const target = datasets.find((d) => d.target === number);

  const takePhoto = async (blob: Blob) => {
    setBusy(true);
    try {
      const photo = await photoToDataUrl(blob);
      setDraft((d) => d && { ...d, photo });
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    const clean = cleanProfile(draft);
    if (clean) saveProfile(clean);
    else removeProfile(number);
    close();
  };

  return (
    <>
      <div className="backdrop top" onClick={close} />
      <div
        className="dialog profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
        onPaste={(e) => {
          const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'));
          const f = item?.getAsFile();
          if (f) {
            e.preventDefault();
            void takePhoto(f);
          }
        }}
      >
        <h2 id="profile-title" style={{ fontSize: 18 }}>
          ข้อมูลบุคคลของเลข <span className="mono">{number}</span>
          {target && <span className="badge accent" style={{ marginLeft: 8, verticalAlign: 'middle' }}>เป้าหมาย</span>}
        </h2>
        <div className="profile-grid">
          <div
            className={`photo-drop${over ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
              if (f) void takePhoto(f);
            }}
          >
            {draft.photo ? <img className="person-photo xl" src={draft.photo} alt="รูปบุคคล" /> : <div className="person-photo xl placeholder" aria-hidden="true" />}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button className="btn small" type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
                {busy ? 'กำลังย่อรูป…' : draft.photo ? 'เปลี่ยนรูป' : 'เลือกรูป'}
              </button>
              {draft.photo && (
                <button className="btn small ghost" type="button" onClick={() => setDraft({ ...draft, photo: undefined })}>
                  ลบรูป
                </button>
              )}
            </div>
            <p className="caveat" style={{ margin: 0, textAlign: 'center' }}>
              ลากรูปมาวาง หรือกด Ctrl+V เพื่อวางรูปที่คัดลอกไว้ · รูปถูกย่อเป็น 256×256 และตัดข้อมูลแฝง (EXIF/GPS) ออก
            </p>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              data-testid="photo-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void takePhoto(f);
              }}
            />
          </div>
          <div className="profile-fields">
            {FIELDS.map((f, i) => {
              const problem = f.check?.(draft[f.key]);
              return (
                <label key={f.key} className={`field${f.wide ? ' wide' : ''}`}>
                  <span>{f.label}</span>
                  {f.rows ? (
                    <textarea className="input" rows={f.rows} placeholder={f.placeholder} value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
                  ) : (
                    <input
                      ref={i === 0 ? first : undefined}
                      className="input"
                      placeholder={f.placeholder}
                      value={draft[f.key] ?? ''}
                      onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && save()}
                      aria-invalid={problem ? true : undefined}
                      aria-describedby={problem ? `${f.key}-problem` : undefined}
                    />
                  )}
                  {problem && (
                    <small id={`${f.key}-problem`} className="field-warn">
                      {problem}
                    </small>
                  )}
                </label>
              );
            })}
          </div>
        </div>
        {error && (
          <p className="note warn" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        <p className="caveat" style={{ margin: 0 }}>
          ข้อมูลนี้ผู้ใช้กรอกเอง ไม่ได้มาจากไฟล์ CDR และอยู่ในหน้านี้เท่านั้น — กด "บันทึกเป็นไฟล์" ที่แถบด้านซ้าย หรือ "สำรอง/กู้ไฟล์" ที่แถบด้านบน เพื่อเก็บไว้ใช้ครั้งหน้า
        </p>
        <div className="dialog-actions">
          {profiles[number] && (
            <button
              className="btn ghost danger"
              type="button"
              onClick={() => {
                removeProfile(number);
                close();
              }}
            >
              ลบข้อมูลของเลขนี้
            </button>
          )}
          <span className="spacer" />
          <button className="btn" type="button" onClick={close}>
            ยกเลิก
          </button>
          <button className="btn primary" type="button" onClick={save} disabled={busy}>
            บันทึก
          </button>
        </div>
      </div>
    </>
  );
}
