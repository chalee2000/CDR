import { describe, expect, it } from 'vitest';
import { buildDataset } from '../../src/lib/dataset';
import { parseWorkbook } from '../../src/lib/parsers';
import { generateSamples, SAMPLE_TARGETS } from '../../src/lib/samples/generate';
import { DEFAULT_SETTINGS } from '../../src/lib/types';
import { buildNetwork, DEFAULT_NETWORK_OPTIONS, type NetEdge, type NetNode, type Network } from '../../src/lib/analysis/network';
import { hierarchyLayout, hubLayout, layoutFor, MIN_GAP, organizationLayout, packedLayout, TARGET_GAP, type LinkLayout } from '../../src/lib/analysis/linkLayout';

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

const area = (l: LinkLayout) => (l.bounds.maxX - l.bounds.minX) * (l.bounds.maxY - l.bounds.minY);

/** Nearest target to a point along x only, or in the plane. */
function nearestTarget(net: Network, l: LinkLayout, id: string, xOnly = false) {
  const p = l.pos.get(id)!;
  let best = '';
  let bestD = Infinity;
  for (const n of net.nodes) {
    if (!n.isTarget) continue;
    const q = l.pos.get(n.id)!;
    const d = xOnly ? Math.abs(p.x - q.x) : Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bestD) [best, bestD] = [n.id, d];
  }
  return best;
}

describe('hub layout with many targets', () => {
  for (const [k, per, sharedPer] of [
    [4, 20, 3],
    [10, 40, 3],
  ] as const) {
    it(`${k} targets: an ellipse as wide as a chart box, shared contacts on rings inside, nothing touching`, () => {
      const n = synthetic(k, per, sharedPer);
      const l = hubLayout(n);
      expect(l.pos.size).toBe(n.nodes.length);
      expect(hubLayout(n).pos).toEqual(l.pos);
      const d = minDistances(n, l);
      expect(d.contact).toBeGreaterThanOrEqual(0.9 * MIN_GAP);
      expect(d.toTarget).toBeGreaterThanOrEqual(0.9 * TARGET_GAP);
      const hubs = n.nodes.filter((x) => x.isTarget).map((x) => l.pos.get(x.id)!);
      const a = Math.max(...hubs.map((p) => Math.abs(p.x)));
      const b = Math.max(...hubs.map((p) => Math.abs(p.y)));
      expect(a / b).toBeGreaterThan(1.3);
      for (const x of n.nodes) {
        if (!x.id.startsWith('S')) continue;
        const p = l.pos.get(x.id)!;
        expect((p.x / a) ** 2 + (p.y / b) ** 2).toBeLessThan(0.75);
      }
      const w = l.bounds.maxX - l.bounds.minX;
      const h = l.bounds.maxY - l.bounds.minY;
      expect(w / h).toBeGreaterThan(1.15);
      // Each target's label is set, away from its fan: the lowest target's label goes on top.
      for (const x of n.nodes) if (x.isTarget) expect(l.labelSide?.has(x.id)).toBe(true);
      // Shared contacts on a ring take turns: labels above and below.
      const sides = new Set(n.nodes.filter((x) => x.id.startsWith('S')).map((x) => l.labelSide?.get(x.id)));
      expect(sides).toEqual(new Set(['top', 'bottom']));
      const lowest = n.nodes.filter((x) => x.isTarget).sort((p, q) => l.pos.get(q.id)!.y - l.pos.get(p.id)!.y)[0];
      expect(l.labelSide!.get(lowest.id)).toBe('top');
    });
  }

  it('leaves one to three targets as they were (no label sides)', () => {
    expect(hubLayout(synthetic(3, 10, 2)).labelSide).toBeUndefined();
  });
});

describe('packed, hierarchy and organization layouts', () => {
  const net = buildNetwork(datasets, DEFAULT_SETTINGS, DEFAULT_NETWORK_OPTIONS);
  const layouts = { packed: packedLayout, hierarchy: hierarchyLayout, organization: organizationLayout };

  for (const [name, fn] of Object.entries(layouts)) {
    it(`${name}: every node placed, the same way every time, kept apart, at any size`, () => {
      for (const n of [net, synthetic(1, 60), synthetic(1, 0), synthetic(9, 12, 2), synthetic(3, 250, 10), { nodes: [], edges: [], communities: 0, modularity: 0 }]) {
        const a = fn(n);
        const b = fn(n);
        expect(a.pos.size).toBe(n.nodes.length);
        for (const [id, p] of a.pos) {
          expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
          expect(b.pos.get(id)).toEqual(p);
        }
        if (n.nodes.length > 1) {
          const d = minDistances(n, a);
          expect(d.contact).toBeGreaterThanOrEqual(0.9 * MIN_GAP);
          expect(d.toTarget).toBeGreaterThanOrEqual(0.9 * TARGET_GAP);
        }
      }
      expect(layoutFor(name as 'packed', net).pos).toEqual(fn(net).pos);
    });
  }

  it('hierarchy: targets on top, shared contacts below them, each own contact under its target', () => {
    const n9 = synthetic(9, 12, 2);
    const l = hierarchyLayout(n9);
    const ty = l.pos.get('T0')!.y;
    for (let t = 0; t < 9; t++) expect(l.pos.get(`T${t}`)!.y).toBe(ty);
    const sharedY = n9.nodes.filter((n) => n.id.startsWith('S')).map((n) => l.pos.get(n.id)!.y);
    const ownY = n9.nodes.filter((n) => /^T\dC/.test(n.id)).map((n) => l.pos.get(n.id)!.y);
    expect(Math.min(...sharedY)).toBeGreaterThan(ty);
    expect(Math.max(...sharedY)).toBeLessThan(Math.min(...ownY));
    for (const n of n9.nodes) if (/^T\dC/.test(n.id)) expect(nearestTarget(n9, l, n.id, true)).toBe(n.id.slice(0, 2));
  });

  it('organization: shared contacts above the targets, own contacts hanging below their target in branches at most five wide', () => {
    const n9 = synthetic(9, 12, 2);
    const l = organizationLayout(n9);
    const ty = l.pos.get('T0')!.y;
    for (const n of n9.nodes) {
      if (n.id.startsWith('S')) expect(l.pos.get(n.id)!.y).toBeLessThan(ty);
      if (/^T\dC/.test(n.id)) {
        expect(l.pos.get(n.id)!.y).toBeGreaterThan(ty);
        expect(nearestTarget(n9, l, n.id, true)).toBe(n.id.slice(0, 2));
      }
    }
    const t0 = n9.nodes.filter((n) => n.id.startsWith('T0C')).map((n) => l.pos.get(n.id)!.x);
    expect(Math.max(...t0) - Math.min(...t0)).toBeLessThanOrEqual(5 * 92);
  });

  it('packed: own contacts closest to their target, and tighter than peacock', () => {
    const n9 = synthetic(9, 12, 2);
    const l = packedLayout(n9);
    for (const n of n9.nodes) if (/^T\dC/.test(n.id)) expect(nearestTarget(n9, l, n.id)).toBe(n.id.slice(0, 2));
    expect(area(l)).toBeLessThan(area(hubLayout(n9)));
  });
});
