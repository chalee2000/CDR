import { useMemo } from 'react';
import { dailyRhythm, dailySeries, hourProfile, silences, type DayRhythm, type Gap } from '../lib/analysis/temporal';
import { DAY_PERIODS, WEEKDAYS_TH } from '../lib/labels';
import { fmtDate, fmtDateTime, fmtHours, fmtTime, HOUR, isoText } from '../lib/time';
import { fmtInt, pct } from '../lib/util';
import { ChartCard, EChart } from '../components/Chart';
import { dailyOption, dataVolumeOption, heatOption, hourOption, seriesLegend } from '../components/charts';
import { DataTable, type Column } from '../components/DataTable';
import { Caveat, DatasetPicker, Kpi, Section } from '../components/bits';
import { useEffectiveTheme, useStore } from '../state/store';

export function TimelineView() {
  const { selected: ds, settings } = useStore();
  const mode = useEffectiveTheme();
  const days = useMemo(() => (ds ? dailySeries(ds, settings) : []), [ds, settings]);
  const prof = useMemo(() => (ds ? hourProfile(ds, settings) : undefined), [ds, settings]);
  const gaps = useMemo(() => (ds ? silences(ds, settings) : []), [ds, settings]);
  const rhythm = useMemo(() => (ds ? dailyRhythm(ds, settings) : []), [ds, settings]);
  const dOpt = useMemo(() => dailyOption(days, mode), [days, mode]);
  const vOpt = useMemo(() => dataVolumeOption(days, mode), [days, mode]);
  const hOpt = useMemo(() => (prof ? hourOption(prof, mode) : {}), [prof, mode]);
  const heat = useMemo(() => (prof ? heatOption(prof.heat, mode) : {}), [prof, mode]);
  if (!ds || !prof) return null;
  const y = settings.yearStyle;
  const hasData = days.some((d) => d.data > 0);
  const commTotal = prof.comm.reduce((a, b) => a + b, 0);

  const gapCols: Column<Gap>[] = [
    { key: 'from', header: 'ตั้งแต่ (รายการสุดท้ายก่อนเงียบ)', render: (g) => fmtDateTime(g.from, y), sortValue: (g) => g.from, csv: (g) => isoText(g.from) },
    { key: 'to', header: 'ถึง (รายการแรกหลังเงียบ)', render: (g) => fmtDateTime(g.to, y), sortValue: (g) => g.to, csv: (g) => isoText(g.to) },
    { key: 'h', header: 'ระยะเวลา', num: true, render: (g) => fmtHours(g.hours * HOUR), sortValue: (g) => g.hours },
  ];
  const rhythmCols: Column<DayRhythm>[] = [
    { key: 'day', header: 'วันที่', render: (r) => `${fmtDate(Date.parse(r.day), y)}`, sortValue: (r) => r.day },
    { key: 'wd', header: 'วัน', render: (r) => WEEKDAYS_TH[(new Date(r.day).getUTCDay() + 6) % 7], sortValue: (r) => (new Date(r.day).getUTCDay() + 6) % 7 },
    { key: 'first', header: 'รายการแรก', render: (r) => fmtTime(r.first), sortValue: (r) => r.first % 86400000, csv: (r) => fmtTime(r.first) },
    { key: 'last', header: 'รายการสุดท้าย', render: (r) => fmtTime(r.last), sortValue: (r) => r.last % 86400000, csv: (r) => fmtTime(r.last) },
    { key: 'n', header: 'จำนวนรายการ', num: true, render: (r) => fmtInt(r.count), sortValue: (r) => r.count },
    { key: 'site', header: 'เสาที่ปรากฏมากที่สุด', render: (r) => r.topSite ?? '-', sortValue: (r) => r.topSite },
  ];

  return (
    <>
      <DatasetPicker />
      <ChartCard
        title="การติดต่อรายวัน"
        sub={`${days.length} วัน · เลื่อน/ซูมด้วยล้อเมาส์หรือแถบด้านล่าง`}
        legend={seriesLegend(mode)}
        table={{ columns: ['วันที่', 'โทรออก', 'โทรเข้า', 'ไม่สำเร็จ', 'ส่ง SMS', 'รับ SMS', 'Data session'], rows: days.map((d) => [d.day, d.callOut, d.callIn, d.callMissed, d.smsOut, d.smsIn, d.data]) }}
      >
        <EChart option={dOpt} height={300} label="กราฟการติดต่อรายวัน" />
      </ChartCard>
      {hasData && (
        <ChartCard title="ปริมาณการใช้อินเทอร์เน็ตรายวัน (MB)" table={{ columns: ['วันที่', 'จำนวน session', 'MB'], rows: days.map((d) => [d.day, d.data, Math.round((d.dataBytes / 1048576) * 10) / 10]) }}>
          <EChart option={vOpt} height={220} label="กราฟปริมาณข้อมูลรายวัน" />
        </ChartCard>
      )}
      <div className="grid two">
        <ChartCard
          title="ช่วงเวลาของวัน"
          sub="นับทั้งโทรและ SMS"
          legend={seriesLegend(mode)}
          table={{ columns: ['ชั่วโมง', 'โทรออก', 'โทรเข้า', 'SMS'], rows: prof.comm.map((_, h) => [`${String(h).padStart(2, '0')}:00`, prof.callOut[h], prof.callIn[h], prof.sms[h]]) }}
        >
          <EChart option={hOpt} height={260} label="กราฟการติดต่อตามชั่วโมง" />
        </ChartCard>
        <ChartCard
          title="วันในสัปดาห์ × ชั่วโมง"
          sub="สีเข้มขึ้น = ติดต่อมากขึ้น (โทร + SMS)"
          table={{ columns: ['วัน', ...Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))], rows: prof.heat.map((r, d) => [WEEKDAYS_TH[d], ...r]) }}
        >
          <EChart option={heat} height={290} label="แผนภาพความถี่ตามวันและชั่วโมง" />
        </ChartCard>
      </div>
      <Section title="สัดส่วนตามช่วงของวัน" sub="เกณฑ์เดียวกับรายงาน cdr-narcotics">
        <div className="kpis">
          {DAY_PERIODS.map((p) => (
            <Kpi key={p.key} label={p.label} value={pct(prof.periods[p.key], commTotal)} hint={`${fmtInt(prof.periods[p.key])} ครั้ง`} />
          ))}
        </div>
      </Section>
      <Section title={`ช่วงที่ไม่มีรายการใด ๆ ≥ ${settings.silenceHours} ชม.`} sub="อาจเกิดจากปิดเครื่อง อยู่นอกพื้นที่ให้บริการ หรือใช้เครื่อง/ซิมอื่น · ช่วงที่ติดต่อถี่ดูได้ที่แท็บ Call burst">
        <DataTable label="ช่วงเงียบ" rows={gaps} columns={gapCols} initialSort={{ key: 'h', dir: 'desc' }} pageSize={10} empty="ไม่พบช่วงเงียบตามเกณฑ์" csvName={`silence-${ds.target}`} />
      </Section>
      <Section title="จังหวะการใช้งานรายวัน" sub="เวลารายการแรกและสุดท้ายของแต่ละวัน (รวม data session)">
        <DataTable label="จังหวะรายวัน" rows={rhythm} columns={rhythmCols} initialSort={{ key: 'day', dir: 'asc' }} pageSize={31} csvName={`daily-${ds.target}`} />
        <div style={{ marginTop: 8 }}>
          <Caveat>เวลาแสดงตามเวลาในไฟล์ (เวลาไทย) และไม่ขึ้นกับเขตเวลาของเครื่องที่เปิดดู</Caveat>
        </div>
      </Section>
    </>
  );
}
