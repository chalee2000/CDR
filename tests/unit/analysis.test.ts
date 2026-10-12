import { describe, expect, it } from 'vitest';
import readXlsxFile from 'read-excel-file/universal';
import { buildDataset } from '../../src/lib/dataset';
import { parseWorkbook } from '../../src/lib/parsers';
import { generateSamples, SAMPLE_TARGETS } from '../../src/lib/samples/generate';
import { DEFAULT_SETTINGS, type Dataset } from '../../src/lib/types';
import { contactStats } from '../../src/lib/analysis/contacts';
import { coLocations, commonContacts, directLinks, relayChains, sharedDevices } from '../../src/lib/analysis/cross';
import { deviceStats } from '../../src/lib/analysis/devices';
import { CoordResolver, homeWorkCandidates, siteStats, stays } from '../../src/lib/analysis/locations';
import { buildNetwork, DEFAULT_NETWORK_OPTIONS, egoNetwork } from '../../src/lib/analysis/network';
import { summarize } from '../../src/lib/analysis/summary';
import { bursts, dailySeries, hourProfile, silences } from '../../src/lib/analysis/temporal';
import { analysisTables, exportAnalysisXlsx } from '../../src/lib/export/excel';
import { toCsv } from '../../src/lib/export/csv';
import { dayKey } from '../../src/lib/time';

const settings = DEFAULT_SETTINGS;
const datasets: Dataset[] = generateSamples().map((wb, i) => {
  const out = parseWorkbook(wb, 'local');
  if (out.kind !== 'ok') throw new Error('sample did not parse');
  return buildDataset(out.drafts[0], i);
});
const [A, B, C] = datasets;

describe('per-target analysis', () => {
  it('summarises calls, SMS and data consistently with the records', () => {
    const s = summarize(C, settings);
    const calls = C.interactions.filter((i) => i.service === 'call');
    expect(s.callsOut + s.callsIn + s.callsFwd).toBe(calls.length);
    expect(s.callsAnswered + s.callsUnanswered).toBe(calls.filter((i) => i.answered !== undefined).length);
    expect(s.dataSessions).toBe(C.interactions.filter((i) => i.service === 'data').length);
    expect(s.provinces).toContain('กรุงเทพมหานคร');
  });

  it('ranks contacts and keeps raw spellings of international numbers', () => {
    const contacts = contactStats(A, settings);
    expect(contacts[0].peer).toBe('0860000111');
    const mm = contacts.find((c) => c.kind === 'intl')!;
    expect(mm.peer).toBe('+959400000555');
    expect(mm.rawValues.length).toBeGreaterThan(0);
  });

  it('exposes the on-net peer handset and position', () => {
    const p = contactStats(C, settings).find((c) => c.peer === '0640000404')!;
    expect(p.peerImeis).toContain('35555500001001');
    expect(p.peerSites.length).toBeGreaterThan(0);
  });

  it('finds the silence, the burst and builds full daily series', () => {
    const gaps = silences(A, settings);
    // The phone is silent 2026-08-10 08:00 -> 2026-08-13 10:00 in the sample.
    expect(gaps[0].hours).toBeGreaterThan(74);
    expect(dayKey(gaps[0].from) <= '2026-08-10').toBe(true);
    expect(dayKey(gaps[0].to) >= '2026-08-13').toBe(true);
    const b = bursts(B, settings);
    expect(b.some((x) => dayKey(x.from) === '2026-08-05' && x.count >= 6)).toBe(true);
    const days = dailySeries(C, settings);
    expect(days).toHaveLength(62);
    const prof = hourProfile(A, settings);
    expect(prof.heat.flat().reduce((x, y) => x + y, 0)).toBe(prof.comm.reduce((x, y) => x + y, 0));
  });

  it('finds sites, the home candidate and the travel route', () => {
    const resolver = new CoordResolver();
    const sites = siteStats(A, settings, resolver);
    expect(sites).toHaveLength(4);
    expect(sites.every((s) => s.coord?.source === 'approx')).toBe(true);
    expect(homeWorkCandidates(A, settings, sites).home?.site.label).toBe('บ้านจำลองแม่สาย');
    const cSites = siteStats(C, settings, resolver);
    expect(cSites.every((s) => s.coord?.source === 'file')).toBe(true);
    const route = stays(C, settings, 'province').map((s) => s.area);
    expect(route).toContain('กรุงเทพมหานคร');
    expect(route).toContain('ชุมพร');
  });

  it('tracks handsets: phone change and dual-SIM candidate', () => {
    const d = deviceStats(A, settings);
    expect(d.imeis.map((x) => x.core)).toEqual(['35555500001001', '86600000012345', '86600000012346']);
    expect(d.dualSim).toEqual([['86600000012345', '86600000012346']]);
    expect(d.switches).toBe(2);
  });

  it('collapses exact duplicates only when asked', () => {
    const all = summarize(A, settings).records;
    const deduped = summarize(A, { ...settings, dedupeExact: true }).records;
    expect(all - deduped).toBe(A.meta.sheets[0].duplicates);
  });
});

