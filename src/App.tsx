import { useRef, useState } from 'react';
import { exportAnalysisXlsx, exportFileName } from './lib/export/excel';
import { BackupMenu, RestoreDialog } from './components/Backup';
import { ContactDrawer } from './components/ContactDrawer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ColumnMappingDialog, Toasts } from './components/Dialogs';
import { ProfileDialog } from './components/ProfileDialog';
import { DatasetList, ImportPanel, ProfilePanel, SettingsPanel } from './components/Sidebar';
import { downloadBlob } from './components/download';
import { BurstView } from './views/BurstView';
import { ContactsView } from './views/ContactsView';
import { CrossView } from './views/CrossView';
import { DevicesView } from './views/DevicesView';
import { LocationsView } from './views/LocationsView';
import { NetworkView } from './views/NetworkView';
import { OverviewView } from './views/OverviewView';
import { RecordsView } from './views/RecordsView';
import { TimelineView } from './views/TimelineView';
import { useStore, type ThemeChoice } from './state/store';

const TABS = [
  { id: 'overview', label: 'ภาพรวม', View: OverviewView },
  { id: 'contacts', label: 'คู่ติดต่อ', View: ContactsView },
  { id: 'timeline', label: 'ช่วงเวลา', View: TimelineView },
  { id: 'bursts', label: 'Call burst', View: BurstView },
  { id: 'locations', label: 'พื้นที่และการเดินทาง', View: LocationsView },
  { id: 'devices', label: 'อุปกรณ์', View: DevicesView },
  { id: 'network', label: 'ผังเครือข่าย', View: NetworkView },
  { id: 'cross', label: 'เชื่อมโยงข้ามเป้าหมาย', View: CrossView },
  { id: 'records', label: 'รายการข้อมูล', View: RecordsView },
] as const;

type TabId = (typeof TABS)[number]['id'];

// A layout preference, like the theme: the file panel can be put away.
const SIDEBAR_KEY = 'cdr-analyzer:sidebar';

function Welcome() {
  const { loadSamples } = useStore();
  return (
    <div className="welcome">
      <div>
        <h2>วิเคราะห์ CDR ในเบราว์เซอร์</h2>
        <p className="lead">
          นำเข้าไฟล์ CDR จากผู้ให้บริการ (ลากไฟล์มาวางที่แถบด้านซ้าย หรือกดปุ่ม "ใช้ข้อมูลตัวอย่าง") แล้วดูภาพรวม คู่ติดต่อ ช่วงเวลา เสาสัญญาณ การเดินทาง
          อุปกรณ์ และความเชื่อมโยงระหว่างเป้าหมายได้ทันที
        </p>
      </div>
      <div className="note">
        <strong>ข้อมูลไม่ออกจากเครื่องนี้</strong> — ไฟล์ถูกอ่านและวิเคราะห์ในเบราว์เซอร์ทั้งหมด ไม่มีการอัปโหลดไปที่ใด และไม่ถูกบันทึกไว้ในเบราว์เซอร์ (ปิดหน้าแล้วข้อมูลหายไป
        — ใช้เมนู "สำรอง/กู้ไฟล์" ด้านบนเพื่อเก็บงานเป็นไฟล์แล้วเปิดทำต่อภายหลัง) การเชื่อมต่ออินเทอร์เน็ตมีเพียงภาพแผนที่ฐาน ซึ่งปิดได้ในการตั้งค่า
      </div>
      <ul className="feature-list">
        <li>
          <strong>รูปแบบไฟล์ที่รองรับ</strong>AIS แบบตารางเดียว (START_DATETIME, A_NUMBER, B_NUMBER, RECORD_TYPE…), True/DTAC แบบหลายชีต (VOICE/IMS/SMS/DATA/WIFI — รวมสายที่ถูกบันทึกซ้ำใน VOICE และ IMS ให้อัตโนมัติ) และตาราง .xlsx/.csv
          ทั่วไปที่จับคู่หัวคอลัมน์ให้อัตโนมัติหรือเลือกเองได้
        </li>
        <li>
          <strong>คู่ติดต่อและช่วงเวลา</strong>อันดับคู่ติดต่อ เวลาสนทนา การโทรกลางคืน แผนภาพวัน×ชั่วโมง ช่วงที่เงียบ และช่วงที่ติดต่อถี่
        </li>
        <li>
          <strong>พื้นที่และอุปกรณ์</strong>เสาที่ใช้บ่อย พื้นที่ที่อาจเป็นที่พัก/ที่ทำงาน เส้นทางรายวันบนแผนที่ การเปลี่ยนเครื่อง และเครื่อง 2 ซิม
        </li>
        <li>
          <strong>เชื่อมโยงหลายเป้าหมาย</strong>ผังเชื่อมโยงแบบผังสืบสวน (ใครโทรหาใคร กี่ครั้ง) ใส่ชื่อ ที่อยู่ ประวัติคดี และรูปบุคคลได้ ผู้ติดต่อร่วม ลำดับการติดต่อทอด อุปกรณ์ร่วม
          การอยู่พื้นที่เดียวกัน และ Centrality/Community
        </li>
        <li>
          <strong>ส่งออกและสำรองงาน</strong>Excel หลายชีตสำหรับทำรายงาน, CSV ของทุกตาราง, ภาพผังเครือข่าย, พิมพ์/บันทึกเป็น PDF และไฟล์สำรองงานทั้งหมด
          (ตั้งรหัสผ่านได้) ไว้เปิดทำต่อภายหลัง
        </li>
        <li>
          <strong>ข้อควรระวังในการตีความ</strong>เสาสัญญาณไม่ใช่พิกัด GPS และตัวชี้วัดต่าง ๆ ใช้จัดลำดับสิ่งที่ควรตรวจสอบต่อ ไม่ใช่ข้อสรุปว่าผู้ใดกระทำผิด
        </li>
      </ul>
      <div>
        <button className="btn primary" type="button" onClick={loadSamples}>
          ลองด้วยข้อมูลตัวอย่าง (สมมติ)
        </button>
      </div>
    </div>
  );
}

