import { useMemo } from 'react';
import type { Network } from '../lib/analysis/network';
import { CHROME, slotColor, type ThemeMode } from '../lib/palette';
import { personName, recordLines, type ProfileMap } from '../lib/profiles';
import type { Dataset } from '../lib/types';
import { iconUrl, type IconSpec } from './linkIcons';
import { LINK_THEME, nodeIcon, type LinkColorBy } from './linkChartOption';

interface Props {
  net: Network;
  datasets: Dataset[];
  mode: ThemeMode;
  profiles: ProfileMap;
  unit: string;
  colorBy?: LinkColorBy;
  communitySlots?: Map<number, number>;
  communities?: number;
}

/** Legend drawn with the chart's own icons, so every mark can be looked up. */
export function LinkLegend({ net, datasets, mode, profiles, unit, colorBy = 'role', communitySlots, communities = 0 }: Props) {
  const items = useMemo(() => {
    const t = LINK_THEME[mode];
    const ch = CHROME[mode];
    const out: { key: string; spec: IconSpec; label: string }[] = [];
    const present = new Set(net.nodes.map((n) => n.id));
    const contact = (glyph: IconSpec['glyph'], ring: string[]): IconSpec => ({ glyph, size: 22, fill: t.nodeFill, ink: t.glyph, ring, ringWidth: ring.length > 1 ? 3 : 2.5 });
    if (colorBy === 'community') {
      for (const [com, slot] of communitySlots ?? []) {
        const c = slotColor(slot, mode);
        out.push({ key: `c${com}`, spec: { glyph: 'mobile', size: 22, fill: c, ink: '#ffffff', ring: [c], ringWidth: 2 }, label: `กลุ่มที่ ${com + 1}` });
      }
      if (communities > (communitySlots?.size ?? 0)) out.push({ key: 'rest', spec: { glyph: 'mobile', size: 22, fill: ch.other, ink: '#ffffff', ring: [ch.other], ringWidth: 2 }, label: 'กลุ่มอื่น ๆ' });
    } else {
      for (const d of datasets.filter((x) => present.has(x.target))) {
        const name = personName(profiles[d.target]) ?? (d.label !== d.target ? d.label : undefined);
        out.push({
          key: d.id,
          spec: nodeIcon({ isTarget: true, slot: d.slot, kind: 'target', community: 0 }, { mode, size: 24 }),
          label: `เป้าหมาย ${name ? `${name} ` : ''}${d.target}`,
        });
      }
      const targetSlots = datasets.filter((x) => present.has(x.target)).map((d) => d.slot);
      if (net.nodes.some((n) => n.shared) && targetSlots.length > 1) {
        out.push({ key: 'shared', spec: contact('mobile', targetSlots.slice(0, 3).map((s) => slotColor(s, mode))), label: 'ผู้ติดต่อร่วม (วงแหวนสีของเป้าหมายที่ติดต่อ)' });
      }
      out.push({ key: 'mobile', spec: contact('mobile', [slotColor(targetSlots[0] ?? 0, mode)]), label: 'คู่ติดต่อ (สีวงแหวน = เป้าหมาย)' });
    }
    const kinds = new Set(net.nodes.map((n) => n.kind));
    const neutral = [ch.other];
    if (kinds.has('landline')) out.push({ key: 'landline', spec: contact('landline', neutral), label: 'โทรศัพท์บ้าน' });
    if (kinds.has('intl')) out.push({ key: 'intl', spec: contact('globe', neutral), label: 'เลขต่างประเทศ' });
    if (kinds.has('shortcode') || kinds.has('alpha')) out.push({ key: 'service', spec: contact('service', neutral), label: 'เลขบริการ/ผู้ส่ง' });
    if (kinds.has('other')) out.push({ key: 'other', spec: contact('other', neutral), label: 'เลขอื่น ๆ' });
    const inNet = net.nodes.map((n) => profiles[n.id]).filter(Boolean);
    if (inNet.length) out.push({ key: 'person', spec: contact('person', neutral), label: 'ระบุตัวบุคคลแล้ว' });
    if (inNet.some((p) => recordLines(p).length > 0)) {
      out.push({ key: 'record', spec: { ...contact('person', neutral), size: 24, badge: { fill: t.danger, ink: '#ffffff', edge: ch.surface } }, label: 'มีประวัติคดีอาญา' });
    }
    return out;
  }, [net, datasets, mode, profiles, colorBy, communitySlots, communities]);

  const ink = CHROME[mode].ink2;
  return (
    <div className="legend link-legend">
      {items.map((i) => (
        <span key={i.key}>
          <img src={iconUrl(i.spec)} width={i.spec.size} height={i.spec.size} alt="" />
          {i.label}
        </span>
      ))}
      <span>
        <svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true">
          <line x1="2" y1="6" x2="26" y2="6" stroke={ink} strokeWidth="2" />
          <path d="M33 6 24 1.5v9z" fill={ink} />
        </svg>
        ลูกศร = ฝั่งผู้โทร/ผู้ส่ง → ผู้รับ · ความหนาและตัวเลขบนเส้น = {unit}
      </span>
    </div>
  );
}
