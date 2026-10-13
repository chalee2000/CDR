import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCsv, readWorkbook } from '../../src/lib/io/readWorkbook';
import { parseWorkbook, type DatasetDraft } from '../../src/lib/parsers';
import { generateSamples, SAMPLE_TARGETS } from '../../src/lib/samples/generate';
import { countBy } from '../../src/lib/util';

function drafts(out: ReturnType<typeof parseWorkbook>): DatasetDraft[] {
  if (out.kind !== 'ok') throw new Error(out.reason);
  return out.drafts;
}

const [wbA, wbB, wbC] = generateSamples();

describe('AIS single-sheet layout', () => {
  const [a] = drafts(parseWorkbook(wbA, 'local'));

  it('detects format, target and keeps every row', () => {
    expect(a.meta.format).toBe('ais');
    expect(a.target).toBe(SAMPLE_TARGETS.A);
    expect(a.interactions).toHaveLength(wbA.sheets[0].rows.length - 1);
    expect(a.meta.hasCoordinates).toBe(false);
  });

  it('maps record types to service and direction', () => {
    const byType = countBy(a.interactions, (i) => `${i.rawType}:${i.service}:${i.direction}`);
    for (const k of byType.keys()) {
      expect(['MOC:call:out', 'MTC:call:in', 'SMO:sms:out', 'SMT:sms:in']).toContain(k);
    }
  });

  it('flags exact duplicate rows without dropping them', () => {
    expect(a.meta.sheets[0].duplicates).toBeGreaterThan(0);
    expect(a.interactions.filter((i) => i.dupOfPrev)).toHaveLength(a.meta.sheets[0].duplicates);
  });

  it('applies the Z interpretation setting', () => {
    const [utc] = drafts(parseWorkbook(wbA, 'utc'));
    expect(utc.interactions[0].ts - a.interactions[0].ts).toBe(7 * 3_600_000);
  });
});