describe('cross-target analysis', () => {
  it('finds exactly the shared contacts', () => {
    const common = commonContacts(datasets, settings).map((c) => c.peer).sort();
    expect(common).toEqual(['0860000111', '0950000222']);
  });

  it('finds direct calls between B and C from both files', () => {
    const links = directLinks(datasets, settings);
    const bc = links.find((l) => l.fromTarget === SAMPLE_TARGETS.B && l.toTarget === SAMPLE_TARGETS.C)!;
    const cb = links.find((l) => l.fromTarget === SAMPLE_TARGETS.C && l.toTarget === SAMPLE_TARGETS.B)!;
    expect(bc.calls).toBe(8);
    expect(cb.calls).toBe(8);
  });

  it('finds relay candidates A -> X1 -> B', () => {
    const chains = relayChains(datasets, settings).filter((r) => r.via === '0860000111' && r.first.target === SAMPLE_TARGETS.A && r.second.target === SAMPLE_TARGETS.B && r.flow);
    expect(chains.length).toBeGreaterThanOrEqual(7);
    expect(chains.every((r) => r.gapMin >= 0 && r.gapMin <= settings.relayMinutes)).toBe(true);
  });

  it('finds the handset shared by A and a contact of C', () => {
    const shared = sharedDevices(datasets, settings).find((d) => d.kind === 'IMEI' && d.value === '35555500001001')!;
    expect(shared.uses.map((u) => u.number).sort()).toEqual(['0640000404', SAMPLE_TARGETS.A].sort());
  });

  it('finds B and C at the same site on 2026-08-20', () => {
    const co = coLocations(datasets, settings);
    expect(co.some((c) => c.day === '2026-08-20' && c.siteA === 'ตลาดจำลองจตุจักร')).toBe(true);
    expect(co.every((c) => c.minGapMin <= settings.coLocationMinutes)).toBe(true);
  });

  it('builds the network with shared contacts as bridges', () => {
    const net = buildNetwork(datasets, settings, DEFAULT_NETWORK_OPTIONS);
    const x1 = net.nodes.find((n) => n.id === '0860000111')!;
    expect(x1.shared).toBe(true);
    expect(x1.betweenness).toBeGreaterThan(0);
    // B-C appear in both files: the edge counts each call once.
    const bc = net.edges.find((e) => [e.source, e.target].sort().join() === [SAMPLE_TARGETS.B, SAMPLE_TARGETS.C].sort().join())!;
    expect(bc.calls).toBe(8);
    expect(net.nodes.filter((n) => n.isTarget)).toHaveLength(3);
    const onlyShared = buildNetwork(datasets, settings, { ...DEFAULT_NETWORK_OPTIONS, onlyShared: true });
    expect(onlyShared.nodes.filter((n) => !n.isTarget).map((n) => n.id).sort()).toEqual(['0860000111', '0950000222']);
  });

  it('keeps call direction on every link, once per call between two targets', () => {
    const net = buildNetwork(datasets, settings, { ...DEFAULT_NETWORK_OPTIONS, topN: 0 });
    for (const e of net.edges) {
      expect(e.ab + e.ba).toBeLessThanOrEqual(e.events);
      expect(e.firstTs).toBeLessThanOrEqual(e.lastTs);
    }
    // B's file and C's file both hold the 8 B-C calls; each direction counts once.
    const bc = net.edges.find((e) => [e.source, e.target].sort().join() === [SAMPLE_TARGETS.B, SAMPLE_TARGETS.C].sort().join())!;
    const bCalls = B.interactions.filter((i) => i.peer === SAMPLE_TARGETS.C && i.service === 'call');
    const fromB = bc.source === SAMPLE_TARGETS.B ? bc.ab : bc.ba;
    const toB = bc.source === SAMPLE_TARGETS.B ? bc.ba : bc.ab;
    expect(fromB).toBe(bCalls.filter((i) => i.direction === 'out').length);
    expect(toB).toBe(bCalls.filter((i) => i.direction === 'in').length);
    expect(fromB + toB).toBe(8);
    // A's outgoing and incoming contacts with X1 match its contact stats.
    const x1 = contactStats(A, settings).find((c) => c.peer === '0860000111')!;
    const ax = net.edges.find((e) => [e.source, e.target].sort().join() === [SAMPLE_TARGETS.A, '0860000111'].sort().join())!;
    const fromA = ax.source === SAMPLE_TARGETS.A ? ax.ab : ax.ba;
    expect(fromA).toBe(x1.callsOut + x1.smsOut);
  });

  it('cuts out the neighbourhood of one number', () => {
    const net = buildNetwork(datasets, settings, DEFAULT_NETWORK_OPTIONS);
    const ego = egoNetwork(net, '0860000111');
    expect(ego.nodes.map((n) => n.id).sort()).toEqual(['0860000111', SAMPLE_TARGETS.A, SAMPLE_TARGETS.B].sort());
    expect(ego.edges.every((e) => ego.nodes.some((n) => n.id === e.source) && ego.nodes.some((n) => n.id === e.target))).toBe(true);
  });
});

