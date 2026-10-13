import { activeInteractions, isComm } from '../dataset';
import { isPersonKind } from '../phone';
import { isNight, MINUTE } from '../time';
import type { Dataset, Interaction, PeerKind, Settings } from '../types';
import { siteLabelOf } from './locations';
import type { NetEdge, NetNode, Network } from './network';

/**
 * Call bursts: windows with at least `burstCount` calls (and SMS unless
 * `burstSms` is off) to or from person numbers within `burstMinutes`.
 * Overlapping windows merge into one burst, so a long run of dense activity
 * is reported once with its real start, end and size. A multi-part SMS
 * counts once.
 */

export interface BurstPeer {
  peer: string;
  kind: PeerKind;
  count: number;
}

export interface CallBurst {
  id: string;
  datasetId: string;
  target: string;
  slot: number;
  from: number;
  to: number;
  minutes: number;
  count: number;
  callsOut: number;
  callsIn: number;
  sms: number;
  talkSec: number;
  /** Parties in the burst, most frequent first. */
  peers: BurstPeer[];
  /** Site the target was seen at most during the burst (when the file has one). */
  topSite?: string;
  /** Any event falls in the night hours set in the settings. */
  night: boolean;
  events: Interaction[];
}

/** SMS parts from the same number within this gap count as one message. */
export const SMS_PART_GAP_MS = 60_000;

function burstEvents(ds: Dataset, settings: Settings): Interaction[] {
  const sorted = activeInteractions(ds, settings)
    .filter((i) => isComm(i) && isPersonKind(i.peerKind) && (settings.burstSms || i.service === 'call'))
    .sort((a, b) => a.ts - b.ts);
  // A long SMS arrives as several rows seconds apart (or as identical rows);
  // it is one communication, so only its first part counts.
  const out: Interaction[] = [];
  const lastPart = new Map<string, number>();
  for (const it of sorted) {
    if (it.dupOfPrev) continue;
    if (it.service === 'sms') {
      const key = `${it.peer}|${it.direction}`;
      const prev = lastPart.get(key);
      lastPart.set(key, it.ts);
      if (prev !== undefined && it.ts - prev <= SMS_PART_GAP_MS) continue;
    }
    out.push(it);
  }
  return out;
}

function describe(ds: Dataset, events: Interaction[], settings: Settings): CallBurst {
  const peers = new Map<string, BurstPeer>();
  const sites = new Map<string, number>();
  let callsOut = 0;
  let callsIn = 0;
  let sms = 0;
  let talkSec = 0;
  let night = false;
  for (const e of events) {
    if (e.service === 'call') {
      if (e.direction === 'out') callsOut++;
      else if (e.direction === 'in') callsIn++;
      if (e.answered) talkSec += e.durationSec ?? 0;
    } else sms++;
    const p = peers.get(e.peer!) ?? { peer: e.peer!, kind: e.peerKind, count: 0 };
    p.count++;
    peers.set(p.peer, p);
    if (e.targetObs?.cell) {
      const label = siteLabelOf(e.targetObs.cell).label;
      sites.set(label, (sites.get(label) ?? 0) + 1);
    }
    night ||= isNight(e.ts, settings.nightStart, settings.nightEnd);
  }
  let topSite: string | undefined;
  let best = 0;
  for (const [label, n] of sites) if (n > best) [topSite, best] = [label, n];
  const from = events[0].ts;
  const to = events[events.length - 1].ts;
  return {
    id: `${ds.id}@${from}`,
    datasetId: ds.id,
    target: ds.target,
    slot: ds.slot,
    from,
    to,
    minutes: (to - from) / MINUTE,
    count: events.length,
    callsOut,
    callsIn,
    sms,
    talkSec,
    peers: [...peers.values()].sort((a, b) => b.count - a.count || a.peer.localeCompare(b.peer)),
    topSite,
    night,
    events,
  };
}

export function findBursts(ds: Dataset, settings: Settings): CallBurst[] {
  const events = burstEvents(ds, settings);
  const win = settings.burstMinutes * MINUTE;
  const need = Math.max(2, settings.burstCount);
  const spans: [number, number][] = [];
  let j = 0;
  for (let i = 0; i < events.length; i++) {
    while (events[i].ts - events[j].ts > win) j++;
    if (i - j + 1 < need) continue;
    const last = spans[spans.length - 1];
    if (last && j <= last[1]) last[1] = i;
    else spans.push([j, i]);
  }
  return spans.map(([a, b]) => describe(ds, events.slice(a, b + 1), settings));
}

export function allBursts(datasets: Dataset[], settings: Settings): CallBurst[] {
  return datasets.flatMap((ds) => findBursts(ds, settings)).sort((a, b) => a.from - b.from);
}

/** How many communications of a dataset the burst rules look at (for shares). */
export function burstBase(ds: Dataset, settings: Settings): number {
  return burstEvents(ds, settings).length;
}

