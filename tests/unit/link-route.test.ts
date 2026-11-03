import { describe, expect, it } from 'vitest';
import { buildDataset } from '../../src/lib/dataset';
import { parseWorkbook } from '../../src/lib/parsers';
import { generateSamples } from '../../src/lib/samples/generate';
import { DEFAULT_SETTINGS } from '../../src/lib/types';
import { buildNetwork, DEFAULT_NETWORK_OPTIONS, type NetEdge, type NetNode, type Network } from '../../src/lib/analysis/network';
import { hierarchyLayout, hubLayout, organizationLayout, pairKey, type Point } from '../../src/lib/analysis/linkLayout';
import { DROP_STEP, routeBundles, routeOrg, routeTree, type Routes } from '../../src/lib/analysis/linkRoute';

const COL_W = 92;

function node(id: string, isTarget = false, slot?: number): NetNode {
  return { id, isTarget, slot, datasetIds: [], label: id, kind: isTarget ? 'target' : 'mobile', degree: 0, weightedDegree: 1, betweenness: 0, pagerank: 0, community: 0, shared: false };
}
function edge(source: string, target: string, weight: number, ba = 0): NetEdge {
  return { source, target, events: weight, calls: weight, sms: 0, talkSec: 0, weight, ab: weight, ba, firstTs: 0, lastTs: 0 };
}

