import { describe, expect, it } from 'vitest';
import { buildDataset } from '../../src/lib/dataset';
import { parseWorkbook } from '../../src/lib/parsers';
import { generateSamples, SAMPLE_TARGETS } from '../../src/lib/samples/generate';
import { DEFAULT_SETTINGS } from '../../src/lib/types';
import { buildNetwork, DEFAULT_NETWORK_OPTIONS, type NetEdge, type NetNode, type Network } from '../../src/lib/analysis/network';
import { hierarchyLayout, hubLayout, layoutFor, MIN_GAP, organizationLayout, packedLayout, TARGET_GAP, type LinkLayout, type Point } from '../../src/lib/analysis/linkLayout';

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

/**
 * k targets round a ring with contacts shared every which way: neighbours,
 * targets far apart, three or four at once (ladders, named G…), and
 * one-offs (named one:…).
 */
function shapedLikeARing(k: number, per = 6, times = 1): Network {
  const net = synthetic(k, per, 2);
  const add = (id: string, ts: number[]) => {
    net.nodes.push(node(id));
    ts.forEach((t, i) => net.edges.push(edge(`T${t % k}`, id, 2 + ((i * 5 + id.length) % 9))));
  };
  for (let r = 0; r < times; r++) {
    const tag = r ? `${r}` : '';
    for (const [name, ts, n] of [
      ['G0-2-4', [0, 2, 4], 3],
      ['G1-5', [1, 5], 2],
      ['G3-6-7-0', [3, 6, 7, 0], 2],
    ] as const) for (let s = 0; s < n; s++) add(`${name}${tag}:${s}`, [...ts].map((t) => t + r));
    add(`one:${r}a`, [0 + r, 3 + r]);
    add(`one:${r}b`, [2 + r, 5 + r, 6 + r]);
  }
  net.edges.push(edge('T0', 'T1', 9), edge('T2', 'T6', 4), edge('T1', 'T5', 3));
  return net;
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
      // The ellipse itself: the first target sits at its top, and it is 1.6 times as wide.
      const [A, B] = [1.6 * b, b];
      for (const x of n.nodes) {
        if (!x.id.startsWith('S')) continue;
        const p = l.pos.get(x.id)!;
        expect(Math.hypot(p.x / A, p.y / B)).toBeLessThan(0.97);
      }
      const w = l.bounds.maxX - l.bounds.minX;
      const h = l.bounds.maxY - l.bounds.minY;
      expect(w / h).toBeGreaterThan(1.15);
      // Each target's label is set, away from its fan: the lowest target's label goes on top.
      for (const x of n.nodes) if (x.isTarget) expect(l.labelSide?.has(x.id)).toBe(true);
      // These contacts are shared by neighbours: they bridge the gap between
      // them in a block just inside the ellipse (labels under each), or, if
      // a block is full, take an inner ring (labels taking turns above and below).
      for (const x of n.nodes) if (x.id.startsWith('S')) expect(['bottom', 'top']).toContain(l.labelSide?.get(x.id));
      expect(l.straightTargetLinks).toBe(true);
      const lowest = n.nodes.filter((x) => x.isTarget).sort((p, q) => l.pos.get(q.id)!.y - l.pos.get(p.id)!.y)[0];
      expect(l.labelSide!.get(lowest.id)).toBe('top');
    });
  }

  it('leaves one to three targets as they were (no label sides, curved links between targets)', () => {
    expect(hubLayout(synthetic(3, 10, 2)).labelSide).toBeUndefined();
    expect(hubLayout(synthetic(3, 10, 2)).straightTargetLinks).toBeUndefined();
  });

  it('puts targets that share the most contacts side by side round the ellipse', () => {
    const nodes: NetNode[] = [];
    const edges: NetEdge[] = [];
    for (let t = 0; t < 6; t++) {
      nodes.push(node(`T${t}`, true, t));
      for (let c = 0; c < 4; c++) {
        nodes.push(node(`T${t}C${c}`));
        edges.push(edge(`T${t}`, `T${t}C${c}`, 5));
      }
    }
    for (const [a, b] of [
      [0, 3],
      [1, 4],
      [2, 5],
    ]) {
      for (let s = 0; s < 6; s++) {
        nodes.push(node(`S${a}${b}-${s}`));
        edges.push(edge(`T${a}`, `S${a}${b}-${s}`, 4), edge(`T${b}`, `S${a}${b}-${s}`, 3));
      }
    }
    const net: Network = { nodes, edges, communities: 1, modularity: 0 };
    const l = hubLayout(net);
    const round = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5'].sort((p, q) => Math.atan2(l.pos.get(p)!.y, l.pos.get(p)!.x) - Math.atan2(l.pos.get(q)!.y, l.pos.get(q)!.x));
    for (const [a, b] of [
      ['T0', 'T3'],
      ['T1', 'T4'],
      ['T2', 'T5'],
    ]) {
      const d = Math.abs(round.indexOf(a) - round.indexOf(b));
      expect(Math.min(d, 6 - d)).toBe(1);
    }
  });

  it('bridges two neighbours with their shared contacts, just inside the ellipse between them', () => {
    const n = synthetic(6, 5, 3);
    n.edges.push(edge('T0', 'T1', 9), edge('T3', 'T2', 4), edge('T0', 'T3', 2));
    const l = hubLayout(n);
    // Neighbours' own links bow out round the rim; the one across the chart is straight.
    for (const [s0, t0] of [
      ['T0', 'T1'],
      ['T3', 'T2'],
    ]) {
      const c = l.targetCurves!.get(`${s0}\u0000${t0}`)!;
      const [p, q] = [l.pos.get(s0)!, l.pos.get(t0)!];
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const ctrl = { x: mid.x + c * (q.y - p.y), y: mid.y + c * (p.x - q.x) };
      expect(Math.hypot(ctrl.x, ctrl.y)).toBeGreaterThan(Math.hypot(mid.x, mid.y));
    }
    expect(l.targetCurves!.has('T0\u0000T3')).toBe(false);
    const hubs = n.nodes.filter((x) => x.isTarget).map((x) => l.pos.get(x.id)!);
    const b = Math.max(...hubs.map((p) => Math.abs(p.y)));
    const a = 1.6 * b;
    const d = minDistances(n, l);
    expect(d.contact).toBeGreaterThanOrEqual(0.9 * MIN_GAP);
    expect(d.toTarget).toBeGreaterThanOrEqual(0.9 * TARGET_GAP);
    // Every pair of neighbours gets a ladder: its shared contacts in one
    // straight column between the two, just inside the ellipse (what does
    // not fit goes inside, on a ladder of its own or alone).
    for (let first = 0; first < 6; first++) {
      const bd = l.bundles!.find((x) => x.members.includes(`S${first}-0`))!;
      expect(new Set(bd.targets)).toEqual(new Set([`T${first}`, `T${(first + 1) % 6}`]));
      const [p, q] = [l.pos.get(`T${first}`)!, l.pos.get(`T${(first + 1) % 6}`)!];
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const spots = bd.members.map((id) => l.pos.get(id)!);
      for (const [i, id] of bd.members.entries()) {
        expect(id.startsWith(`S${first}-`)).toBe(true);
        const c = spots[i];
        expect(c.x).toBeCloseTo(spots[0].x, 6);
        if (i) expect(Math.abs(c.y - spots[i - 1].y)).toBeGreaterThanOrEqual(1.3 * MIN_GAP);
        // Inside the line between the two, and between them along it.
        const len = Math.hypot(q.x - p.x, q.y - p.y);
        const along = ((c.x - p.x) * (q.x - p.x) + (c.y - p.y) * (q.y - p.y)) / len;
        expect(along).toBeGreaterThan(0);
        expect(along).toBeLessThan(len);
        const side = (v: Point) => (q.x - p.x) * (v.y - p.y) - (q.y - p.y) * (v.x - p.x);
        expect(Math.sign(side(c))).toBe(Math.sign(side({ x: 0, y: 0 })));
        expect(Math.abs(side(c)) / len).toBeGreaterThan(0.5 * MIN_GAP);
        const r = Math.hypot(c.x / a, c.y / b);
        expect(r).toBeLessThan(0.97);
        expect(Math.hypot(c.x - mid.x, c.y - mid.y)).toBeLessThan(Math.hypot(mid.x, mid.y));
        // Well clear of every other target.
        for (const other of n.nodes) {
          if (!other.isTarget || bd.targets.includes(other.id)) continue;
          const o = l.pos.get(other.id)!;
          expect(Math.hypot(o.x - c.x, o.y - c.y)).toBeGreaterThan(2 * TARGET_GAP);
        }
      }
    }
    for (const x of n.nodes) if (x.id.startsWith('S')) expect(l.labelSide!.get(x.id)).toBe('bottom');
  });

  it('keeps ladders apart, clear of the fans and of the targets\' labels', () => {
    for (const net of [synthetic(10, 40, 3), synthetic(8, 20, 6), synthetic(5, 0, 8)]) {
      const l = hubLayout(net);
      expect(l.bundles?.length).toBeGreaterThan(0);
      const boxes = l.bundles!.map((bd) => {
        const pts = bd.members.map((id) => l.pos.get(id)!);
        return { x0: Math.min(...pts.map((p) => p.x)) - 90, x1: Math.max(...pts.map((p) => p.x)) + 90, y0: Math.min(...pts.map((p) => p.y)) - 30, y1: Math.max(...pts.map((p) => p.y)) + 30, bd };
      });
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const [p, q] = [boxes[i], boxes[j]];
          expect(p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1).toBe(false);
        }
        // No fan contact inside a ladder's box.
        for (const x of net.nodes) {
          if (!/^T\d+C/.test(x.id)) continue;
          const c = l.pos.get(x.id)!;
          const bx = boxes[i];
          expect(c.x > bx.x0 && c.x < bx.x1 && c.y > bx.y0 && c.y < bx.y1).toBe(false);
        }
        // Nor a target's label beside it (labels left or right run about three gaps long).
        for (const x of net.nodes) {
          if (!x.isTarget) continue;
          const t = l.pos.get(x.id)!;
          const side = l.labelSide!.get(x.id);
          if (side !== 'left' && side !== 'right') continue;
          const lx0 = side === 'left' ? t.x - 3 * MIN_GAP : t.x;
          const lx1 = side === 'left' ? t.x : t.x + 3 * MIN_GAP;
          const bx = boxes[i];
          expect(lx0 < bx.x1 && bx.x0 < lx1 && t.y - 20 < bx.y1 && bx.y0 < t.y + 20).toBe(false);
        }
      }
      expect(hubLayout(net)).toEqual(l);
    }
    expect(hubLayout(synthetic(3, 10, 2)).bundles).toBeUndefined();
  });

  it('makes room for a ring road round the outside only when the targets have no fans', () => {
    const shared = synthetic(6, 0, 3);
    shared.edges.push(edge('T0', 'T3', 5), edge('T1', 'T4', 2));
    const l = hubLayout(shared);
    expect(l.road).toBeDefined();
    expect(l.bounds.maxX).toBeGreaterThan(l.road!.a + l.road!.gap);
    expect(l.bounds.minY).toBeLessThan(-(l.road!.b + l.road!.gap));
    const fans = synthetic(6, 4, 3);
    fans.edges.push(edge('T0', 'T3', 5));
    expect(hubLayout(fans).road).toBeUndefined();
    // Neighbours calling each other need no road.
    const near = synthetic(6, 0, 3);
    near.edges.push(edge('T0', 'T1', 5));
    expect(hubLayout(near).road).toBeUndefined();
  });

  it('puts contacts whose targets are much alike on one ladder, up to four targets', () => {
    const net = synthetic(8, 4, 3);
    const add = (id: string, ts: number[]) => {
      net.nodes.push(node(id));
      ts.forEach((t, i) => net.edges.push(edge(`T${t}`, id, 3 + i)));
    };
    add('P15:0', [1, 5]);
    add('P15:1', [1, 5]);
    add('P153:0', [1, 5, 3]);
    add('Q04:0', [0, 4]);
    add('Q04:1', [0, 4]);
    add('Q06:0', [0, 6]);
    add('Q06:1', [0, 6]);
    const l = hubLayout(net);
    const bundleOf = (id: string) => l.bundles!.find((bd) => bd.members.includes(id))!;
    // A–B and A–B–C share a ladder (the contact of three first), with all three targets.
    expect(bundleOf('P15:0')).toBe(bundleOf('P153:0'));
    expect(new Set(bundleOf('P15:0').targets)).toEqual(new Set(['T1', 'T3', 'T5']));
    expect(bundleOf('P15:0').members[0]).toBe('P153:0');
    // A–B and A–C do not.
    expect(bundleOf('Q04:0')).not.toBe(bundleOf('Q06:0'));
    for (const bd of l.bundles!) expect(bd.targets.length).toBeLessThanOrEqual(4);
    expect(minDistances(net, l).contact).toBeGreaterThanOrEqual(0.9 * MIN_GAP);
  });

  it('puts contacts shared by targets that are not neighbours, or by three or more, on ladders inside', () => {
    const net = shapedLikeARing(8);
    const l = hubLayout(net);
    expect(l.pos.size).toBe(net.nodes.length);
    expect(hubLayout(net)).toEqual(l);
    const d = minDistances(net, l);
    expect(d.contact).toBeGreaterThanOrEqual(0.9 * MIN_GAP);
    expect(d.toTarget).toBeGreaterThanOrEqual(0.9 * TARGET_GAP);
    const hubs = net.nodes.filter((x) => x.isTarget).map((x) => l.pos.get(x.id)!);
    const b = Math.max(...hubs.map((p) => Math.abs(p.y)));
    const linked = new Map<string, Set<string>>();
    for (const e of net.edges) if (e.source.startsWith('T') && !e.target.startsWith('T')) linked.set(e.target, new Set([...(linked.get(e.target) ?? []), e.source]));
    for (const group of ['G0-2-4', 'G1-5', 'G3-6-7-0']) {
      const members = net.nodes.filter((x) => x.id.startsWith(`${group}:`)).map((x) => x.id);
      const bd = l.bundles!.find((x) => x.members.includes(members[0]))!;
      // One ladder for the group, its targets those the contacts share.
      expect(new Set(bd.members)).toEqual(new Set(members));
      expect(new Set(bd.targets)).toEqual(linked.get(members[0]));
      const spots = bd.members.map((id) => l.pos.get(id)!);
      for (const [i, c] of spots.entries()) {
        expect(c.x).toBeCloseTo(spots[0].x, 6);
        if (i) expect(Math.abs(c.y - spots[i - 1].y)).toBeGreaterThanOrEqual(1.3 * MIN_GAP);
        expect(Math.hypot(c.x / (1.6 * b), c.y / b)).toBeLessThan(0.92);
      }
    }
    // Ladders keep apart (their spines stand a gap and a half either side).
    const boxes = l.bundles!.map((bd) => {
      const pts = bd.members.map((id) => l.pos.get(id)!);
      return { x0: pts[0].x - 1.4 * MIN_GAP, x1: pts[0].x + 1.4 * MIN_GAP, y0: Math.min(...pts.map((p) => p.y)) - 30, y1: Math.max(...pts.map((p) => p.y)) + 30 };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [p, q] = [boxes[i], boxes[j]];
        expect(p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1).toBe(false);
      }
    }
    // A one-off contact never joins a ladder with others (it may bridge two neighbours on its own).
    for (const x of net.nodes) if (x.id.startsWith('one:')) for (const bd of l.bundles!) if (bd.members.includes(x.id)) expect(bd.members).toEqual([x.id]);

    const big = shapedLikeARing(10, 40, 4);
    const t0 = performance.now();
    const lb = hubLayout(big);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(lb.pos.size).toBe(big.nodes.length);
    expect(minDistances(big, lb).contact).toBeGreaterThanOrEqual(0.9 * MIN_GAP);
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

  it('organization: shared contacts above the targets, own contacts listed down a spine under their target', () => {
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

  it('packed: discs in a table, with targets that share contacts next to each other', () => {
    const n9 = synthetic(9, 12, 2);
    const l = packedLayout(n9);
    const ts = n9.nodes.filter((n) => n.isTarget).map((n) => l.pos.get(n.id)!);
    const xs = [...new Set(ts.map((p) => Math.round(p.x)))].sort((a, b) => a - b);
    const ys = [...new Set(ts.map((p) => Math.round(p.y)))].sort((a, b) => a - b);
    expect(xs.length).toBeLessThan(9);
    expect(ys.length).toBeLessThan(9);
    expect(xs.length * ys.length).toBeGreaterThanOrEqual(9);
    // Neighbours around the ring of shared contacts sit in neighbouring cells.
    const cell = (id: string) => [xs.indexOf(Math.round(l.pos.get(id)!.x)), ys.indexOf(Math.round(l.pos.get(id)!.y))];
    let close = 0;
    for (let t = 0; t < 9; t++) {
      const [a, b] = [cell(`T${t}`), cell(`T${(t + 1) % 9}`)];
      if (Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) <= 1) close++;
    }
    expect(close).toBeGreaterThanOrEqual(8);
  });

  it('packed: a shared contact lives with the target it talks to most, on the side its other target\'s lines come in from', () => {
    const n9 = synthetic(9, 12, 2);
    const l = packedLayout(n9);
    const rowsY = [...new Set(n9.nodes.filter((n) => n.isTarget).map((n) => Math.round(l.pos.get(n.id)!.y)))].sort((a, b) => a - b);
    for (const n of n9.nodes) {
      if (!n.id.startsWith('S')) continue;
      const t = Number(n.id.slice(1, n.id.indexOf('-')));
      const home = `T${t}`;
      const other = `T${(t + 1) % 9}`;
      expect(nearestTarget(n9, l, n.id)).toBe(home);
      const [p, h, o] = [l.pos.get(n.id)!, l.pos.get(home)!, l.pos.get(other)!];
      // Lines from another row come in from that side; from the same row, round the outside of the table.
      const facing = Math.round(o.y) !== Math.round(h.y) ? Math.sign(o.y - h.y) : Math.round(h.y) === rowsY[rowsY.length - 1] && rowsY.length > 1 ? 1 : -1;
      expect(Math.sign(p.y - h.y)).toBe(facing);
    }
  });

  it('packed: streets between the discs, wide enough for their lanes, room under each target for its name, labels pointing out', () => {
    const net = synthetic(4, 20);
    net.edges.push(edge('T0', 'T1', 9), edge('T2', 'T3', 4));
    const l = packedLayout(net);
    expect(l.streets).toBeDefined();
    const g = l.streets!;
    // Streets lie between the rows and columns of discs, and outside them.
    for (let i = 0; i + 1 < g.rows.length; i++) expect(g.hStreets[i + 1] > g.rows[i] && g.hStreets[i + 1] < g.rows[i + 1]).toBe(true);
    expect(g.hStreets[0]).toBeLessThan(g.rows[0]);
    expect(g.hStreets[g.hStreets.length - 1]).toBeGreaterThan(g.rows[g.rows.length - 1]);
    const partner: Record<string, string> = { T0: 'T1', T1: 'T0', T2: 'T3', T3: 'T2' };
    const rowsY = [...new Set(['T0', 'T1', 'T2', 'T3'].map((t) => Math.round(l.pos.get(t)!.y)))].sort((a, b) => a - b);
    for (const n of net.nodes) {
      if (n.isTarget) continue;
      const t = n.id.slice(0, 2);
      const home = l.pos.get(t)!;
      const o = l.pos.get(partner[t])!;
      const p = l.pos.get(n.id)!;
      const d = Math.hypot(p.x - home.x, p.y - home.y);
      const cx = (p.x - home.x) / d;
      const cy = (p.y - home.y) / d;
      // Nothing on the first ring where the target's name goes (under it, or over it when its lines come from below), nor in the way of its line to its partner.
      const name = l.labelSide?.get(t) === 'top' ? -Math.PI / 2 : Math.PI / 2;
      if (d < 100 + MIN_GAP / 2) expect(Math.abs(Math.atan2(cy, cx) - name)).toBeGreaterThanOrEqual(Math.PI / 4.5 - 1e-9);
      const facing = Math.round(o.y) !== Math.round(home.y) ? Math.sign(o.y - home.y) : Math.round(home.y) === rowsY[rowsY.length - 1] && rowsY.length > 1 ? 1 : -1;
      if (Math.sign(p.y - home.y) === facing) expect(Math.abs(p.x - home.x)).toBeGreaterThan(0.3 * MIN_GAP);
      expect(l.labelSide?.get(n.id)).toBe(cx > 0.25 ? 'right' : cx < -0.25 ? 'left' : cy > 0 ? 'bottom' : 'top');
    }
    // The table is drawn whole, its outer streets too.
    expect(l.bounds.minY).toBeLessThan(g.hStreets[0]);
    expect(l.bounds.maxY).toBeGreaterThan(g.hStreets[g.hStreets.length - 1]);
  });

  it('packed: own contacts closest to their target, and tighter than peacock', () => {
    const n9 = synthetic(9, 12, 2);
    const l = packedLayout(n9);
    for (const n of n9.nodes) if (/^T\dC/.test(n.id)) expect(nearestTarget(n9, l, n.id)).toBe(n.id.slice(0, 2));
    expect(area(l)).toBeLessThan(area(hubLayout(n9)));
  });
});
