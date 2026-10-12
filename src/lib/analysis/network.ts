import { UndirectedGraph } from 'graphology';
import betweennessCentrality from 'graphology-metrics/centrality/betweenness';
import pagerank from 'graphology-metrics/centrality/pagerank';
import louvain from 'graphology-communities-louvain';
import { activeInteractions, isComm } from '../dataset';
import { isPersonKind } from '../phone';
import type { Dataset, PeerKind, Settings } from '../types';

export type EdgeWeight = 'events' | 'calls' | 'talk';

export interface NetworkOptions {
  weight: EdgeWeight;
  minWeight: number;
  /** Keep only the N strongest contacts of each target (0 = all). */
  topN: number;
  /** Keep only contacts linked to two or more targets. */
  onlyShared: boolean;
}

export const DEFAULT_NETWORK_OPTIONS: NetworkOptions = { weight: 'events', minWeight: 1, topN: 40, onlyShared: false };

export interface NetNode {
  id: string;
  isTarget: boolean;
  /** Datasets (targets) this node is linked to or belongs to. */
  datasetIds: string[];
  /** Slot of the dataset when the node is a target. */
  slot?: number;
  label: string;
  kind: PeerKind | 'target';
  degree: number;
  weightedDegree: number;
  betweenness: number;
  pagerank: number;
  community: number;
  shared: boolean;
}

export interface NetEdge {
  source: string;
  target: string;
  events: number;
  calls: number;
  sms: number;
  talkSec: number;
  weight: number;
  /** Calls/SMS made by source to target (caller or sender first). */
  ab: number;
  /** Calls/SMS made by target to source. */
  ba: number;
  firstTs: number;
  lastTs: number;
}