describe('exports', () => {
  it('produces every table and a readable workbook', async () => {
    const tables = analysisTables(datasets, settings);
    expect(tables.map((t) => t.sheet)).toContain('ผู้ติดต่อร่วม');
    for (const t of tables) for (const r of t.rows) expect(r).toHaveLength(t.header.length);
    const blob = await exportAnalysisXlsx(datasets, settings);
    const sheets = await readXlsxFile(await blob.arrayBuffer());
    expect(sheets.map((s) => s.sheet)).toContain('สรุป');
    expect(sheets.find((s) => s.sheet === 'สรุป')!.data).toHaveLength(4);
  });

  it('adds the person details typed in by the user (and no sheet when there are none)', () => {
    const profiles = { '0860000111': { number: '0860000111', firstName: 'นายทดสอบ', lastName: 'ตัวอย่าง', criminalRecord: 'คดีสมมติ 1\nคดีสมมติ 2', updatedAt: Date.UTC(2026, 9, 1) } };
    const tables = analysisTables(datasets, settings, undefined, profiles);
    for (const t of tables) for (const r of t.rows) expect(r).toHaveLength(t.header.length);
    const people = tables.find((t) => t.sheet === 'ข้อมูลบุคคล')!;
    expect(people.rows).toHaveLength(1);
    expect(people.rows[0][people.header.indexOf('จำนวนคดี')]).toBe(2);
    const contacts = tables.find((t) => t.sheet === 'คู่ติดต่อ')!;
    expect(contacts.rows.some((r) => r[1] === '0860000111' && r[2] === 'นายทดสอบ ตัวอย่าง')).toBe(true);
    expect(analysisTables(datasets, settings).some((t) => t.sheet === 'ข้อมูลบุคคล')).toBe(false);
  });

  it('writes CSV with BOM, quoting and formula neutralising', () => {
    const csv = toCsv(['a', 'b'], [['=cmd()', 'x,y'], [-5, null]]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain("'=cmd()");
    expect(csv).toContain('"x,y"');
    expect(csv).toContain('-5,');
  });
});
