import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  backupFileName,
  canEncrypt,
  MIN_PASSWORD_LENGTH,
  readBackup,
  readBackupHeader,
  summarizeSnapshot,
  writeBackup,
  type BackupHeader,
  type RestoredBackup,
} from '../lib/backup';
import { hasContent } from '../lib/profiles';
import { fmtDateTime } from '../lib/time';
import { useStore } from '../state/store';
import { Swatch, TargetTag } from './bits';
import { downloadBlob } from './download';
import { reencodePhoto } from './photo';

const n = (v: number) => v.toLocaleString('th-TH');
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function fmtSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${n(Math.max(1, Math.round(bytes / 1024)))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A real instant (ISO text) as the wall-clock milliseconds the date helpers expect. */
function wallClock(iso: string): number {
  const t = Date.parse(iso);
  return t - new Date(t).getTimezoneOffset() * 60_000;
}

/** While a dialog is open, Escape closes it rather than the drawer or page beneath it. */
function useEscape(active: boolean, onEscape: () => void) {
  const ref = useRef(onEscape);
  ref.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      ref.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);
}

/** Top-bar menu: save the whole session to one file, or open such a file to carry on. */
export function BackupMenu() {
  const { datasets, profiles, coordImport, requestRestore } = useStore();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [alignLeft, setAlignLeft] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const canBackup = datasets.length > 0 || Object.keys(profiles).length > 0 || !!coordImport;

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    // Open towards the side with room, so the menu stays on screen on a phone.
    if (!open && button.current) setAlignLeft(button.current.getBoundingClientRect().right < 300);
    setOpen(!open);
  };

  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(e.key)) return;
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    e.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div className="menu-wrap no-print">
      <button ref={button} className="btn" type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={toggle}>
        สำรอง/กู้ไฟล์ <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div ref={menu} id={menuId} className={`menu${alignLeft ? ' left' : ''}`} role="menu" aria-label="สำรองและกู้ไฟล์งาน" onKeyDown={onMenuKey}>
          <button
            role="menuitem"
            type="button"
            disabled={!canBackup}
            onClick={() => {
              setOpen(false);
              setDialog(true);
            }}
          >
            <strong>สำรองไฟล์…</strong>
            <small>{canBackup ? 'บันทึกงานทั้งหมดเป็นไฟล์เดียว (.cdrbak)' : 'ยังไม่มีงานให้สำรอง'}</small>
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              input.current?.click();
            }}
          >
            <strong>กู้ไฟล์…</strong>
            <small>เปิดไฟล์สำรองเพื่อทำงานต่อ</small>
          </button>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept=".cdrbak"
        hidden
        data-testid="restore-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) requestRestore(f);
        }}
      />
      {/* Outside the top bar, so the dialog is not held in its stacking context. */}
      {dialog &&
        createPortal(
          <BackupDialog
            onClose={() => {
              setDialog(false);
              button.current?.focus();
            }}
          />,
          document.body,
        )}
    </div>
  );
}