export interface Network {
  nodes: NetNode[];
  edges: NetEdge[];
  communities: number;
  modularity: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Communication network. Node = a number; edge = target <-> party (undirected),
 * weighted by the chosen measure. A party that is itself another loaded
 * target is merged into that target's node, giving a direct target link.
 * Betweenness is computed on the unweighted graph (weights here are tie
 * strengths, not distances); PageRank and Louvain use the weights.
 */
export function buildNetwork(datasets: Dataset[], settings: Settings, options: NetworkOptions = DEFAULT_NETWORK_OPTIONS): Network {
  const targetOf = new Map(datasets.map((d) => [d.target, d]));
  const kinds = new Map<string, PeerKind>();
  // Per dataset first: when two loaded targets talk to each other, both files
  // hold the same communications, so the edge takes the larger side rather
  // than the sum.
  const perDataset = new Map<string, Map<string, NetEdge>>();

  for (const ds of datasets) {
    for (const it of activeInteractions(ds, settings)) {
      if (!isComm(it) || !it.peer || it.peer === ds.target) continue;
      const isTargetPeer = targetOf.has(it.peer);
      if (!isTargetPeer && !settings.includeServiceNumbers && !isPersonKind(it.peerKind)) continue;
      kinds.set(it.peer, it.peerKind);
      const [a, b] = ds.target < it.peer ? [ds.target, it.peer] : [it.peer, ds.target];
      const key = `${a}\u0000${b}`;
      let byDs = perDataset.get(key);
      if (!byDs) perDataset.set(key, (byDs = new Map()));
      let e = byDs.get(ds.id);
      if (!e) {
        e = { source: a, target: b, events: 0, calls: 0, sms: 0, talkSec: 0, weight: 0, ab: 0, ba: 0, firstTs: it.ts, lastTs: it.ts };
        byDs.set(ds.id, e);
      }
      e.events++;
      if (it.service === 'call') {
        e.calls++;
        if (it.answered) e.talkSec += it.durationSec ?? 0;
      } else e.sms++;
      // Forwarded or undirected records count as contact but give no direction.
      const from = it.direction === 'out' ? ds.target : it.direction === 'in' ? it.peer : undefined;
      if (from === a) e.ab++;
      else if (from === b) e.ba++;
      if (it.ts < e.firstTs) e.firstTs = it.ts;
      if (it.ts > e.lastTs) e.lastTs = it.ts;
    }
  }
  const edges = new Map<string, NetEdge>();
  for (const [key, byDs] of perDataset) {
    const sides = [...byDs.values()];
    const e = { ...sides[0] };
    // Both files hold the same communications: A's outgoing calls to B are
    // B's incoming calls from A, so each direction takes the larger side.
    for (const s of sides.slice(1)) {
      e.events = Math.max(e.events, s.events);
      e.calls = Math.max(e.calls, s.calls);
      e.sms = Math.max(e.sms, s.sms);
      e.talkSec = Math.max(e.talkSec, s.talkSec);
      e.ab = Math.max(e.ab, s.ab);
      e.ba = Math.max(e.ba, s.ba);
      e.firstTs = Math.min(e.firstTs, s.firstTs);
      e.lastTs = Math.max(e.lastTs, s.lastTs);
    }
    e.events = Math.max(e.events, e.ab + e.ba);
    edges.set(key, e);
  }

  for (const e of edges.values()) {
    e.weight = options.weight === 'events' ? e.events : options.weight === 'calls' ? e.calls : Math.round(e.talkSec / 60);
  }
  let kept = [...edges.values()].filter((e) => e.weight >= options.minWeight && e.weight > 0);

  // Top-N strongest contacts per target (target-to-target links always stay).
  if (options.topN > 0) {
    const keep = new Set<NetEdge>();
    for (const ds of datasets) {
      const mine = kept.filter((e) => e.source === ds.target || e.target === ds.target);
      for (const e of mine) if (targetOf.has(e.source) && targetOf.has(e.target)) keep.add(e);
      mine
        .filter((e) => !(targetOf.has(e.source) && targetOf.has(e.target)))
        .sort((x, y) => y.weight - x.weight)
        .slice(0, options.topN)
        .forEach((e) => keep.add(e));
    }
    kept = kept.filter((e) => keep.has(e));
  }

  // Which targets each contact touches.
  const touch = new Map<string, Set<string>>();
  for (const e of kept) {
    for (const [x, y] of [
      [e.source, e.target],
      [e.target, e.source],
    ]) {
      const t = targetOf.get(y);
      if (!t) continue;
      if (!touch.has(x)) touch.set(x, new Set());
      touch.get(x)!.add(t.id);
    }
  }
  if (options.onlyShared) {
    kept = kept.filter((e) => {
      const contact = targetOf.has(e.source) ? e.target : e.source;
      return targetOf.has(contact) || (touch.get(contact)?.size ?? 0) >= 2;
    });
  }

  const g = new UndirectedGraph();
  for (const ds of datasets) if (!g.hasNode(ds.target)) g.addNode(ds.target);
  for (const e of kept) {
    if (!g.hasNode(e.source)) g.addNode(e.source);
    if (!g.hasNode(e.target)) g.addNode(e.target);
    g.addEdge(e.source, e.target, { weight: e.weight });
  }

  const btw = g.size > 0 ? betweennessCentrality(g, { normalized: true, getEdgeWeight: null }) : {};
  const pr = g.size > 0 ? pagerank(g, { getEdgeWeight: 'weight' }) : {};
  let communities: Record<string, number> = {};
  let count = 0;
  let modularity = 0;
  if (g.size > 0) {
    const res = louvain.detailed(g, { getEdgeWeight: 'weight', rng: mulberry32(42) });
    communities = res.communities;
    count = res.count;
    modularity = res.modularity;
  }

  const nodes: NetNode[] = g.mapNodes((id) => {
    const ds = targetOf.get(id);
    let wdeg = 0;
    g.forEachEdge(id, (_e, attr) => (wdeg += attr.weight as number));
    const linked = ds ? [ds.id, ...(touch.get(id) ?? [])] : [...(touch.get(id) ?? [])];
    return {
      id,
      isTarget: !!ds,
      datasetIds: [...new Set(linked)],
      slot: ds?.slot,
      label: ds ? (ds.label && ds.label !== ds.target ? ds.label : ds.target) : id,
      kind: ds ? 'target' : (kinds.get(id) ?? 'other'),
      degree: g.degree(id),
      weightedDegree: wdeg,
      betweenness: btw[id] ?? 0,
      pagerank: pr[id] ?? 0,
      community: communities[id] ?? 0,
      shared: !ds && (touch.get(id)?.size ?? 0) >= 2,
    };
  });
  nodes.sort((a, b) => Number(b.isTarget) - Number(a.isTarget) || b.weightedDegree - a.weightedDegree);
  return { nodes, edges: kept, communities: count, modularity };
}

/**
 * The part of a network around one number: the number, its direct neighbours
 * and the links among them. Node metrics keep their whole-network values.
 */
export function egoNetwork(net: Network, id: string): Network {
  const keep = new Set([id]);
  for (const e of net.edges) {
    if (e.source === id) keep.add(e.target);
    else if (e.target === id) keep.add(e.source);
  }
  return {
    ...net,
    nodes: net.nodes.filter((n) => keep.has(n.id)),
    edges: net.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  };
}