describe('DTAC multi-sheet layout', () => {
  const [c] = drafts(parseWorkbook(wbC, 'local'));

  it('reads the target from the Info sheet and IMSI from DATA', () => {
    expect(c.meta.format).toBe('dtac');
    expect(c.target).toBe(SAMPLE_TARGETS.C);
    expect(c.meta.targetImsis).toEqual(['520050000000303']);
    expect(c.meta.declaredPeriod).toContain('2026/07/01');
  });

  it('references every source row exactly once', () => {
    const refs = c.interactions.flatMap((i) => i.rowRefs);
    expect(new Set(refs).size).toBe(refs.length);
    for (const s of wbC.sheets.filter((x) => x.name !== 'Info')) {
      expect(refs.filter((r) => r.startsWith(`${s.name}!`))).toHaveLength(s.rows.length - 1);
    }
  });

  it('merges the originating and terminating records of an on-net call', () => {
    const paired = c.interactions.filter((i) => i.source === 'IMS' && i.rowRefs.length === 2);
    expect(paired.length).toBeGreaterThan(30);
    for (const p of paired) {
      expect(p.targetObs?.imsi).toBe('520050000000303');
      expect(p.peerObs?.imsi).not.toBe('520050000000303');
    }
  });

  it('counts a call logged in both the VOICE and the IMS sheet once', () => {
    const both = c.interactions.filter((i) => i.source === 'VOICE+IMS');
    expect(both.length).toBeGreaterThan(20);
    for (const it of both) {
      expect(it.rowRefs.some((r) => r.startsWith('VOICE service!'))).toBe(true);
      expect(it.rowRefs.some((r) => r.startsWith('IMS service!'))).toBe(true);
      expect(it.targetObs?.imsi).toBe('520050000000303');
    }
    // Unanswered attempts, whose VOICE row is written seconds after the IMS row.
    expect(both.some((i) => i.answered === false)).toBe(true);
    // Calls with all three rows (both IMS legs + the peer's VOICE leg).
    expect(both.some((i) => i.rowRefs.length === 3)).toBe(true);
    // No call of the same pair is left within 3 s of another.
    const calls = c.interactions.filter((i) => i.service === 'call').sort((x, y) => x.ts - y.ts);
    for (let k = 1; k < calls.length; k++) {
      const p = calls[k - 1];
      const q = calls[k];
      if (p.peer === q.peer && p.direction === q.direction) expect(q.ts - p.ts).toBeGreaterThan(3000);
    }
  });

  it('never attributes a peer handset position to the target', () => {
    for (const it of c.interactions) {
      if (it.targetObs?.imsi) expect(it.targetObs.imsi).toBe('520050000000303');
    }
  });

  it('lists every SIM in the file with its owner and the number using it', () => {
    const check = c.meta.imsiCheck!;
    const mine = check.filter((x) => x.owner === 'target');
    expect(mine.map((x) => [x.imsi, x.basis, x.number])).toEqual([['520050000000303', 'data', SAMPLE_TARGETS.C]]);
    const peers = check.filter((x) => x.owner === 'peer' && x.imsi && x.number);
    expect(peers.length).toBeGreaterThan(0);
    for (const p of peers) {
      expect(p.number).not.toBe(SAMPLE_TARGETS.C);
      // Every row of that SIM is the peer's: its positions are filed under the peer.
      const its = c.interactions.filter((i) => i.peerObs?.imsi === p.imsi);
      expect(its.length).toBeGreaterThan(0);
      expect(its.every((i) => i.peer === p.number)).toBe(true);
      expect(c.interactions.some((i) => i.targetObs?.imsi === p.imsi)).toBe(false);
    }
    const rows = c.meta.sheets.filter((st) => st.sheet !== 'DATA service').reduce((n, st) => n + st.peerOwned, 0);
    expect(check.filter((x) => x.owner === 'peer').reduce((n, x) => n + x.rows, 0)).toBe(rows);
  });

  const OLD = '520050000000303';
  const NEW = '520050000009999';
  /** Sample C without its DATA sheet; from mid-August the target's rows carry another SIM (and optionally another IMEI). */
  function simChange(newImei?: string, imsiOwners?: Record<string, 'target' | 'peer'>) {
    const sheets = wbC.sheets
      .filter((sh) => !/^DATA/.test(sh.name))
      .map((sh) => {
        const head = sh.rows[0] ?? [];
        const ti = head.findIndex((h) => /START TIME|Acct-Start-Time/i.test(String(h)));
        const ii = head.findIndex((h) => String(h).toUpperCase() === 'IMSI');
        const ei = head.findIndex((h) => String(h).toUpperCase() === 'IMEI');
        if (ti < 0 || ii < 0) return sh;
        const swap = (r: (string | null)[]) => r.map((v, j) => (j === ii ? NEW : j === ei && newImei ? newImei : v));
        return { ...sh, rows: sh.rows.map((r, k) => (k > 0 && r[ii] === OLD && String(r[ti]) >= '2026-08-15' ? swap(r) : r)) };
      });
    return drafts(parseWorkbook({ ...wbC, sheets }, 'local', undefined, { imsiOwners }))[0];
  }

  it('gives the target one SIM: another IMSI and its handset are a peer\'s, even in the same phone', () => {
    for (const d of [simChange(), simChange('35000000999999')]) {
      expect(d.meta.targetImsis).toEqual([OLD]);
      expect(d.meta.imsiCheck!.find((x) => x.imsi === OLD)).toMatchObject({ owner: 'target', basis: 'main' });
      expect(d.meta.imsiCheck!.find((x) => x.imsi === NEW)).toMatchObject({ owner: 'peer', basis: 'other' });
      expect(d.interactions.some((i) => i.targetObs?.imsi === NEW)).toBe(false);
      expect(d.interactions.some((i) => i.peerObs?.imsi === NEW)).toBe(true);
    }
    expect(simChange('35000000999999').interactions.some((i) => i.targetObs?.imei === '35000000999999')).toBe(false);
  });

  it('lets the investigator settle the owner of a SIM', () => {
    // Confirmed: the target changed SIM and phone together.
    const d = simChange('35000000999999', { [NEW]: 'target' });
    expect(new Set(d.meta.targetImsis)).toEqual(new Set([OLD, NEW]));
    expect(d.meta.imsiCheck!.find((x) => x.imsi === NEW)).toMatchObject({ owner: 'target', basis: 'manual', auto: 'peer' });
    expect(d.interactions.some((i) => i.targetObs?.imsi === NEW && i.targetObs.cell)).toBe(true);
    expect(d.meta.notes.some((n) => n.includes('ผู้ใช้กำหนดเจ้าของ IMSI เอง 1 ค่า'))).toBe(true);

    // Confirming what the rules already say changes nothing.
    const peer = c.meta.imsiCheck!.find((x) => x.owner === 'peer' && x.imsi)!;
    const same = simChange(undefined, { [peer.imsi]: 'peer' });
    expect(same.meta.imsiCheck!.find((x) => x.imsi === peer.imsi)).toMatchObject({ owner: 'peer', basis: 'other' });

    // A SIM taken away from the target: its rows and positions become the peer's.
    const away = simChange(undefined, { [NEW]: 'peer' });
    expect(away.meta.targetImsis).toEqual([OLD]);
    expect(away.interactions.some((i) => i.targetObs?.imsi === NEW)).toBe(false);
    expect(away.interactions.some((i) => i.peerObs?.imsi === NEW)).toBe(true);

    // The DATA sheet is the target's by subpoena: its SIM cannot be reassigned.
    const [locked] = drafts(parseWorkbook(wbC, 'local', undefined, { imsiOwners: { [OLD]: 'peer' } }));
    expect(locked.meta.imsiCheck!.find((x) => x.imsi === OLD)).toMatchObject({ owner: 'target', basis: 'data', inData: true });
  });

  it('keeps the far-end cell of IMS rows without an IMEI out of the target positions', () => {
    // As in real exports: the target's IMS rows without an IMEI place the call in another province.
    const sheets = wbC.sheets.map((sh) => {
      if (!/^IMS/.test(sh.name)) return sh;
      const head = sh.rows[0] as string[];
      const col = (n: string) => head.findIndex((h) => String(h).toUpperCase() === n);
      const [ii, ie, ip, la, lo] = [col('IMSI'), col('IMEI'), col('PROVINCE'), col('LATITUDE'), col('LONGITUDE')];
      return {
        ...sh,
        rows: sh.rows.map((r, k) =>
          k > 0 && r[ii] === OLD && k % 2 === 0 ? r.map((v, j) => (j === ie ? null : j === ip ? 'ปลายสายทดสอบ' : j === la ? '18.79' : j === lo ? '98.98' : v)) : r,
        ),
      };
    });
    const [d] = drafts(parseWorkbook({ ...wbC, sheets }, 'local'));
    expect(d.interactions.some((i) => i.targetObs?.cell?.province === 'ปลายสายทดสอบ')).toBe(false);
    const far = d.interactions.filter((i) => i.peerCellInferred);
    expect(far.length).toBeGreaterThan(0);
    expect(far.every((i) => i.peerObs?.cell?.province === 'ปลายสายทดสอบ')).toBe(true);
    // The target's own record of these calls stays the target's (SIM and handset), only the cell moves.
    expect(far.every((i) => i.targetObs?.imsi === OLD && !i.targetObs.cell)).toBe(true);
    expect(d.meta.notes.some((n) => n.includes('ไม่มี IMEI'))).toBe(true);
    // Nothing else moves: the same communications as before.
    expect(d.interactions.length).toBe(c.interactions.length);
  });

  it('never puts a peer handset (IMEI) among the target devices', () => {
    const peerImeis = new Set(c.interactions.map((i) => i.peerObs?.imei).filter(Boolean));
    const targetImeis = new Set(c.interactions.map((i) => i.targetObs?.imei).filter(Boolean));
    expect(peerImeis.size).toBeGreaterThan(0);
    for (const e of peerImeis) expect(targetImeis.has(e)).toBe(false);
    const sims = c.meta.imsiCheck!.filter((x) => x.owner === 'peer' && x.imeis.length);
    for (const p of sims) for (const e of p.imeis) expect([...targetImeis].some((t) => String(t).startsWith(e))).toBe(false);
  });

  it('marks calls without duration as unanswered', () => {
    const unanswered = c.interactions.filter((i) => i.service === 'call' && i.answered === false);
    expect(unanswered.length).toBeGreaterThan(0);
    expect(unanswered.every((i) => !i.durationSec)).toBe(true);
  });

  it('turns the target outgoing SMS (recipient-side SMS-MT) into outgoing SMS', () => {
    const out = c.interactions.filter((i) => i.service === 'sms' && i.direction === 'out');
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((i) => i.peerObs && !i.targetObs)).toBe(true);
  });

  it('merges the Wi-Fi start/stop rows of one session', () => {
    const wifi = c.interactions.filter((i) => i.service === 'wifi');
    expect(wifi).toHaveLength(1);
    expect(wifi[0].durationSec).toBe(640);
  });
});