/** k targets, `per` own contacts each, `sharedPer` contacts shared by neighbouring targets. */
function synthetic(k: number, per: number, sharedPer = 0): Network {
  const nodes: NetNode[] = [];
  const edges: NetEdge[] = [];
  for (let t = 0; t < k; t++) {
    nodes.push(node(`T${t}`, true, t));
    for (let c = 0; c < per; c++) {
      nodes.push(node(`T${t}C${c}`));
      edges.push(edge(`T${t}`, `T${t}C${c}`, 1 + ((c * 7) % 23), c % 3));
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

const sample = buildNetwork(
  generateSamples().map((wb, i) => {
    const out = parseWorkbook(wb, 'local');
    if (out.kind !== 'ok') throw new Error('sample did not parse');
    return buildDataset(out.drafts[0], i);
  }),
  DEFAULT_SETTINGS,
  DEFAULT_NETWORK_OPTIONS,
);

const withTT = (() => {
  const n = synthetic(3, 5, 1);
  n.edges.push(edge('T0', 'T1', 9, 4), edge('T0', 'T2', 3));
  return n;
})();

const cases: [string, Network][] = [
  ['sample', sample],
  ['one target, 14', synthetic(1, 14)],
  ['one target, 60', synthetic(1, 60)],
  ['nine targets', synthetic(9, 12, 2)],
  ['three big targets', synthetic(3, 250, 10)],
  ['links between targets', withTT],
];

function where(routes: Routes, pos: Map<string, Point>, id: string): Point {
  return routes.bends.get(id) ?? pos.get(id)!;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

describe('hierarchy: right-angled links', () => {
  for (const [name, net] of cases) {
    it(`${name}: square corners, every link joined up, no line through another number`, () => {
      const layout = hierarchyLayout(net);
      const { pos } = layout;
      const routes = routeTree(net, pos);
      const real = new Set(net.nodes.map((n) => n.id));
      const targets = new Set(net.nodes.filter((n) => n.isTarget).map((n) => n.id));

      const bad: string[] = [];
      let nearest = Infinity;
      for (const p of routes.pieces) {
        const a = where(routes, pos, p.source);
        const b = where(routes, pos, p.target);
        if (!real.has(p.source) && !real.has(p.target)) {
          if (Math.min(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) >= 0.2) bad.push(`slanted ${p.source} ${p.target}`);
        }
        // Into a number: (nearly) straight down or up.
        else if (Math.abs(a.x - b.x) > 0.5 * Math.abs(a.y - b.y) + 0.2) bad.push(`not steep ${p.source} ${p.target}`);
        for (const n of net.nodes) if (n.id !== p.source && n.id !== p.target) nearest = Math.min(nearest, distToSegment(pos.get(n.id)!, a, b));
      }
      expect(bad).toEqual([]);
      expect(nearest).toBeGreaterThanOrEqual(18);

      // Every link can be followed from one end to the other along its own pieces.
      const byKey = new Map<string, typeof routes.pieces>();
      for (const p of routes.pieces) {
        for (const k of p.edges) {
          if (!byKey.has(k)) byKey.set(k, []);
          byKey.get(k)!.push(p);
        }
      }
      for (const e of net.edges) {
        const key = pairKey(e.source, e.target);
        const adj = new Map<string, string[]>();
        for (const p of byKey.get(key) ?? []) {
          for (const [u, v] of [
            [p.source, p.target],
            [p.target, p.source],
          ]) {
            if (!adj.has(u)) adj.set(u, []);
            adj.get(u)!.push(v);
          }
        }
        const seen = new Set([e.source]);
        const queue = [e.source];
        while (queue.length) for (const v of adj.get(queue.shift()!) ?? []) if (!seen.has(v)) seen.add(v), queue.push(v);
        expect(seen.has(e.target)).toBe(true);
        // One piece of each link carries its count.
        expect((byKey.get(key) ?? []).filter((p) => p.edges.length === 1 && p.label)).toHaveLength(1);
      }

      // Trunks and buses are drawn once: no two pieces on the same stretch.
      const seenPiece = new Set<string>();
      for (const p of routes.pieces) {
        const k = [p.source, p.target].sort().join('|');
        expect(seenPiece.has(k)).toBe(false);
        seenPiece.add(k);
      }
      for (const t of targets) expect(layout.labelSide?.get(t)).toBe('right');
      expect(routeTree(net, pos)).toEqual(routes);
    });
  }

  it('keeps a small chart in one row, the middle free for the trunk', () => {
    const net = synthetic(1, 14);
    const { pos } = hierarchyLayout(net);
    const t = pos.get('T0')!;
    const ys = new Set(net.nodes.filter((n) => !n.isTarget).map((n) => pos.get(n.id)!.y));
    expect(ys.size).toBe(1);
    expect([...ys][0]).toBeGreaterThan(t.y);
    for (const n of net.nodes) if (!n.isTarget) expect(Math.abs(pos.get(n.id)!.x - t.x)).toBeGreaterThanOrEqual(COL_W / 2 - 0.01);
  });

  it('wraps a big one into rows, every row but the last clear of the trunk', () => {
    const net = synthetic(1, 60);
    const { pos } = hierarchyLayout(net);
    const t = pos.get('T0')!;
    const ys = [...new Set(net.nodes.filter((n) => !n.isTarget).map((n) => pos.get(n.id)!.y))].sort((a, b) => a - b);
    expect(ys.length).toBeGreaterThan(1);
    for (const n of net.nodes) {
      const p = pos.get(n.id)!;
      if (!n.isTarget && p.y < ys[ys.length - 1]) expect(Math.abs(p.x - t.x)).toBeGreaterThanOrEqual(COL_W / 2 - 0.01);
    }
  });

  it('brings the lines of different targets into a shared contact side by side, on lanes of their own', () => {
    const net = synthetic(9, 12, 2);
    const { pos } = hierarchyLayout(net);
    const routes = routeTree(net, pos);
    for (const n of net.nodes) {
      if (!n.id.startsWith('S')) continue;
      const xs = routes.pieces.filter((p) => p.target === n.id).map((p) => where(routes, pos, p.source).x);
      expect(xs).toHaveLength(2);
      expect(Math.abs(xs[0] - xs[1])).toBeCloseTo(DROP_STEP, 5);
    }
    // Buses of different targets never run along the same stretch.
    const flat = routes.pieces
      .filter((p) => p.kind === 'bus')
      .map((p) => ({ owner: p.owner, a: where(routes, pos, p.source), b: where(routes, pos, p.target) }))
      .filter((s) => Math.abs(s.a.y - s.b.y) < 0.2 && Math.abs(s.a.x - s.b.x) > 0.2);
    for (let i = 0; i < flat.length; i++) {
      for (let j = i + 1; j < flat.length; j++) {
        const [p, q] = [flat[i], flat[j]];
        if (p.owner === q.owner || Math.abs(p.a.y - q.a.y) > 0.2) continue;
        const overlap = Math.min(Math.max(p.a.x, p.b.x), Math.max(q.a.x, q.b.x)) - Math.max(Math.min(p.a.x, p.b.x), Math.min(q.a.x, q.b.x));
        expect(overlap).toBeLessThan(0.2);
      }
    }
  });

  it('takes links between targets over the top, with their arrows at the ends', () => {
    const { pos } = hierarchyLayout(withTT);
    const routes = routeTree(withTT, pos);
    const key = pairKey('T0', 'T1');
    const mine = routes.pieces.filter((p) => p.edges.includes(key));
    expect(mine).toHaveLength(3);
    const across = mine.find((p) => p.label)!;
    expect(where(routes, pos, across.source).y).toBeLessThan(pos.get('T0')!.y);
    // T0 called T1 and T1 called T0: an arrow into each.
    expect(mine.find((p) => p.source === 'T0')!.arrows).toEqual([true, false]);
    expect(mine.find((p) => p.target === 'T1')!.arrows).toEqual([false, true]);
  });

  it('follows numbers moved by hand, still at right angles', () => {
    const net = synthetic(2, 6, 1);
    const { pos } = hierarchyLayout(net);
    const moved = new Map(pos);
    moved.set('T0C0', { x: pos.get('T0C0')!.x + 130, y: pos.get('T0C0')!.y + 77 });
    moved.set('T1C2', { x: pos.get('T1C2')!.x - 40, y: pos.get('T1')!.y - 150 });
    const routes = routeTree(net, moved);
    for (const p of routes.pieces) {
      const a = where(routes, moved, p.source);
      const b = where(routes, moved, p.target);
      if (routes.bends.has(p.source) && routes.bends.has(p.target)) expect(Math.min(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeLessThan(0.2);
    }
    // The contact moved above its target is reached by a line going up.
    const drop = routes.pieces.find((p) => p.target === 'T1C2')!;
    expect(where(routes, moved, drop.source).y).toBeGreaterThan(moved.get('T1C2')!.y);
  });
});

describe('organization: an org chart with right-angled links', () => {
  for (const [name, net] of cases) {
    it(`${name}: square corners, every link joined up, no line through another number`, () => {
      const layout = organizationLayout(net);
      const { pos } = layout;
      const routes = routeOrg(net, pos, layout.combs ?? new Map());
      const real = new Set(net.nodes.map((n) => n.id));
      const bad: string[] = [];
      let nearest = Infinity;
      for (const p of routes.pieces) {
        const a = where(routes, pos, p.source);
        const b = where(routes, pos, p.target);
        const [dx, dy] = [Math.abs(a.x - b.x), Math.abs(a.y - b.y)];
        if (!real.has(p.source) && !real.has(p.target)) {
          if (Math.min(dx, dy) >= 0.2) bad.push(`slanted ${p.source} ${p.target}`);
        }
        // Into a number: level (a stub off a spine) or (nearly) straight down or up.
        else if (Math.min(dx, dy) > 0.5 * Math.max(dx, dy) + 0.2) bad.push(`slanted into ${p.source} ${p.target}`);
        for (const n of net.nodes) if (n.id !== p.source && n.id !== p.target) nearest = Math.min(nearest, distToSegment(pos.get(n.id)!, a, b));
      }
      expect(bad).toEqual([]);
      expect(nearest).toBeGreaterThanOrEqual(18);

      const byKey = new Map<string, typeof routes.pieces>();
      for (const p of routes.pieces) for (const k of p.edges) byKey.set(k, [...(byKey.get(k) ?? []), p]);
      for (const e of net.edges) {
        const key = pairKey(e.source, e.target);
        const adj = new Map<string, string[]>();
        for (const p of byKey.get(key) ?? []) {
          adj.set(p.source, [...(adj.get(p.source) ?? []), p.target]);
          adj.set(p.target, [...(adj.get(p.target) ?? []), p.source]);
        }
        const seen = new Set([e.source]);
        const queue = [e.source];
        while (queue.length) for (const v of adj.get(queue.shift()!) ?? []) if (!seen.has(v)) seen.add(v), queue.push(v);
        expect(seen.has(e.target)).toBe(true);
        expect((byKey.get(key) ?? []).filter((p) => p.edges.length === 1 && p.label)).toHaveLength(1);
      }
      const seenPiece = new Set<string>();
      for (const p of routes.pieces) {
        const k = [p.source, p.target].sort().join('|');
        expect(seenPiece.has(k)).toBe(false);
        seenPiece.add(k);
      }
      expect(routeOrg(net, pos, layout.combs ?? new Map())).toEqual(routes);
    });
  }

  it("hangs a target's own contacts left and right of its spine, on level stubs, labels facing out", () => {
    const net = synthetic(2, 9);
    const layout = organizationLayout(net);
    const routes = routeOrg(net, layout.pos, layout.combs!);
    for (const t of ['T0', 'T1']) {
      const T = layout.pos.get(t)!;
      const mine = net.nodes.filter((n) => n.id.startsWith(`${t}C`));
      for (const n of mine) {
        const p = layout.pos.get(n.id)!;
        expect(p.y).toBeGreaterThan(T.y);
        expect(layout.labelSide?.get(n.id)).toBe(p.x < T.x ? 'left' : 'right');
        const stub = routes.pieces.find((q) => q.target === n.id)!;
        expect(where(routes, layout.pos, stub.source).y).toBeCloseTo(p.y, 5);
        expect(where(routes, layout.pos, stub.source).x).toBeCloseTo(T.x, 5);
      }
      // The strongest at the top, two to a row.
      const ys = mine.map((n) => layout.pos.get(n.id)!.y);
      expect(new Set(ys).size).toBe(Math.ceil(mine.length / 2));
    }
  });

  it('splits a long list over several spines joined by a bar', () => {
    const net = synthetic(1, 120);
    const layout = organizationLayout(net);
    const comb = layout.combs!.get('T0')!;
    expect(comb.spines.length).toBeGreaterThan(1);
    const routes = routeOrg(net, layout.pos, layout.combs!);
    const bar = routes.pieces.filter((p) => p.kind === 'bus' && Math.abs(where(routes, layout.pos, p.source).y - where(routes, layout.pos, p.target).y) < 0.2);
    expect(bar.length).toBeGreaterThan(0);
  });
});

describe('peacock: shared contacts of neighbouring targets on ladders', () => {
  const six = (() => {
    const n = synthetic(6, 5, 3);
    n.edges.push(edge('T0', 'T1', 9, 4), edge('T3', 'T2', 4), edge('T0', 'T3', 2));
    return n;
  })();
  for (const [name, net] of [
    ['six targets', six],
    ['ten targets', synthetic(10, 40, 3)],
    ['shared contacts only', synthetic(5, 0, 8)],
  ] as const) {
    it(`${name}: level stubs off upright spines, every link joined up, counts on the stubs`, () => {
      const layout = hubLayout(net);
      const { pos } = layout;
      const routes = routeBundles(net, pos, layout.bundles!, layout.targetCurves);
      const real = new Set(net.nodes.map((n) => n.id));
      const bad: string[] = [];
      let nearest = Infinity;
      for (const p of routes.pieces) {
        const a = where(routes, pos, p.source);
        const b = where(routes, pos, p.target);
        const [dx, dy] = [Math.abs(a.x - b.x), Math.abs(a.y - b.y)];
        if (!real.has(p.source) && !real.has(p.target)) {
          if (dx >= 0.2) bad.push(`spine not upright ${p.source} ${p.target}`);
        } else if (!real.has(p.source) && real.has(p.target)) {
          if (dy >= 0.2) bad.push(`stub not level ${p.source} ${p.target}`);
        } else continue;
        for (const n of net.nodes) if (n.id !== p.source && n.id !== p.target) nearest = Math.min(nearest, distToSegment(pos.get(n.id)!, a, b));
      }
      expect(bad).toEqual([]);
      expect(nearest).toBeGreaterThanOrEqual(18);

      const byKey = new Map<string, typeof routes.pieces>();
      for (const p of routes.pieces) for (const k of p.edges) byKey.set(k, [...(byKey.get(k) ?? []), p]);
      for (const e of net.edges) {
        const key = pairKey(e.source, e.target);
        const adj = new Map<string, string[]>();
        for (const p of byKey.get(key) ?? []) {
          adj.set(p.source, [...(adj.get(p.source) ?? []), p.target]);
          adj.set(p.target, [...(adj.get(p.target) ?? []), p.source]);
        }
        const seen = new Set([e.source]);
        const queue = [e.source];
        while (queue.length) for (const v of adj.get(queue.shift()!) ?? []) if (!seen.has(v)) seen.add(v), queue.push(v);
        expect(seen.has(e.target)).toBe(true);
        const labelled = (byKey.get(key) ?? []).filter((p) => p.edges.length === 1 && p.label);
        expect(labelled).toHaveLength(1);
        // Arrows follow the calls: from the target to the contact here.
        const [piece] = labelled;
        if (!real.has(piece.source)) expect(piece.arrows).toEqual([e.ba > 0, e.ab > 0]);
      }
      // Each target's spine is on its own side of the ladder.
      for (const bd of layout.bundles!) {
        const x = (t: string) => routes.bends.get(`__bundle:${layout.bundles!.indexOf(bd)}:${t}`)!.x;
        const [a, b] = [pos.get(bd.a)!, pos.get(bd.b)!];
        if (Math.abs(a.x - b.x) > 1) expect(Math.sign(x(bd.b) - x(bd.a))).toBe(Math.sign(b.x - a.x));
        for (const m of bd.members) expect(Math.min(x(bd.a), x(bd.b)) < pos.get(m)!.x && pos.get(m)!.x < Math.max(x(bd.a), x(bd.b))).toBe(true);
      }
      expect(routeBundles(net, pos, layout.bundles!, layout.targetCurves)).toEqual(routes);
    });
  }

  it('bows links between neighbouring targets out, as the layout says', () => {
    const layout = hubLayout(six);
    const routes = routeBundles(six, layout.pos, layout.bundles!, layout.targetCurves);
    const t01 = routes.pieces.find((p) => p.source === 'T0' && p.target === 'T1')!;
    expect(t01.curve).toBe(layout.targetCurves!.get('T0\u0000T1'));
    expect(routes.pieces.find((p) => p.source === 'T0' && p.target === 'T3')!.curve).toBeUndefined();
  });

  it('follows numbers moved by hand, the stubs still level', () => {
    const layout = hubLayout(six);
    const moved = new Map(layout.pos);
    const [first] = layout.bundles!;
    const m = first.members[0];
    moved.set(m, { x: moved.get(m)!.x + 40, y: moved.get(m)!.y + 25 });
    const routes = routeBundles(six, moved, layout.bundles!, layout.targetCurves);
    for (const p of routes.pieces.filter((q) => q.target === m)) expect(where(routes, moved, p.source).y).toBeCloseTo(moved.get(m)!.y, 6);
  });
});
