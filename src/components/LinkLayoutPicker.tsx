import type { LinkLayoutMode } from './linkChartOption';

/** Layouts as investigation-chart users know them, with what each does in Thai. */
const LAYOUTS: { mode: LinkLayoutMode; label: string; hint: string }[] = [
  { mode: 'hub', label: 'Peacock', hint: 'กลุ่มรอบเป้าหมาย: ผู้ติดต่อแผ่รอบเป้าหมาย ผู้ติดต่อร่วมอยู่ระหว่างเป้าหมาย (หลายเป้าหมาย: ผู้ติดต่อร่วมกลุ่มเดียวกันเรียงเป็นบันไดพร้อมเส้นแกน)' },
  { mode: 'packed', label: 'Packed', hint: 'อัดแน่นเป็นกลุ่ม: แต่ละเป้าหมายเป็นวงกลมเรียงเป็นตาราง เป้าหมายที่เกี่ยวข้องกันอยู่ติดกัน เส้นระหว่างวงเดินตามถนนแนวตั้ง-แนวนอนระหว่างวง เป็นช่องไม่ทับกัน' },
  { mode: 'hierarchy', label: 'Hierarchy', hint: 'ลำดับชั้น: เป้าหมายแถวบน ผู้ติดต่อเรียงแถวด้านล่าง ต่อด้วยเส้นหักมุมฉาก ผู้ติดต่อร่วมอยู่แถวกลาง' },
  { mode: 'organization', label: 'Organization', hint: 'ผังองค์กร: ผู้ติดต่อเรียงเป็นรายการซ้าย-ขวาตามเส้นแกนใต้เป้าหมาย เส้นหักมุมฉาก ผู้ติดต่อร่วมอยู่แถวบน' },
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
