import type { LinkLayoutMode } from './linkChartOption';

/** Layouts as investigation-chart users know them, with what each does in Thai. */
const LAYOUTS: { mode: LinkLayoutMode; label: string; hint: string }[] = [
  { mode: 'hub', label: 'Peacock', hint: 'กลุ่มรอบเป้าหมาย: ผู้ติดต่อแผ่รอบเป้าหมาย ผู้ติดต่อร่วมอยู่ระหว่างเป้าหมาย' },
  { mode: 'packed', label: 'Packed', hint: 'อัดแน่นเป็นกลุ่ม: แต่ละเป้าหมายเป็นกลุ่มกลม วางชิดกัน ดูภาพรวมเมื่อมีหลายเป้าหมาย' },
  { mode: 'hierarchy', label: 'Hierarchy', hint: 'ลำดับชั้น: เป้าหมายแถวบน ผู้ติดต่อร่วมแถวกลาง ผู้ติดต่อของแต่ละเป้าหมายด้านล่าง' },
  { mode: 'organization', label: 'Organization', hint: 'ผังองค์กร: ผู้ติดต่อเรียงลงใต้เป้าหมายเป็นสาย ผู้ติดต่อร่วมอยู่แถวบน' },
  { mode: 'force', label: 'แรงดึงดูด', hint: 'แรงดึงดูด: จัดเองตามความสัมพันธ์ ลากย้ายได้' },
];

/** Choose how a link chart is laid out. */
export function LinkLayoutPicker({ value, onChange }: { value: LinkLayoutMode; onChange: (mode: LinkLayoutMode) => void }) {
  return (
    <div className="seg" role="group" aria-label="การจัดวาง">
      {LAYOUTS.map((l) => {
        const thai = l.hint.split(':')[0];
        return (
          <button key={l.mode} type="button" aria-pressed={value === l.mode} title={l.hint} aria-label={thai === l.label ? l.label : `${l.label} — ${thai}`} onClick={() => onChange(l.mode)}>
            {l.label}
          </button>
        );
      })}
    </div>
  );
}
