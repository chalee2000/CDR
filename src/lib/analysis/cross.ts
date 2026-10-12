import { activeInteractions, isComm } from '../dataset';
import { imeiCore } from '../imei';
import { interactionLabel } from '../labels';
import { isPersonKind } from '../phone';
import { dayKey, MINUTE } from '../time';
import type { Dataset, Interaction, PeerKind, Settings } from '../types';
import { haversineKm } from '../util';
import { contactStats } from './contacts';
import { CoordResolver, siteLabelOf } from './locations';

export interface CommonContactSide {
  datasetId: string;
  target: string;
  slot: number;
  total: number;
  calls: number;
  sms: number;
  talkSec: number;
  firstTs: number;
  lastTs: number;
}

export interface CommonContact {
  peer: string;
  kind: PeerKind;
  country?: string;
  perTarget: CommonContactSide[];
  total: number;
  /** True when the periods of contact with the different targets overlap. */
  overlap: boolean;
}

/** Parties (not themselves loaded targets) in contact with two or more targets. */
export function commonContacts(datasets: Dataset[], settings: Settings): CommonContact[] {
  const targets = new Set(datasets.map((d) => d.target));
  const map = new Map<string, CommonContact>();
  for (const ds of datasets) {
    for (const c of contactStats(ds, settings)) {
      if (targets.has(c.peer)) continue;
      if (!settings.includeServiceNumbers && !c.isPerson) continue;
      let cc = map.get(c.peer);
      if (!cc) {
        cc = { peer: c.peer, kind: c.kind, country: c.country, perTarget: [], total: 0, overlap: false };
        map.set(c.peer, cc);
      }
      cc.perTarget.push({
        datasetId: ds.id,
        target: ds.target,
        slot: ds.slot,
        total: c.total,
        calls: c.callsOut + c.callsIn + c.callsFwd,
        sms: c.smsOut + c.smsIn,
        talkSec: c.talkSec,
        firstTs: c.firstTs,
        lastTs: c.lastTs,
      });
      cc.total += c.total;
    }
  }
  const out = [...map.values()].filter((c) => new Set(c.perTarget.map((p) => p.target)).size >= 2);
  for (const c of out) {
    const s = c.perTarget;
    c.overlap = s.some((a, i) => s.some((b, j) => i < j && a.firstTs <= b.lastTs && b.firstTs <= a.lastTs));
  }
  return out.sort((a, b) => b.perTarget.length - a.perTarget.length || b.total - a.total);
}

export interface DirectLink {
  fromId: string;
  fromTarget: string;
  toId: string;
  toTarget: string;
  events: number;
  calls: number;
  sms: number;
  talkSec: number;
  firstTs: number;
  lastTs: number;
}

/** Communications in one target's file whose other party is another loaded target. */
export function directLinks(datasets: Dataset[], settings: Settings): DirectLink[] {
  const out: DirectLink[] = [];
  for (const a of datasets) {
    for (const b of datasets) {
      if (a === b || a.target === b.target) continue;
      const items = activeInteractions(a, settings).filter((i) => isComm(i) && i.peer === b.target);
      if (!items.length) continue;
      out.push({
        fromId: a.id,
        fromTarget: a.target,
        toId: b.id,
        toTarget: b.target,
        events: items.length,
        calls: items.filter((i) => i.service === 'call').length,
        sms: items.filter((i) => i.service === 'sms').length,
        talkSec: items.reduce((s, i) => s + (i.answered ? (i.durationSec ?? 0) : 0), 0),
        firstTs: Math.min(...items.map((i) => i.ts)),
        lastTs: Math.max(...items.map((i) => i.ts)),
      });
    }
  }
  return out;
}

export interface ChainEnd {
  datasetId: string;
  target: string;
  ts: number;
  label: string;
  direction: Interaction['direction'];
}

export interface RelayChain {
  via: string;
  first: ChainEnd;
  second: ChainEnd;
  gapMin: number;
  /** first = target A contacted X, second = X contacted target B. */
  flow: boolean;
}

/**
 * Temporal alignment candidates: target A and party X communicate, then X
 * and target B communicate within relayMinutes. Order in time only — it
 * does not show that information passed along.
 */
export function relayChains(datasets: Dataset[], settings: Settings, limit = 2000): RelayChain[] {
  const common = commonContacts(datasets, settings);
  const byId = new Map(datasets.map((d) => [d.id, d]));
  const win = settings.relayMinutes * MINUTE;
  const out: RelayChain[] = [];
  for (const c of common) {
    const events = new Map<string, Interaction[]>();
    for (const side of c.perTarget) {
      const ds = byId.get(side.datasetId)!;
      events.set(
        ds.id,
        activeInteractions(ds, settings)
          .filter((i) => isComm(i) && i.peer === c.peer)
          .sort((x, y) => x.ts - y.ts),
      );
    }
    for (const a of c.perTarget) {
      for (const b of c.perTarget) {
        if (a.datasetId === b.datasetId || a.target === b.target) continue;
        const ea = events.get(a.datasetId)!;
        const eb = events.get(b.datasetId)!;
        let j = 0;
        for (const x of ea) {
          while (j < eb.length && eb[j].ts < x.ts) j++;
          for (let k = j; k < eb.length && eb[k].ts - x.ts <= win; k++) {
            const y = eb[k];
            out.push({
              via: c.peer,
              first: { datasetId: a.datasetId, target: a.target, ts: x.ts, label: interactionLabel(x), direction: x.direction },
              second: { datasetId: b.datasetId, target: b.target, ts: y.ts, label: interactionLabel(y), direction: y.direction },
              gapMin: (y.ts - x.ts) / MINUTE,
              flow: x.direction === 'out' && y.direction === 'in',
            });
            if (out.length >= limit) return out.sort((p, q) => p.first.ts - q.first.ts);
          }
        }
      }
    }
  }
  return out.sort((p, q) => p.first.ts - q.first.ts);
}

