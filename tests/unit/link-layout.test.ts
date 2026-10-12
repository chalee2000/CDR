import { describe, expect, it } from 'vitest';
import { buildDataset } from '../../src/lib/dataset';
import { parseWorkbook } from '../../src/lib/parsers';
import { generateSamples, SAMPLE_TARGETS } from '../../src/lib/samples/generate';
import { DEFAULT_SETTINGS } from '../../src/lib/types';
import { buildNetwork, DEFAULT_NETWORK_OPTIONS, type NetEdge, type NetNode, type Network } from '../../src/lib/analysis/network';
import { hubLayout, MIN_GAP, TARGET_GAP, type LinkLayout } from '../../src/lib/analysis/linkLayout';

const datasets = generateSamples().map((wb, i) => {
  const out = parseWorkbook(wb, 'local');
  if (out.kind !== 'ok') throw new Error('sample did not parse');
  return buildDataset(out.drafts[0], i);
});

function node(id: string, isTarget = false, slot?: number): NetNode {
  return { id, isTarget, slot, datasetIds: [], label: id, kind: isTarget ? 'target' : 'mobile', degree: 0, weightedDegree: 1, betweenness: 0, pagerank: 0, community: 0, shared: false };
}
function edge(source: string, target: string, weight: number): NetEdge {
  return { source, target, events: weight, calls: weight, sms: 0, talkSec: 0, weight, ab: weight, ba: 0, firstTs: 0, lastTs: 0 };
}

/** k targets, `per` own contacts each, `sharedPer` contacts shared by neighbouring targets. */
function synthetic(k: number, per: number, sharedPer = 0): Network {
  const nodes: NetNode[] = [];
  const edges: NetEdge[] = [];
  for (let t = 0; t < k; t++) {
    nodes.push(node(`T${t}`, true, t));
    for (let c = 0; c < per; c++) {
      nodes.push(node(`T${t}C${c}`));
      edges.push(edge(`T${t}`, `T${t}C${c}`, 1 + ((c * 7) % 23)));
    }
  }
  for (let t = 0; t < k && k > 1; t++) {
    for (let s = 0; s < sharedPer; s++) {
      const id = `S${t}-${s}`;
      nodes.push(node(id));
      edges.push(edge(`T${t}`, id, 3), edge(`T${(t + 1) % k}`, id, 2));
    }
  }
  return { nodes, edges, communities: 1, modularity: 0 };
}

function minDistances(net: Network, layout: LinkLayout) {
  const target = new Set(net.nodes.filter((n) => n.isTarget).map((n) => n.id));
  const ids = [...layout.pos.keys()];
  let contact = Infinity;
  let toTarget = Infinity;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = layout.pos.get(ids[i])!;
      const b = layout.pos.get(ids[j])!;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ti = target.has(ids[i]);
      const tj = target.has(ids[j]);
      if (ti && tj) continue;
      if (ti || tj) toTarget = Math.min(toTarget, d);
      else contact = Math.min(contact, d);
    }
  }
  return { contact, toTarget };
}

describe('hub layout', () => {
  const net = buildNetwork(datasets, DEFAULT_SETTINGS, DEFAULT_NETWORK_OPTIONS);

  it('places every node at a finite position, the same way every time', () => {
    const a = hubLayout(net);
    const b = hubLayout(net);
    expect(a.pos.size).toBe(net.nodes.length);
    for (const [id, p] of a.pos) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(b.pos.get(id)).toEqual(p);
    }
  });

  it('keeps nodes apart', () => {
    const d = minDistances(net, hubLayout(net));
    expect(d.contact).toBeGreaterThanOrEqual(0.9 * MIN_GAP);
    expect(d.toTarget).toBeGreaterThanOrEqual(0.9 * TARGET_GAP);
  });

  it('puts a shared contact between the targets it links', () => {
    const { pos } = hubLayout(net);
    const a = pos.get(SAMPLE_TARGETS.A)!;
    const b = pos.get(SAMPLE_TARGETS.B)!;
    const x1 = pos.get('0860000111')!;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const half = Math.hypot(a.x - b.x, a.y - b.y) / 2;
    expect(Math.hypot(x1.x - mid.x, x1.y - mid.y)).toBeLessThan(half);
  });

  it('copes with one target, no links, nine targets and hundreds of contacts', () => {
    const single = synthetic(1, 60);
    const one = hubLayout(single);
    expect(one.pos.get('T0')).toEqual({ x: 0, y: 0 });
    expect(minDistances(single, one).contact).toBeGreaterThanOrEqual(0.9 * MIN_GAP);

    const lonely = synthetic(1, 0);
    expect(hubLayout(lonely).pos.size).toBe(1);
    expect(hubLayout({ nodes: [], edges: [], communities: 0, modularity: 0 }).pos.size).toBe(0);

    const nine = synthetic(9, 12, 2);
    const d9 = minDistances(nine, hubLayout(nine));
    expect(d9.contact).toBeGreaterThanOrEqual(0.9 * MIN_GAP);
    expect(d9.toTarget).toBeGreaterThanOrEqual(0.9 * TARGET_GAP);

    const big = synthetic(3, 250, 10);
    const t0 = performance.now();
    const layout = hubLayout(big);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(layout.pos.size).toBe(big.nodes.length);
    expect(minDistances(big, layout).contact).toBeGreaterThanOrEqual(0.9 * MIN_GAP);
  });
});