describe('one SIM per target in single-table (AIS) files', () => {
  it('files rows of any other IMSI, with their cell and IMEI, under the other party', () => {
    const head = wbA.sheets[0].rows[0] as string[];
    const ii = head.indexOf('IMSI');
    const ie = head.indexOf('IMEI');
    const rows = wbA.sheets[0].rows.map((r, k) => (k > 0 && k % 50 === 0 ? r.map((v, j) => (j === ii ? '520039999999999' : j === ie ? '35999999000001' : v)) : r));
    const [d] = drafts(parseWorkbook({ ...wbA, sheets: [{ ...wbA.sheets[0], rows }] }, 'local'));
    const [orig] = drafts(parseWorkbook(wbA, 'local'));
    expect(d.interactions.length).toBe(orig.interactions.length);
    expect(d.meta.targetImsis).toEqual(orig.meta.targetImsis);
    const moved = d.interactions.filter((i) => i.peerObs?.imsi === '520039999999999');
    expect(moved.length).toBe(Math.floor((rows.length - 1) / 50));
    expect(moved.every((i) => !i.targetObs && i.peerObs?.imei === '35999999000001')).toBe(true);
    expect(d.meta.imsiCheck!.map((x) => [x.owner, x.basis])).toEqual([['target', 'main'], ['peer', 'other']]);
    expect(d.meta.notes.some((n) => n.includes('IMSI อื่นอีก 1 ค่า'))).toBe(true);
    // The investigator can still say otherwise.
    const [m] = drafts(parseWorkbook({ ...wbA, sheets: [{ ...wbA.sheets[0], rows }] }, 'local', undefined, { imsiOwners: { '520039999999999': 'target' } }));
    expect(m.meta.imsiCheck!.find((x) => x.imsi === '520039999999999')).toMatchObject({ owner: 'target', basis: 'manual', auto: 'peer' });
  });
});