export interface DeviceUseRef {
  datasetId: string;
  target: string;
  number: string;
  role: 'target' | 'peer';
  count: number;
  firstTs: number;
  lastTs: number;
}

export interface SharedDevice {
  kind: 'IMEI' | 'IMSI';
  value: string;
  uses: DeviceUseRef[];
}

/** One handset (IMEI) or SIM (IMSI) seen with two or more different numbers. */
export function sharedDevices(datasets: Dataset[], settings: Settings): SharedDevice[] {
  const map = new Map<string, SharedDevice>();
  const add = (kind: 'IMEI' | 'IMSI', value: string, ds: Dataset, number: string, role: 'target' | 'peer', ts: number) => {
    const key = `${kind}:${value}`;
    let d = map.get(key);
    if (!d) map.set(key, (d = { kind, value, uses: [] }));
    let u = d.uses.find((x) => x.datasetId === ds.id && x.number === number && x.role === role);
    if (!u) d.uses.push((u = { datasetId: ds.id, target: ds.target, number, role, count: 0, firstTs: ts, lastTs: ts }));
    u.count++;
    u.firstTs = Math.min(u.firstTs, ts);
    u.lastTs = Math.max(u.lastTs, ts);
  };
  for (const ds of datasets) {
    for (const it of activeInteractions(ds, settings)) {
      if (it.source === 'WIFI') continue;
      for (const [obs, number, role] of [
        [it.targetObs, ds.target, 'target'],
        [it.peerObs, it.peer, 'peer'],
      ] as const) {
        if (!obs || !number) continue;
        const core = imeiCore(obs.imei);
        if (core) add('IMEI', core, ds, number, role, it.ts);
        if (obs.imsi) add('IMSI', obs.imsi, ds, number, role, it.ts);
      }
    }
  }
  return [...map.values()]
    .filter((d) => new Set(d.uses.map((u) => u.number)).size >= 2)
    .sort((a, b) => b.uses.length - a.uses.length);
}

export interface CoLocation {
  aId: string;
  aTarget: string;
  bId: string;
  bTarget: string;
  day: string;
  siteA: string;
  siteB: string;
  firstTs: number;
  lastTs: number;
  matches: number;
  minGapMin: number;
  distanceKm?: number;
}

/**
 * Co-location candidates: two targets on the same site (or within
 * coLocationKm when both positions come from real coordinates) within
 * ±coLocationMinutes. A shared cell does not prove the two were together.
 */
export function coLocations(datasets: Dataset[], settings: Settings, resolver = new CoordResolver()): CoLocation[] {
  const win = settings.coLocationMinutes * MINUTE;
  const located = datasets.map((ds) =>
    activeInteractions(ds, settings)
      .filter((i) => i.targetObs?.cell && i.source !== 'WIFI')
      .map((i) => {
        const cell = i.targetObs!.cell!;
        const c = resolver.resolve(cell);
        return { ts: i.ts, site: siteLabelOf(cell), coord: c && c.source !== 'approx' ? c : undefined };
      })
      .sort((x, y) => x.ts - y.ts),
  );
  const out = new Map<string, CoLocation>();
  for (let i = 0; i < datasets.length; i++) {
    for (let j = i + 1; j < datasets.length; j++) {
      if (datasets[i].target === datasets[j].target) continue;
      const A = located[i];
      const B = located[j];
      let lo = 0;
      for (const a of A) {
        while (lo < B.length && B[lo].ts < a.ts - win) lo++;
        for (let k = lo; k < B.length && B[k].ts <= a.ts + win; k++) {
          const b = B[k];
          let dist: number | undefined;
          let same = a.site.key === b.site.key;
          if (!same && a.coord && b.coord) {
            dist = haversineKm(a.coord.lat, a.coord.lon, b.coord.lat, b.coord.lon);
            same = dist <= settings.coLocationKm;
          }
          if (!same) continue;
          const day = dayKey(Math.min(a.ts, b.ts));
          const key = `${i}|${j}|${day}|${a.site.key}|${b.site.key}`;
          const gap = Math.abs(a.ts - b.ts) / MINUTE;
          const cur = out.get(key);
          if (!cur) {
            out.set(key, {
              aId: datasets[i].id,
              aTarget: datasets[i].target,
              bId: datasets[j].id,
              bTarget: datasets[j].target,
              day,
              siteA: a.site.label,
              siteB: b.site.label,
              firstTs: Math.min(a.ts, b.ts),
              lastTs: Math.max(a.ts, b.ts),
              matches: 1,
              minGapMin: gap,
              distanceKm: dist,
            });
          } else {
            cur.matches++;
            cur.firstTs = Math.min(cur.firstTs, a.ts, b.ts);
            cur.lastTs = Math.max(cur.lastTs, a.ts, b.ts);
            cur.minGapMin = Math.min(cur.minGapMin, gap);
            if (dist !== undefined) cur.distanceKm = Math.min(cur.distanceKm ?? dist, dist);
          }
        }
      }
    }
  }
  return [...out.values()].sort((a, b) => a.firstTs - b.firstTs);
}

export function isServicePeer(kind: PeerKind): boolean {
  return !isPersonKind(kind);
}