export interface BurstPeerStats {
  peer: string;
  kind: PeerKind;
  bursts: number;
  events: number;
  datasetIds: string[];
  firstTs: number;
  lastTs: number;
}

/** Parties that keep turning up in bursts. */
export function burstPeers(bursts: CallBurst[]): BurstPeerStats[] {
  const map = new Map<string, BurstPeerStats & { _ds: Set<string> }>();
  for (const b of bursts) {
    for (const p of b.peers) {
      let s = map.get(p.peer);
      if (!s) {
        s = { peer: p.peer, kind: p.kind, bursts: 0, events: 0, datasetIds: [], firstTs: b.from, lastTs: b.to, _ds: new Set() };
        map.set(p.peer, s);
      }
      s.bursts++;
      s.events += p.count;
      s._ds.add(b.datasetId);
      s.firstTs = Math.min(s.firstTs, b.from);
      s.lastTs = Math.max(s.lastTs, b.to);
    }
  }
  return [...map.values()]
    .map(({ _ds, ...s }) => ({ ...s, datasetIds: [..._ds] }))
    .sort((a, b) => b.bursts - a.bursts || b.events - a.events || a.peer.localeCompare(b.peer));
}

export interface BurstPair {
  a: CallBurst;
  b: CallBurst;
  /** Minutes the two bursts overlap (0 when they only come close). */
  overlapMin: number;
  /** Minutes between them when they do not overlap. */
  gapMin: number;
  /** Parties found in both bursts. */
  sharedPeers: string[];
  /** One target is a party in the other's burst. */
  direct: boolean;
}

/** Bursts of different targets that overlap or fall within `toleranceMin` of each other. */
export function simultaneousBursts(bursts: CallBurst[], toleranceMin: number): BurstPair[] {
  const sorted = [...bursts].sort((x, y) => x.from - y.from);
  const tol = toleranceMin * MINUTE;
  const out: BurstPair[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length && sorted[j].from <= a.to + tol; j++) {
      const b = sorted[j];
      if (b.datasetId === a.datasetId || b.target === a.target) continue;
      const overlap = Math.min(a.to, b.to) - Math.max(a.from, b.from);
      const aPeers = new Set(a.peers.map((p) => p.peer));
      const bPeers = new Set(b.peers.map((p) => p.peer));
      out.push({
        a,
        b,
        overlapMin: Math.max(0, overlap) / MINUTE,
        gapMin: Math.max(0, -overlap) / MINUTE,
        sharedPeers: [...aPeers].filter((p) => bPeers.has(p) && p !== a.target && p !== b.target).sort(),
        direct: aPeers.has(b.target) || bPeers.has(a.target),
      });
    }
  }
  return out;
}

/**
 * The burst as a small link chart: its target and the parties it involved,
 * with counts per direction. A party that is another loaded target becomes a
 * hub of its own colour.
 */
export function burstNetwork(burst: CallBurst, datasets: Pick<Dataset, 'id' | 'target' | 'slot'>[] = []): Network {
  const targets = new Map(datasets.map((d) => [d.target, d]));
  const edges = new Map<string, NetEdge>();
  for (const e of burst.events) {
    const peer = e.peer!;
    const [a, b] = burst.target < peer ? [burst.target, peer] : [peer, burst.target];
    let edge = edges.get(peer);
    if (!edge) {
      edge = { source: a, target: b, events: 0, calls: 0, sms: 0, talkSec: 0, weight: 0, ab: 0, ba: 0, firstTs: e.ts, lastTs: e.ts };
      edges.set(peer, edge);
    }
    edge.events++;
    edge.weight++;
    if (e.service === 'call') {
      edge.calls++;
      if (e.answered) edge.talkSec += e.durationSec ?? 0;
    } else edge.sms++;
    const from = e.direction === 'out' ? burst.target : e.direction === 'in' ? peer : undefined;
    if (from === a) edge.ab++;
    else if (from === b) edge.ba++;
    edge.firstTs = Math.min(edge.firstTs, e.ts);
    edge.lastTs = Math.max(edge.lastTs, e.ts);
  }
  const node = (id: string, isTarget: boolean, slot: number | undefined, kind: NetNode['kind'], weighted: number, degree: number, datasetIds: string[]): NetNode => ({
    id,
    isTarget,
    slot,
    datasetIds,
    label: id,
    kind,
    degree,
    weightedDegree: weighted,
    betweenness: 0,
    pagerank: 0,
    community: 0,
    shared: false,
  });
  const nodes: NetNode[] = [node(burst.target, true, burst.slot, 'target', burst.count, burst.peers.length, [burst.datasetId])];
  for (const p of burst.peers) {
    const other = targets.get(p.peer);
    nodes.push(node(p.peer, !!other, other?.slot, other ? 'target' : p.kind, p.count, 1, other ? [other.id, burst.datasetId] : [burst.datasetId]));
  }
  return { nodes, edges: [...edges.values()], communities: 1, modularity: 0 };
}
