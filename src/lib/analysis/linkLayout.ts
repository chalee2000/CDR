import type { Network } from './network';

/**
 * Hub ("peacock") layout for a link chart, in the spirit of investigation
 * charts: every target is a hub, the contacts it shares with other targets sit
 * between those targets, and the contacts only it talks to fan out on its
 * outer side in rings, strongest nearest. Deterministic, so the same data
 * always draws the same picture (and PNG exports match what was reviewed).
 */

export interface Point {
  x: number;
  y: number;
}

export interface LinkLayout {
  pos: Map<string, Point>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** Minimum distance between two contacts' centres (largest contact icon 46 px + gap). */
export const MIN_GAP = 62;
/** Minimum distance between a target and any other node. */
export const TARGET_GAP = 84;
const RING0 = 150;
const RING_STEP = 70;
const COLUMN_ROWS = 9;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

const deg = (d: number) => (d * Math.PI) / 180;

/** Indices ordered centre-out (0, +1, -1, +2, -2 …) so the strongest sit mid-arc. */
function centreOut(n: number): number[] {
  const mid = (n - 1) / 2;
  return Array.from({ length: n }, (_, i) => i).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
}

export function hubLayout(net: Network): LinkLayout {
  const pos = new Map<string, Point>();
  const targets = net.nodes.filter((n) => n.isTarget).sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99) || a.id.localeCompare(b.id));
  const targetIds = new Set(targets.map((t) => t.id));

  // Linked targets and link weight per contact.
  const links = new Map<string, Map<string, number>>();
  for (const e of net.edges) {
    for (const [x, y] of [
      [e.source, e.target],
      [e.target, e.source],
    ]) {
      if (targetIds.has(x) || !targetIds.has(y)) continue;
      if (!links.has(x)) links.set(x, new Map());
      links.get(x)!.set(y, (links.get(x)!.get(y) ?? 0) + e.weight);
    }
  }
  const total = (id: string) => [...(links.get(id)?.values() ?? [])].reduce((s, w) => s + w, 0);
  const contacts = net.nodes.filter((n) => !n.isTarget);
  const exclusive = new Map<string, string[]>(targets.map((t) => [t.id, []]));
  const shared = new Map<string, string[]>();
  const loose: string[] = [];
  for (const c of contacts) {
    const ts = [...(links.get(c.id)?.keys() ?? [])].sort();
    if (ts.length === 0) loose.push(c.id);
    else if (ts.length === 1) exclusive.get(ts[0])!.push(c.id);
    else {
      const key = ts.join('\u0000');
      if (!shared.has(key)) shared.set(key, []);
      shared.get(key)!.push(c.id);
    }
  }
  const byWeight = (ids: string[], weightOf: (id: string) => number) => ids.sort((a, b) => weightOf(b) - weightOf(a) || a.localeCompare(b));

  // Order targets so that those sharing the most contacts (or talking to
  // each other) are neighbours on the circle.
  const order = orderTargets(targets.map((t) => t.id), shared, net);
  const k = order.length;
  const span = k <= 1 ? 2 * Math.PI : k === 2 ? deg(230) : deg(200);
  const ringsFor = (n: number) => {
    const rings: number[] = [];
    let left = n;
    for (let i = 0; left > 0; i++) {
      const r = RING0 + i * RING_STEP;
      const cap = Math.max(1, Math.floor((span * r) / MIN_GAP));
      rings.push(Math.min(cap, left));
      left -= cap;
    }
    return rings;
  };
  const clusterR = (id: string) => {
    const rings = ringsFor(exclusive.get(id)!.length);
    return rings.length ? RING0 + (rings.length - 1) * RING_STEP : 0;
  };

  // Target hubs.
  const hub = new Map<string, Point>();
  const outward = new Map<string, number>();
  if (k === 1) {
    hub.set(order[0], { x: 0, y: 0 });
    outward.set(order[0], -Math.PI / 2);
  } else if (k === 2) {
    const pairShared = shared.get([...order].sort().join('\u0000'))?.length ?? 0;
    const cols = Math.max(1, Math.ceil(pairShared / COLUMN_ROWS));
    const d = Math.max(440, 2 * RING0 + 140, (cols - 1) * MIN_GAP + 2 * TARGET_GAP + 60);
    hub.set(order[0], { x: -d / 2, y: 0 });
    hub.set(order[1], { x: d / 2, y: 0 });
    outward.set(order[0], Math.PI);
    outward.set(order[1], 0);
  } else if (k > 2) {
    const maxR = Math.max(RING0, ...order.map(clusterR));
    const rc = Math.max(320, (1.1 * maxR) / Math.sin(Math.PI / k));
    order.forEach((id, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / k;
      hub.set(id, { x: rc * Math.cos(a), y: rc * Math.sin(a) });
      outward.set(id, a);
    });
  }
  for (const [id, p] of hub) pos.set(id, { ...p });

  // Each target's own contacts: rings on its outer side, strongest nearest.
  for (const id of order) {
    const mine = byWeight(exclusive.get(id)!, (c) => links.get(c)!.get(id) ?? 0);
    const h = hub.get(id)!;
    const phi = outward.get(id)!;
    let next = 0;
    ringsFor(mine.length).forEach((count, ring) => {
      const r = RING0 + ring * RING_STEP;
      // A lone hub fills whole rings clockwise from the top (alternate rings
      // staggered so spokes do not line up); an arc puts the strongest mid-arc.
      const shift = ring % 2 === 1 ? 0.5 : 0;
      const slots = k <= 1 ? Array.from({ length: count }, (_, i) => i) : centreOut(count);
      slots.forEach((slotIdx, j) => {
        const t = k <= 1 ? (slotIdx + shift) / count : (slotIdx + 0.5) / count;
        const a = k <= 1 ? phi + 2 * Math.PI * t : phi - span / 2 + span * t;
        pos.set(mine[next + j], { x: h.x + r * Math.cos(a), y: h.y + r * Math.sin(a) });
      });
      next += count;
    });
  }

  // Shared contacts: between the targets they link, strongest in the middle.
  for (const [key, ids] of shared) {
    const ts = key.split('\u0000').filter((t) => hub.has(t));
    const members = byWeight(ids, total);
    const c = ts.reduce((acc, t) => ({ x: acc.x + hub.get(t)!.x / ts.length, y: acc.y + hub.get(t)!.y / ts.length }), { x: 0, y: 0 });
    if (ts.length === 2) {
      const a = hub.get(ts[0])!;
      const b = hub.get(ts[1])!;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      const n = { x: -u.y, y: u.x };
      const cols = Math.max(1, Math.ceil(members.length / COLUMN_ROWS));
      const rows = Math.ceil(members.length / cols);
      const rowOrder = centreOut(rows);
      const colOrder = centreOut(cols);
      members.forEach((id, i) => {
        const row = rowOrder[Math.floor(i / cols)] - (rows - 1) / 2;
        const col = colOrder[i % cols] - (cols - 1) / 2;
        pos.set(id, { x: c.x + n.x * row * MIN_GAP + u.x * col * MIN_GAP, y: c.y + n.y * row * MIN_GAP + u.y * col * MIN_GAP });
      });
    } else {
      members.forEach((id, i) => {
        const r = i === 0 ? 0 : MIN_GAP * 0.62 * Math.sqrt(i + 0.5);
        pos.set(id, { x: c.x + r * Math.cos(i * GOLDEN), y: c.y + r * Math.sin(i * GOLDEN) });
      });
    }
  }

  // Anything not linked to a target (should not happen with CDR networks).
  const far = Math.max(0, ...[...pos.values()].map((p) => Math.hypot(p.x, p.y))) + (pos.size ? 2 * MIN_GAP : 0);
  byWeight(loose, (id) => net.nodes.find((n) => n.id === id)?.weightedDegree ?? 0).forEach((id, i) => {
    const r = far + MIN_GAP * 0.62 * Math.sqrt(i + 0.5);
    pos.set(id, { x: r * Math.cos(i * GOLDEN), y: r * Math.sin(i * GOLDEN) });
  });

  separate(pos, targetIds);
  return { pos, bounds: boundsOf(pos) };
}