describe('sample files on disk', () => {
  it('parse identically to the in-memory samples', async () => {
    for (const wb of [wbA, wbB, wbC]) {
      const buf = readFileSync(join(process.cwd(), 'samples', wb.fileName));
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      const fromDisk = drafts(parseWorkbook(await readWorkbook(ab, wb.fileName), 'local'))[0];
      const inMemory = drafts(parseWorkbook(wb, 'local'))[0];
      expect(fromDisk.target).toBe(inMemory.target);
      expect(fromDisk.interactions.length).toBe(inMemory.interactions.length);
      expect(fromDisk.interactions.map((i) => i.ts)).toEqual(inMemory.interactions.map((i) => i.ts));
    }
  });
});

describe('other flat layouts', () => {
  const csv = (text: string) => readCsv(new TextEncoder().encode(text).buffer as ArrayBuffer, 'export.csv');

  it('auto-maps Thai headers with separate date and time columns', () => {
    const wb = csv(['วันที่,เวลา,เบอร์ต้นทาง,เบอร์ปลายทาง,ประเภท,ระยะเวลา,จังหวัด', '01/08/2026,10:00:00,0811111111,0822222222,โทรออก,30,ตาก', '01/08/2026,10:05:00,0833333333,0811111111,โทรเข้า,15,ตาก', '01/08/2026,11:00:00,0811111111,0844444444,โทรออก,60,ตาก'].join('\n'));
    const [d] = drafts(parseWorkbook(wb, 'local'));
    expect(d.target).toBe('0811111111');
    expect(d.interactions).toHaveLength(3);
    expect(d.interactions[1]).toMatchObject({ service: 'call', peer: '0833333333' });
  });

  it('asks for a mapping when required columns are unknown, then parses with it', () => {
    const wb = csv(['when,from,to,len', '2026-08-01 10:00:00,0811111111,0822222222,30', '2026-08-01 11:00:00,0811111111,0833333333,12'].join('\n'));
    const out = parseWorkbook(wb, 'local');
    expect(out.kind).toBe('needs-mapping');
    const [d] = drafts(parseWorkbook(wb, 'local', { sheet: wb.sheets[0].name, headerRow: 0, columns: { time: 0, a: 1, b: 2, duration: 3 } }));
    expect(d.interactions).toHaveLength(2);
    expect(d.interactions[0]).toMatchObject({ direction: 'out', durationSec: 30, peer: '0822222222' });
  });

  it('decodes legacy Windows-874 CSV files', () => {
    const header = 'วันที่เวลา,เบอร์ต้นทาง,เบอร์ปลายทาง';
    const bytes: number[] = [];
    for (const ch of header) {
      const cp = ch.codePointAt(0)!;
      bytes.push(cp >= 0x0e01 && cp <= 0x0e5b ? cp - 0x0e01 + 0xa1 : cp);
    }
    const wb = readCsv(new Uint8Array(bytes).buffer, 'legacy.csv');
    expect(wb.sheets[0].rows[0][0]).toBe('วันที่เวลา');
  });
});