function ThemeSwitch() {
  const { theme, setTheme } = useStore();
  const opts: { v: ThemeChoice; label: string }[] = [
    { v: 'system', label: 'อัตโนมัติ' },
    { v: 'light', label: 'สว่าง' },
    { v: 'dark', label: 'มืด' },
  ];
  return (
    <div className="seg no-print" role="group" aria-label="ธีม">
      {opts.map((o) => (
        <button key={o.v} type="button" aria-pressed={theme === o.v} onClick={() => setTheme(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function App() {
  const { datasets, settings, coordImport, profiles } = useStore();
  const [tab, setTab] = useState<TabId>('overview');
  const [exporting, setExporting] = useState(false);
  const active = TABS.find((t) => t.id === tab)!;
  const [sideHidden, setSideHidden] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === 'hidden';
    } catch {
      return false;
    }
  });
  const sideToggle = useRef<HTMLButtonElement>(null);
  // With no file loaded the panel is the way in, so it stays.
  const hasData = datasets.length > 0;
  const sideShown = !hasData || !sideHidden;
  const setSide = (shown: boolean) => {
    setSideHidden(!shown);
    try {
      localStorage.setItem(SIDEBAR_KEY, shown ? 'shown' : 'hidden');
    } catch {
      /* storage unavailable: the choice simply does not persist */
    }
    // The button that was pressed may be gone: keep the keyboard on the top bar.
    if (!shown) setTimeout(() => sideToggle.current?.focus(), 0);
  };

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const blob = await exportAnalysisXlsx(datasets, settings, coordImport?.coords, profiles);
      downloadBlob(blob, exportFileName(datasets));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        {hasData && (
          <button
            ref={sideToggle}
            className="btn small no-print"
            type="button"
            aria-expanded={sideShown}
            aria-controls="side-panel"
            onClick={() => setSide(!sideShown)}
          >
            {sideShown ? '◀ ซ่อนแถบไฟล์' : '▶ แสดงแถบไฟล์'}
          </button>
        )}
        <div className="brand">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
            <rect width="28" height="28" rx="7" fill="var(--accent)" />
            <circle cx="9" cy="18" r="3" fill="var(--on-accent)" />
            <circle cx="19" cy="9" r="3" fill="var(--on-accent)" />
            <circle cx="20" cy="20" r="2.2" fill="var(--on-accent)" />
            <path d="M9 18 L19 9 L20 20 Z" fill="none" stroke="var(--on-accent)" strokeWidth="1.4" />
          </svg>
          <div style={{ minWidth: 0 }}>
            <h1>CDR Analyzer</h1>
            <small>วิเคราะห์ข้อมูลการใช้โทรศัพท์และความเชื่อมโยง</small>
          </div>
        </div>
        <div className="spacer" />
        <span className="privacy" title="ไฟล์ถูกประมวลผลในเบราว์เซอร์นี้เท่านั้น">
          <span aria-hidden="true">🔒</span>
          <span>
            ประมวลผลในเครื่อง<span className="long"> · ไม่อัปโหลดข้อมูล</span>
          </span>
        </span>
        <BackupMenu />
        {datasets.length > 0 && (
          <>
            <button className="btn no-print" type="button" onClick={exportXlsx} disabled={exporting}>
              {exporting ? 'กำลังสร้างไฟล์…' : 'ส่งออก Excel'}
            </button>
            <button className="btn no-print" type="button" onClick={() => window.print()}>
              พิมพ์ / PDF
            </button>
          </>
        )}
        <ThemeSwitch />
      </header>
      <div className={`layout${sideShown ? '' : ' side-hidden'}`}>
        <aside className="sidebar" id="side-panel" aria-label="ไฟล์และการตั้งค่า">
          {hasData && (
            <button className="btn small ghost side-hide" type="button" onClick={() => setSide(false)}>
              ซ่อนแถบนี้ ◀
            </button>
          )}
          <ImportPanel />
          <DatasetList />
          <ProfilePanel />
          <SettingsPanel />
        </aside>
        <main className="main">
          {datasets.length === 0 ? (
            <Welcome />
          ) : (
            <>
              <nav className="tabs" role="tablist" aria-label="มุมมองการวิเคราะห์">
                {TABS.map((t) => (
                  <button key={t.id} role="tab" type="button" aria-selected={t.id === tab} aria-controls={`panel-${t.id}`} id={`tab-${t.id}`} onClick={() => setTab(t.id)}>
                    {t.label}
                  </button>
                ))}
              </nav>
              <div role="tabpanel" id={`panel-${active.id}`} aria-labelledby={`tab-${active.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <ErrorBoundary resetKey={tab} label={`แท็บ "${active.label}"`}>
                  <active.View />
                </ErrorBoundary>
              </div>
            </>
          )}
        </main>
      </div>
      <ColumnMappingDialog />
      <ErrorBoundary label="หน้าต่างรายละเอียดคู่ติดต่อ">
        <ContactDrawer />
      </ErrorBoundary>
      <ErrorBoundary label="หน้าต่างข้อมูลบุคคล">
        <ProfileDialog />
      </ErrorBoundary>
      <ErrorBoundary label="หน้าต่างกู้ไฟล์">
        <RestoreDialog />
      </ErrorBoundary>
      <Toasts />
    </div>
  );
}