/** Greedy chain: start from the first target, keep the strongest partner next. */
function orderTargets(ids: string[], shared: Map<string, string[]>, net: Network): string[] {
  if (ids.length <= 2) return ids;
  const tie = (a: string, b: string) => {
    let s = 0;
    for (const [key, members] of shared) {
      const ts = key.split('\u0000');
      if (ts.includes(a) && ts.includes(b)) s += members.length;
    }
    if (net.edges.some((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a))) s += 1;
    return s;
  };
  const out = [ids[0]];
  const left = new Set(ids.slice(1));
  while (left.size) {
    const last = out[out.length - 1];
    let best = '';
    let bestScore = -1;
    for (const id of ids) {
      if (!left.has(id)) continue;
      const s = tie(last, id);
      if (s > bestScore) {
        best = id;
        bestScore = s;
      }
    }
    out.push(best);
    left.delete(best);
  }
  return out;
}

/** Push apart nodes closer than the minimum gap; targets stay where they are. */
function separate(pos: Map<string, Point>, fixed: Set<string>, rounds = 150) {
  const ids = [...pos.keys()];
  const pts = ids.map((id) => pos.get(id)!);
  const isFixed = ids.map((id) => fixed.has(id));
  const cell = TARGET_GAP;
  for (let round = 0; round < rounds; round++) {
    const grid = new Map<string, number[]>();
    pts.forEach((p, i) => {
      const key = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(i);
    });
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      const gx = Math.floor(pts[i].x / cell);
      const gy = Math.floor(pts[i].y / cell);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const j of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
            if (j <= i || (isFixed[i] && isFixed[j])) continue;
            const min = isFixed[i] || isFixed[j] ? TARGET_GAP : MIN_GAP;
            let vx = pts[j].x - pts[i].x;
            let vy = pts[j].y - pts[i].y;
            const d = Math.hypot(vx, vy);
            if (d >= min) continue;
            if (d < 1e-6) {
              // Same spot: split along a direction fixed by the pair's indices.
              const a = (i * 7 + j * 13) * GOLDEN;
              vx = Math.cos(a);
              vy = Math.sin(a);
            } else {
              vx /= d;
              vy /= d;
            }
            const push = (min - d) / (isFixed[i] || isFixed[j] ? 1 : 2) + 0.01;
            if (!isFixed[i]) {
              pts[i].x -= vx * push;
              pts[i].y -= vy * push;
            }
            if (!isFixed[j]) {
              pts[j].x += vx * push;
              pts[j].y += vy * push;
            }
            moved = true;
          }
        }
      }
    }
    if (!moved) break;
  }
}

function boundsOf(pos: Map<string, Point>): LinkLayout['bounds'] {
  if (pos.size === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pos.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}