function BackupDialog({ onClose }: { onClose: () => void }) {
  const { datasets, coordImport, makeSnapshot, markProfilesSaved, notify } = useStore();
  const encryptable = canEncrypt();
  const [protect, setProtect] = useState(encryptable);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const snapshot = useMemo(() => makeSnapshot(), [makeSnapshot]);
  const sum = summarizeSnapshot(snapshot);
  const first = useRef<HTMLInputElement>(null);
  useEscape(true, () => !busy && onClose());
  useEffect(() => first.current?.focus(), []);

  const problem = !protect
    ? undefined
    : password.length < MIN_PASSWORD_LENGTH
      ? `รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`
      : password !== confirm
        ? 'รหัสผ่านสองช่องยังไม่ตรงกัน'
        : undefined;

  const save = async () => {
    if (problem || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const blob = await writeBackup(snapshot, { password: protect ? password : undefined });
      downloadBlob(blob, backupFileName());
      markProfilesSaved();
      notify('info', `บันทึกไฟล์สำรองแล้ว (${fmtSize(blob.size)}${protect ? ' · มีรหัสผ่าน' : ' · ไม่มีรหัสผ่าน'})`);
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="backdrop top" onClick={() => !busy && onClose()} />
      <div className="dialog backup-dialog" role="dialog" aria-modal="true" aria-labelledby="backup-title">
        <h2 id="backup-title">สำรองไฟล์งาน</h2>
        <p className="meta" style={{ margin: 0 }}>
          บันทึกทุกอย่างในหน้านี้เป็นไฟล์เดียว แล้วใช้ "กู้ไฟล์" เปิดกลับมาทำงานต่อได้ในเครื่องใดก็ได้
        </p>
        <dl className="backup-summary">
          <dt>ไฟล์ CDR</dt>
          <dd>
            {sum.files ? `${n(sum.files)} ไฟล์ · ${n(sum.rows)} แถว` : '—'}
            {datasets.length > 0 && (
              <span className="backup-targets">
                {datasets.map((d) => (
                  <TargetTag key={d.id} ds={d} />
                ))}
              </span>
            )}
          </dd>
          <dt>ชื่อเรียกและสีเป้าหมาย</dt>
          <dd>{sum.targets ? `${n(sum.targets)} เป้าหมาย${sum.aliases ? ` (ตั้งชื่อเรียก ${n(sum.aliases)})` : ''}` : '—'}</dd>
          <dt>ข้อมูลบุคคล</dt>
          <dd>{sum.profiles ? `${n(sum.profiles)} รายการ${sum.photos ? ` (มีรูป ${n(sum.photos)})` : ''}` : '—'}</dd>
          <dt>พิกัดเสาที่นำเข้า</dt>
          <dd>{coordImport ? `${n(sum.coords)} รายการ (${coordImport.name})` : '—'}</dd>
          <dt>การตั้งค่าการวิเคราะห์</dt>
          <dd>การตีความเวลา เกณฑ์กลางคืน ติดต่อถี่ และอื่น ๆ</dd>
        </dl>

        <label className="check">
          <input type="checkbox" checked={protect} disabled={!encryptable || busy} onChange={(e) => setProtect(e.target.checked)} />
          <span>ตั้งรหัสผ่านป้องกันไฟล์ (แนะนำ)</span>
        </label>
        {!encryptable && (
          <p className="note warn" style={{ margin: 0 }}>
            หน้านี้ใช้การเข้ารหัสของเบราว์เซอร์ไม่ได้ (ต้องเปิดผ่าน https หรือเปิดไฟล์แอปจากเครื่อง) ไฟล์สำรองจะไม่มีรหัสผ่าน
          </p>
        )}
        {protect ? (
          <div className="backup-password">
            <div className="row2">
              <label className="field">
                <span>รหัสผ่าน</span>
                <input
                  ref={first}
                  className="input"
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  disabled={busy}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label className="field">
                <span>ยืนยันรหัสผ่าน</span>
                <input
                  className="input"
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirm}
                  disabled={busy}
                  onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void save()}
                />
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
              <span>แสดงรหัสผ่าน</span>
            </label>
            {problem && (password || confirm) && <p className="hint">{problem}</p>}
            <p className="caveat" style={{ margin: 0 }}>
              ต้องใช้รหัสผ่านนี้ทุกครั้งที่กู้ไฟล์ ถ้าลืมจะเปิดไฟล์นี้ไม่ได้อีก เพราะไม่มีวิธีกู้รหัสผ่าน
            </p>
          </div>
        ) : (
          <p className="note warn" style={{ margin: 0 }}>
            ไฟล์ที่ไม่มีรหัสผ่าน ใครได้ไฟล์ไปก็เปิดอ่านข้อมูล CDR และข้อมูลบุคคลได้
          </p>
        )}
        {error && (
          <p className="note warn" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        <p className="caveat" style={{ margin: 0 }}>
          ไฟล์สำรองมีข้อมูล CDR และข้อมูลส่วนบุคคล ให้เก็บรักษาตามระเบียบของหน่วยงาน · แอปไม่ได้เก็บสำเนาไว้ที่ใด
        </p>
        <div className="dialog-actions">
          <span className="spacer" />
          <button className="btn" type="button" onClick={onClose} disabled={busy}>
            ยกเลิก
          </button>
          <button className="btn primary" type="button" onClick={() => void save()} disabled={busy || !!problem}>
            {busy ? 'กำลังสร้างไฟล์…' : 'บันทึกไฟล์สำรอง'}
          </button>
        </div>
      </div>
    </>
  );
}

/** Read a backup; photos are decoded and re-encoded before use, as for profile files. */
async function load(file: File, password?: string): Promise<RestoredBackup> {
  const r = await readBackup(file, password);
  const profiles = await Promise.all(r.snapshot.profiles.map(async (p) => (p.photo ? { ...p, photo: await reencodePhoto(p.photo) } : p)));
  return { ...r, snapshot: { ...r.snapshot, profiles: profiles.filter(hasContent) } };
}

/** Shown when a backup file is picked from the menu or dropped on the import area. */
export function RestoreDialog() {
  const { restoreRequest: file, requestRestore, restoreSession, datasets, profiles, profilesDirty, notify, settings } = useStore();
  const [header, setHeader] = useState<BackupHeader>();
  const [result, setResult] = useState<RestoredBackup>();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const close = () => requestRestore(undefined);
  useEscape(!!file, () => !busy && close());

  useEffect(() => {
    setHeader(undefined);
    setResult(undefined);
    setPassword('');
    setError(undefined);
    if (!file) return;
    let live = true;
    setBusy(true);
    (async () => {
      try {
        const h = await readBackupHeader(file);
        if (!live) return;
        setHeader(h);
        if (!h.encryption) {
          const r = await load(file);
          if (live) setResult(r);
        }
      } catch (e) {
        if (live) setError(errorText(e));
      } finally {
        if (live) setBusy(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [file]);

  if (!file) return null;

  const unlock = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setResult(await load(file, password));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!result) return;
    restoreSession(result.snapshot);
    const s = summarizeSnapshot(result.snapshot);
    notify(
      'info',
      `กู้ไฟล์ ${file.name} แล้ว: เป้าหมาย ${n(s.targets)} ราย · ข้อมูลบุคคล ${n(s.profiles)} รายการ${result.skipped ? ` (ข้ามรายการที่ใช้ไม่ได้ ${n(result.skipped)})` : ''}`,
    );
    close();
  };

  const locked = !!header?.encryption && !result;
  const current = { targets: datasets.length, profiles: Object.keys(profiles).length };
  const sum = result && summarizeSnapshot(result.snapshot);

  return (
    <>
      <div className="backdrop top" onClick={() => !busy && close()} />
      <div className="dialog backup-dialog" role="dialog" aria-modal="true" aria-labelledby="restore-title">
        <h2 id="restore-title">กู้ไฟล์จากไฟล์สำรอง</h2>
        <p className="meta" style={{ margin: 0, overflowWrap: 'anywhere' }}>
          <span className="mono">{file.name}</span>
          {header?.savedAt && ` · บันทึกเมื่อ ${fmtDateTime(wallClock(header.savedAt), settings.yearStyle)}`}
          {header && (header.encryption ? ' · มีรหัสผ่าน' : ' · ไม่มีรหัสผ่าน')}
        </p>

        {locked && (
          <form
            id="restore-password"
            className="field"
            onSubmit={(e) => {
              e.preventDefault();
              void unlock();
            }}
          >
            <label className="field">
              <span>รหัสผ่านของไฟล์สำรอง</span>
              <input className="input" type="password" autoComplete="current-password" autoFocus value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </form>
        )}
        {busy && <p className="meta">{locked ? 'กำลังถอดรหัสและตรวจไฟล์…' : 'กำลังอ่านไฟล์…'}</p>}
        {error && (
          <p className="note warn" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}

        {result && sum && (
          <>
            <dl className="backup-summary">
              <dt>เป้าหมาย</dt>
              <dd>
                {sum.targets ? `${n(sum.targets)} ราย จาก ${n(sum.files)} ไฟล์ (${n(sum.rows)} แถว)` : '—'}
                {sum.targets > 0 && (
                  <ul className="restore-targets">
                    {result.snapshot.files.flatMap((f) =>
                      f.targets.map((t) => (
                        <li key={`${f.fileName}:${t.target}:${t.slot}`}>
                          <Swatch slot={t.slot} />
                          <span className="mono">{t.target || '(ไม่พบหมายเลข)'}</span>
                          {t.label && <span>{t.label}</span>}
                          <span className="meta">{f.fileName}</span>
                        </li>
                      )),
                    )}
                  </ul>
                )}
              </dd>
              <dt>ข้อมูลบุคคล</dt>
              <dd>{sum.profiles ? `${n(sum.profiles)} รายการ${sum.photos ? ` (มีรูป ${n(sum.photos)})` : ''}` : '—'}</dd>
              <dt>พิกัดเสาที่นำเข้า</dt>
              <dd>{result.snapshot.coords ? `${n(sum.coords)} รายการ (${result.snapshot.coords.name})` : '—'}</dd>
              <dt>การตั้งค่าการวิเคราะห์</dt>
              <dd>ใช้ตามไฟล์สำรอง (ยกเว้นตัวเลือกแผนที่ออนไลน์ ซึ่งคงตามเครื่องนี้)</dd>
            </dl>
            {result.skipped > 0 && (
              <p className="note" style={{ margin: 0 }}>
                ข้ามรายการที่ใช้ไม่ได้ {n(result.skipped)} รายการ
              </p>
            )}
            {(current.targets > 0 || current.profiles > 0) && (
              <p className="note warn" style={{ margin: 0 }}>
                งานที่เปิดอยู่ตอนนี้ (เป้าหมาย {n(current.targets)} ราย · ข้อมูลบุคคล {n(current.profiles)} รายการ) จะถูกแทนที่ด้วยข้อมูลจากไฟล์สำรอง
                {profilesDirty && ' — ข้อมูลบุคคลที่ยังไม่ได้บันทึกจะหายไป'}
              </p>
            )}
          </>
        )}

        <div className="dialog-actions">
          <span className="spacer" />
          <button className="btn" type="button" onClick={close} disabled={busy}>
            ยกเลิก
          </button>
          {locked ? (
            <button className="btn primary" type="submit" form="restore-password" disabled={busy || !password}>
              เปิดไฟล์
            </button>
          ) : (
            <button className="btn primary" type="button" onClick={apply} disabled={!result || busy}>
              กู้ไฟล์
            </button>
          )}
        </div>
      </div>
    </>
  );
}
