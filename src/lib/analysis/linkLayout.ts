import { LANE_STEP, routeTree } from './linkRoute';
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
  /** Where a node's label goes when not under it (a target's, away from its fan). */
  labelSide?: Map<string, 'top' | 'bottom' | 'left' | 'right'>;
  /** Numbers whose label sits a line lower, so neighbours in a tight row do not collide. */
  labelLower?: Set<string>;
}

/** The ways a link chart can be laid out (force is computed by the chart itself). */
export type LayoutKind = 'hub' | 'packed' | 'hierarchy' | 'organization' | 'force';

/** Key of the link between two nodes, whichever way it runs. */
export const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

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

const byWeight = (ids: string[], weightOf: (id: string) => number) => ids.sort((a, b) => weightOf(b) - weightOf(a) || a.localeCompare(b));

/** Targets, and every contact grouped by the targets it talks to; shared by all layouts. */
interface Groups {
  targetIds: Set<string>;
  /** Targets in drawing order: those sharing the most contacts are neighbours. */
  order: string[];
  /** Link weight from each contact to each target it talks to. */
  links: Map<string, Map<string, number>>;
  /** A contact's total weight with all targets. */
  total: (id: string) => number;
  /** Contacts of one target only, strongest first. */
  exclusive: Map<string, string[]>;
  /** Contacts of several targets, by the joined target ids, strongest first. */
  shared: Map<string, string[]>;
  /** Contacts linked to no target (not expected in CDR networks), strongest first. */
  loose: string[];
}

function classify(net: Network): Groups {
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
  for (const [t, ids] of exclusive) byWeight(ids, (c) => links.get(c)!.get(t) ?? 0);
  for (const ids of shared.values()) byWeight(ids, total);
  const degree = new Map(net.nodes.map((n) => [n.id, n.weightedDegree]));
  byWeight(loose, (id) => degree.get(id) ?? 0);
  return { targetIds, order: orderTargets(targets.map((t) => t.id), shared, net), links, total, exclusive, shared, loose };
}

export function hubLayout(net: Network): LinkLayout {
  const pos = new Map<string, Point>();
  const { targetIds, order, links, total, exclusive, shared, loose } = classify(net);

  // Targets ordered so that those sharing the most contacts (or talking to
  // each other) are neighbours on the circle.
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
  // Size of the targets' ellipse when there are many targets (see below).
  let innerB = 0;
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
  } else if (k === 3) {
    const maxR = Math.max(RING0, ...order.map(clusterR));
    const rc = Math.max(320, (1.1 * maxR) / Math.sin(Math.PI / k));
    order.forEach((id, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / k;
      hub.set(id, { x: rc * Math.cos(a), y: rc * Math.sin(a) });
      outward.set(id, a);
    });
  } else if (k > 3) {
    // Many targets: an ellipse as wide as the chart box is, the targets
    // evenly spaced along it and just far enough apart that neighbouring
    // fans do not meet; the shared contacts get ordered rings inside.
    const maxR = Math.max(RING0, ...order.map(clusterR));
    const unit = ellipseTrack(ELLIPSE, 1);
    const spots = order.map((_, i) => unit.at((unit.total * i) / k));
    let nearest = Infinity;
    spots.forEach((p, i) => (nearest = Math.min(nearest, Math.hypot(p.x - spots[(i + 1) % k].x, p.y - spots[(i + 1) % k].y))));
    let b = Math.max(300, (2.2 * maxR) / nearest);
    const sharedCount = [...shared.values()].reduce((n, ids) => n + ids.length, 0);
    const capacity = (bb: number) => INNER_RINGS.reduce((n, f) => n + Math.floor((unit.total * bb * f) / SHARED_GAP), 0);
    for (let i = 0; i < 40 && capacity(b) < sharedCount; i++) b *= 1.1;
    innerB = b;
    order.forEach((id, i) => {
      const p = spots[i];
      hub.set(id, { x: p.x * b, y: p.y * b });
      // The fan points along the ellipse's outward normal.
      outward.set(id, Math.atan2(p.y, p.x / (ELLIPSE * ELLIPSE)));
    });
  }
  for (const [id, p] of hub) pos.set(id, { ...p });

  let labelSide: LinkLayout['labelSide'];
  if (k > 3) {
    // A target's label goes on the side away from its fan.
    labelSide = new Map();
    for (const [id, phi] of outward) {
      const dy = Math.sin(phi);
      const dx = Math.cos(phi);
      labelSide.set(id, dy > 0.6 ? 'top' : dy < -0.6 ? 'bottom' : dx > 0 ? 'left' : 'right');
    }
  }

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

  // Shared contacts: on ordered inner rings when there are many targets,
  // otherwise between the targets they link, strongest in the middle.
  if (k > 3) placeSharedRings(shared, links, total, hub, innerB, pos, (labelSide ??= new Map()));
  else for (const [key, ids] of shared) {
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
  return { pos, bounds: boundsOf(pos), labelSide };
}

/** Width over height of the ellipse many targets sit on (the chart box is wide). */
const ELLIPSE = 1.6;
/** Inner rings for shared contacts, as fractions of the targets' ellipse, outermost first. */
const INNER_RINGS = [0.62, 0.47, 0.33, 0.2];
/** Gap between shared contacts on a ring: room for a photo and a name. */
const SHARED_GAP = 1.3 * MIN_GAP;

/** An ellipse (half-axes a, b) measured by arc length from its top, clockwise on screen. */
function ellipseTrack(a: number, b: number, steps = 720) {
  const pts: Point[] = [];
  const len: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = -Math.PI / 2 + (2 * Math.PI * i) / steps;
    pts.push({ x: a * Math.cos(t), y: b * Math.sin(t) });
    len.push(i ? len[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) : 0);
  }
  const total = len[steps];
  /** The point at arc length s (wrapping round). */
  const at = (s: number): Point => {
    const v = ((s % total) + total) % total;
    let lo = 0;
    let hi = steps;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (len[mid] <= v) lo = mid;
      else hi = mid;
    }
    const f = (v - len[lo]) / Math.max(1e-9, len[hi] - len[lo]);
    return { x: pts[lo].x + f * (pts[hi].x - pts[lo].x), y: pts[lo].y + f * (pts[hi].y - pts[lo].y) };
  };
  /** Arc length of the point seen in direction beta from the centre. */
  const arcOf = (beta: number): number => {
    const t = Math.atan2(a * Math.sin(beta), b * Math.cos(beta));
    const i = ((((t + Math.PI / 2) / (2 * Math.PI)) * steps) % steps + steps) % steps;
    const lo = Math.floor(i);
    return len[lo] + (i - lo) * (len[lo + 1] - len[lo]);
  };
  return { total, at, arcOf };
}

/**
 * Shared contacts of many targets: each faces the (weighted) direction of
 * its targets and sits on an inner ring there, in order round the ring.
 * Those whose targets lie close together take the outer ring, nearest
 * them; those linking targets all round the chart go to the inner rings.
 */
function placeSharedRings(
  shared: Map<string, string[]>,
  links: Map<string, Map<string, number>>,
  total: (id: string) => number,
  hub: Map<string, Point>,
  b: number,
  pos: Map<string, Point>,
  labelSide: NonNullable<LinkLayout['labelSide']>,
) {
  const wants: { id: string; beta: number; rho: number }[] = [];
  for (const ids of shared.values()) {
    for (const id of ids) {
      let x = 0;
      let y = 0;
      let w = 0;
      let strongest = '';
      let best = -1;
      for (const [t, weight] of links.get(id) ?? []) {
        const h = hub.get(t);
        if (!h) continue;
        const a = Math.atan2(h.y, h.x);
        x += weight * Math.cos(a);
        y += weight * Math.sin(a);
        w += weight;
        if (weight > best || (weight === best && t < strongest)) [best, strongest] = [weight, t];
      }
      const rho = w ? Math.hypot(x, y) / w : 0;
      const h = hub.get(strongest);
      const beta = rho > 0.15 || !h ? Math.atan2(y, x) : Math.atan2(h.y, h.x);
      wants.push({ id, beta, rho });
    }
  }
  wants.sort((p, q) => q.rho - p.rho || total(q.id) - total(p.id) || p.id.localeCompare(q.id));
  let next = 0;
  INNER_RINGS.forEach((f, j) => {
    const track = ellipseTrack(ELLIPSE * b * f, b * f);
    const cap = j === INNER_RINGS.length - 1 ? wants.length - next : Math.floor(track.total / SHARED_GAP);
    const ring = wants.slice(next, next + cap);
    next += ring.length;
    if (!ring.length) return;
    const want = ring.map((r) => ({ id: r.id, s: track.arcOf(r.beta) })).sort((p, q) => p.s - q.s || p.id.localeCompare(q.id));
    const n = want.length;
    const gap = Math.min(SHARED_GAP, track.total / n);
    // Open the ring at its widest gap, push neighbours apart, re-centre.
    let cut = 0;
    let widest = -1;
    for (let i = 0; i < n; i++) {
      const g = (want[(i + 1) % n].s - want[i].s + track.total) % track.total || (n === 1 ? track.total : 0);
      if (g > widest) [widest, cut] = [g, (i + 1) % n];
    }
    const order = [...want.slice(cut), ...want.slice(0, cut)];
    const desired = order.map((o, i) => (i && o.s < order[0].s ? o.s + track.total : o.s));
    const placed: number[] = [];
    desired.forEach((d, i) => placed.push(i ? Math.max(d, placed[i - 1] + gap) : d));
    if (placed[n - 1] - placed[0] + gap > track.total) placed.forEach((_, i) => (placed[i] = placed[0] + (i * track.total) / n));
    const shift = desired.reduce((acc, d, i) => acc + (d - placed[i]), 0) / n;
    order.forEach((o, i) => {
      pos.set(o.id, track.at(placed[i] + shift));
      // Neighbours on a ring take turns above and below, so their labels have twice the room.
      labelSide.set(o.id, i % 2 ? 'top' : 'bottom');
    });
  });
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


// ---------------------------------------------------------------------------
// Other layouts. Grid cells leave room for a two-line label under each icon.
const COL_W = 92;
const ROW_H = 84;

/** The layout for a chart mode; force starts from the peacock positions. */
export function layoutFor(kind: LayoutKind, net: Network): LinkLayout {
  switch (kind) {
    case 'packed':
      return packedLayout(net);
    case 'hierarchy':
      return hierarchyLayout(net);
    case 'organization':
      return organizationLayout(net);
    default:
      return hubLayout(net);
  }
}

/** First ring of a packed disc: room for the target's own label below it. */
const PACK_R0 = 100;
/** At most this share of a ring is kept clear for lines to other discs. */
const MAX_CORRIDORS = 1 / 3;
/** The first ring keeps this far either side of straight down clear for the target's name. */
const NAME_SPOT = Math.PI / 4.5;
/** Room beside a packed chart for the labels of its outermost contacts. */
const LABEL_ROOM = 70;

/**
 * Packed: each target is a disc of tidy rings, its strongest contacts on the
 * inner ring. A contact shared with other targets lives in the disc of the
 * target it talks to most, on the outer ring, on the side facing the others,
 * so its other links only cross the gap. Discs sit in a table, rows and
 * columns aligned, and targets that share contacts or call each other are
 * placed next to each other. Every ring keeps a gap towards each such
 * neighbour, so the lines between discs reach the targets without running
 * over contacts.
 */
export function packedLayout(net: Network): LinkLayout {
  const g = classify(net);
  const pos = new Map<string, Point>();
  const labelSide: NonNullable<LinkLayout['labelSide']> = new Map();
  const targets = g.order;
  const k = targets.length;
  if (k === 0) {
    looseRow(g.loose, 0, pos);
    return { pos, bounds: boundsOf(pos) };
  }
  const rank = new Map(targets.map((t, i) => [t, i]));

  // A shared contact's home: the target it talks to most.
  const homed = new Map<string, string[]>(targets.map((t) => [t, []]));
  const others = new Map<string, Map<string, number>>();
  for (const ids of g.shared.values()) {
    for (const id of ids) {
      const ls = [...(g.links.get(id) ?? [])].filter(([t]) => rank.has(t)).sort((a, b) => b[1] - a[1] || rank.get(a[0])! - rank.get(b[0])!);
      homed.get(ls[0][0])!.push(id);
      others.set(id, new Map(ls.slice(1)));
    }
  }
  for (const ids of homed.values()) byWeight(ids, g.total);

  // How strongly two targets belong together: contacts in common, a direct link.
  const tie = new Map<string, number>();
  const bump = (a: string, b: string, v: number) => {
    if (a !== b && rank.has(a) && rank.has(b)) tie.set(pairKey(a, b), (tie.get(pairKey(a, b)) ?? 0) + v);
  };
  for (const [key, ids] of g.shared) {
    const ts = key.split('\u0000');
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) bump(ts[i], ts[j], ids.length);
  }
  for (const e of net.edges) if (g.targetIds.has(e.source) && g.targetIds.has(e.target)) bump(e.source, e.target, 2);
  const partners = new Map<string, string[]>(
    targets.map((t) => [
      t,
      targets.filter((u) => u !== t && tie.has(pairKey(t, u))).sort((a, b) => tie.get(pairKey(t, b))! - tie.get(pairKey(t, a))! || rank.get(a)! - rank.get(b)!),
    ]),
  );

  // Lines coming into each disc from each neighbour: its contacts homed there
  // that also talk to this target, and a direct link. Busy corridors are wider.
  const incoming = new Map<string, number>();
  for (const [u, ids] of homed) for (const id of ids) for (const t of others.get(id)!.keys()) incoming.set(`${t}>${u}`, (incoming.get(`${t}>${u}`) ?? 0) + 1);
  for (const e of net.edges) {
    if (!g.targetIds.has(e.source) || !g.targetIds.has(e.target)) continue;
    incoming.set(`${e.source}>${e.target}`, (incoming.get(`${e.source}>${e.target}`) ?? 0) + 1);
    incoming.set(`${e.target}>${e.source}`, (incoming.get(`${e.target}>${e.source}`) ?? 0) + 1);
  }
  const corridorWidth = (t: string, u: string) => Math.min(3, 1 + Math.floor((incoming.get(`${t}>${u}`) ?? 0) / 6));

  // Rings of a disc: slots MIN_GAP apart, some kept clear for corridors.
  const ringSlots = (r: number) => Math.max(1, Math.floor((2 * Math.PI * (PACK_R0 + r * MIN_GAP)) / MIN_GAP));
  const corridorsOn = (r: number, t: string) =>
    Math.min(
      partners.get(t)!.reduce((s, u) => s + corridorWidth(t, u), 0),
      Math.floor(ringSlots(r) * MAX_CORRIDORS),
    );
  const members = (t: string) => [...(g.exclusive.get(t) ?? []), ...homed.get(t)!];
  const ringsOf = (t: string) => {
    let left = members(t).length;
    let r = 0;
    // The first ring also leaves room under the target for its name.
    while (left > 0) left -= ringSlots(r) - corridorsOn(r, t) - (r === 0 ? 4 : 0), r++;
    return r;
  };
  const radius = new Map(targets.map((t) => [t, ringsOf(t) ? PACK_R0 + (ringsOf(t) - 1) * MIN_GAP + MIN_GAP / 2 : TARGET_GAP * 0.6]));

  // The table: columns for about 16:9, then targets swapped between cells
  // until those that belong together are as close as they can be.
  let cols = 1;
  let best = Infinity;
  for (let c = 1; c <= k; c++) {
    // About 16:9, and few empty cells (they leave holes in the picture).
    const score = Math.abs(Math.log((c / Math.ceil(k / c)) / (16 / 9))) + (0.3 * (c * Math.ceil(k / c) - k)) / k;
    if (score < best - 1e-9) [cols, best] = [c, score];
  }
  const rows = Math.ceil(k / cols);
  const cellOf = new Map<string, number>();
  const occupant: (string | undefined)[] = Array.from({ length: rows * cols }, () => undefined);
  targets.forEach((t, i) => {
    const row = Math.floor(i / cols);
    const col = row % 2 ? cols - 1 - (i % cols) : i % cols;
    cellOf.set(t, row * cols + col);
    occupant[row * cols + col] = t;
  });
  const dist = (a: number, b: number) => Math.hypot(Math.floor(a / cols) - Math.floor(b / cols), (a % cols) - (b % cols));
  const costOf = (t: string, cell: number, skip?: string) =>
    partners.get(t)!.reduce((s, u) => (u === skip ? s : s + tie.get(pairKey(t, u))! * dist(cell, cellOf.get(u)!)), 0);
  for (let pass = 0; pass < 60; pass++) {
    let improved = false;
    for (let i = 0; i < occupant.length; i++) {
      for (let j = i + 1; j < occupant.length; j++) {
        const a = occupant[i];
        const b = occupant[j];
        if (!a && !b) continue;
        const before = (a ? costOf(a, i, b) : 0) + (b ? costOf(b, j, a) : 0);
        const after = (a ? costOf(a, j, b) : 0) + (b ? costOf(b, i, a) : 0);
        if (after < before - 1e-9) {
          occupant[i] = b;
          occupant[j] = a;
          if (a) cellOf.set(a, j);
          if (b) cellOf.set(b, i);
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  // Rows and columns as wide as their largest disc (empty ones dropped).
  const usedCols = [...new Set([...cellOf.values()].map((c) => c % cols))].sort((a, b) => a - b);
  const usedRows = [...new Set([...cellOf.values()].map((c) => Math.floor(c / cols)))].sort((a, b) => a - b);
  const colW = usedCols.map((c) => Math.max(...targets.filter((t) => cellOf.get(t)! % cols === c).map((t) => 2 * radius.get(t)!)));
  const rowH = usedRows.map((r) => Math.max(...targets.filter((t) => Math.floor(cellOf.get(t)! / cols) === r).map((t) => 2 * radius.get(t)!)));
  const offsets = (sizes: number[]) => {
    const out: number[] = [];
    let at = 0;
    for (const s of sizes) {
      out.push(at + s / 2);
      at += s + COL_W;
    }
    return out;
  };
  const xs = offsets(colW);
  const ys = offsets(rowH);
  const centre = new Map(targets.map((t) => [t, { x: xs[usedCols.indexOf(cellOf.get(t)! % cols)], y: ys[usedRows.indexOf(Math.floor(cellOf.get(t)! / cols))] }]));
  for (const [t, c] of centre) pos.set(t, { ...c });

  // Fill each disc's rings, inner first; shared contacts take the outer slots
  // facing their other targets, the rest spread evenly.
  const angleTo = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x);
  const gap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  for (const t of targets) {
    const c = centre.get(t)!;
    const towards = partners.get(t)!.flatMap((u) => Array.from({ length: corridorWidth(t, u) }, () => angleTo(c, centre.get(u)!)));
    // Spokes line up with the strongest neighbour, so its corridor is straight.
    const base = towards[0] ?? -Math.PI / 2;
    // Contacts that show their label (shared elsewhere) go after the rest, so
    // their labels point out of the disc rather than over other contacts.
    const flagged = new Set(net.nodes.filter((n) => n.shared).map((n) => n.id));
    const exclusive = g.exclusive.get(t) ?? [];
    const own = [...exclusive.filter((id) => !flagged.has(id)), ...exclusive.filter((id) => flagged.has(id))];
    const shared = new Set(homed.get(t)!);
    const slotAt = (r: number) => (j: number) => base + (2 * Math.PI * j) / ringSlots(r);
    // Free slots of each ring: corridors kept clear and, on the first ring,
    // the spot under the target where its name goes.
    const rings: Set<number>[] = [];
    for (let left = own.length + shared.size, r = 0; left > 0; r++) {
      const slotAngle = slotAt(r);
      const free = new Set(Array.from({ length: ringSlots(r) }, (_, j) => j));
      const keep = (a: number) => {
        let bestJ = -1;
        for (const j of free) if (bestJ < 0 || gap(slotAngle(j), a) < gap(slotAngle(bestJ), a)) bestJ = j;
        free.delete(bestJ);
      };
      for (const a of towards.slice(0, corridorsOn(r, t))) keep(a);
      if (r === 0) for (const j of [...free]) if (gap(slotAngle(j), Math.PI / 2) < NAME_SPOT) free.delete(j);
      rings.push(free);
      left -= free.size;
    }
    // Shared contacts fill the outer rings, the strongest own contacts the inner ones.
    const counts = rings.map((f) => f.size);
    counts[counts.length - 1] -= counts.reduce((a, b) => a + b, 0) - own.length - shared.size;
    const byRing: string[][] = counts.map(() => []);
    const outerFirst = [...homed.get(t)!];
    for (let r = counts.length - 1; r >= 0; r--) while (byRing[r].length < counts[r] && outerFirst.length) byRing[r].push(outerFirst.shift()!);
    for (let r = 0; r < counts.length; r++) while (byRing[r].length < counts[r] && own.length) byRing[r].push(own.shift()!);
    for (let r = 0; r < counts.length; r++) {
      const R = PACK_R0 + r * MIN_GAP;
      const slotAngle = slotAt(r);
      const free = rings[r];
      const ring = byRing[r];
      const place = (id: string, j: number) => {
        const a = slotAngle(j);
        pos.set(id, { x: c.x + R * Math.cos(a), y: c.y + R * Math.sin(a) });
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        // Beside the icon unless nearly straight up or down: neighbours on a
        // ring sit closer than a label is wide.
        labelSide.set(id, cx > 0.25 ? 'right' : cx < -0.25 ? 'left' : cy > 0 ? 'bottom' : 'top');
        free.delete(j);
      };
      for (const id of ring.filter((x) => shared.has(x))) {
        let vx = 0;
        let vy = 0;
        for (const [u, w] of others.get(id) ?? []) {
          const a = angleTo(c, centre.get(u)!);
          vx += w * Math.cos(a);
          vy += w * Math.sin(a);
        }
        const want = Math.atan2(vy, vx);
        let bestJ = -1;
        for (const j of free) if (bestJ < 0 || gap(slotAngle(j), want) < gap(slotAngle(bestJ), want)) bestJ = j;
        place(id, bestJ);
      }
      const mine = ring.filter((x) => !shared.has(x));
      const left = [...free].sort((a, b) => a - b);
      mine.forEach((id, i) => place(id, left[Math.floor((i * left.length) / mine.length)]));
    }
  }

  if (g.loose.length) {
    const bottom = Math.max(...[...pos.values()].map((p) => p.y));
    looseRow(g.loose, bottom + ROW_H * 1.5, pos);
  }
  separate(pos, g.targetIds);
  // Labels point out of the discs: leave room for those on the outer edges.
  const b = boundsOf(pos);
  return { pos, bounds: { minX: b.minX - LABEL_ROOM, minY: b.minY - 18, maxX: b.maxX + LABEL_ROOM, maxY: b.maxY + 18 }, labelSide };
}

/** Columns of a contact block under each target, chosen so the whole chart is about 16:9. */
function blockColumns(counts: number[], extraRows: number, maxCols: number, rowH = ROW_H): number[] {
  let best: number[] = counts.map(() => 1);
  let bestScore = Infinity;
  for (const a of [0.15, 0.25, 0.4, 0.6, 1, 1.5, 2.2, 3.2, 4.5, 6.5]) {
    const cols = counts.map((n) => Math.max(1, Math.min(maxCols, Math.ceil(Math.sqrt(n * a)))));
    const w = cols.reduce((s, c, i) => s + Math.max(c * COL_W, 2 * TARGET_GAP) + (i ? COL_W * 0.6 : 0), 0);
    const h = (Math.max(1, ...counts.map((n, i) => Math.ceil(n / cols[i]))) + extraRows + 1) * rowH;
    const score = Math.abs(Math.log(w / h / 1.8));
    if (score < bestScore - 1e-9) {
      best = cols;
      bestScore = score;
    }
  }
  return best;
}

/** Targets side by side, each in a slot as wide as its block; returns their x. */
function targetRow(order: string[], widths: number[]): Map<string, number> {
  const slots = widths.map((w) => Math.max(w, 2 * TARGET_GAP));
  const total = slots.reduce((s, w) => s + w, 0) + Math.max(0, slots.length - 1) * COL_W * 0.6;
  const xs = new Map<string, number>();
  let x = -total / 2;
  order.forEach((t, i) => {
    xs.set(t, x + slots[i] / 2);
    x += slots[i] + COL_W * 0.6;
  });
  return xs;
}

/**
 * Shared contacts in rows: each wants the middle of the targets it links;
 * rows are filled in that order and pushed apart, then re-centred.
 * Returns how many rows were used.
 */
function sharedRows(g: Groups, tx: Map<string, number>, y0: number, step: number, rowWidth: number, pos: Map<string, Point>): number {
  const want: { id: string; x: number }[] = [];
  for (const [key, ids] of g.shared) {
    const ts = key.split('\u0000').filter((t) => tx.has(t));
    const x = ts.reduce((s, t) => s + tx.get(t)!, 0) / Math.max(1, ts.length);
    for (const id of ids) want.push({ id, x });
  }
  want.sort((a, b) => a.x - b.x || g.total(b.id) - g.total(a.id) || a.id.localeCompare(b.id));
  const perRow = Math.max(1, Math.floor(rowWidth / COL_W));
  const rows = Math.ceil(want.length / perRow);
  for (let r = 0; r < rows; r++) {
    const row = want.slice(r * perRow, (r + 1) * perRow);
    const xs: number[] = [];
    row.forEach((w, i) => xs.push(i ? Math.max(w.x, xs[i - 1] + COL_W) : w.x));
    const shift = row.reduce((s, w, i) => s + (w.x - xs[i]), 0) / Math.max(1, row.length);
    row.forEach((w, i) => pos.set(w.id, { x: xs[i] + shift, y: y0 + r * step }));
  }
  return rows;
}

/** Contacts linked to no target: one last row, centred. */
function looseRow(ids: string[], y: number, pos: Map<string, Point>) {
  ids.forEach((id, i) => pos.set(id, { x: (i - (ids.length - 1) / 2) * COL_W, y }));
}

/** Rows of a hierarchy: icon, a two-line label (every other one a line lower) and the bus of the row below. */
const TREE_ROW = 140;
/** Below the targets to the first row of contacts (their labels sit beside them). */
const TREE_TOP = 120;
/** Up to this many contacts across, every target keeps its contacts in one row. */
const ONE_ROW_MAX = 24;

/**
 * Hierarchy, as in an investigation chart: the targets in a row on top, the
 * contacts they share in a band below (each under the middle of its
 * targets), and each target's own contacts in rows under it, strongest
 * nearest the middle. Links are right-angled (see linkRoute): a trunk down
 * from the target, a bus above each row and a short drop into each contact,
 * so every row but the last leaves the middle free for the trunk.
 */
export function hierarchyLayout(net: Network): LinkLayout {
  const g = classify(net);
  const pos = new Map<string, Point>();
  const labelSide = new Map<string, 'top' | 'bottom' | 'left' | 'right'>();
  const counts = g.order.map((t) => g.exclusive.get(t)?.length ?? 0);
  const sharedCount = [...g.shared.values()].reduce((s, ids) => s + ids.length, 0);
  // One row each while the chart stays readable; otherwise rows of an even
  // number, half each side of the trunk.
  const cols =
    counts.reduce((s, n) => s + n, 0) <= ONE_ROW_MAX
      ? counts.map((n) => Math.max(1, n))
      : blockColumns(counts, Math.ceil(sharedCount / 12), 16, TREE_ROW).map((c) => Math.max(2, c + (c % 2)));
  const tx = targetRow(
    g.order,
    cols.map((c) => c * COL_W),
  );
  for (const [t, x] of tx) {
    pos.set(t, { x, y: 0 });
    // Below runs the trunk and above the links between targets: the name goes beside.
    labelSide.set(t, 'right');
  }
  const width = Math.max(COL_W, ...[...tx.values()].map((x) => Math.abs(x) * 2 + 2 * TARGET_GAP));

  // Shared contacts: rows in the band, clear of every trunk, each row low
  // enough for one bus per target that comes to it.
  const trunks = [...tx.values()];
  const want: { id: string; x: number; ts: string[] }[] = [];
  for (const [key, ids] of g.shared) {
    const ts = key.split('\u0000').filter((t) => tx.has(t));
    const x = ts.reduce((s, t) => s + tx.get(t)!, 0) / Math.max(1, ts.length);
    for (const id of ids) want.push({ id, x, ts });
  }
  want.sort((a, b) => a.x - b.x || g.total(b.id) - g.total(a.id) || a.id.localeCompare(b.id));
  const perRow = Math.max(1, Math.floor(width / COL_W));
  let y = 0;
  for (let r = 0; r * perRow < want.length; r++) {
    const row = want.slice(r * perRow, (r + 1) * perRow);
    const buses = new Set(row.flatMap((w) => w.ts)).size;
    y += (r === 0 ? TREE_TOP : TREE_ROW) + Math.max(0, buses - 1) * LANE_STEP;
    const xs: number[] = [];
    row.forEach((w, i) => xs.push(i ? Math.max(w.x, xs[i - 1] + COL_W) : w.x));
    const shift = row.reduce((s, w, i) => s + (w.x - xs[i]), 0) / Math.max(1, row.length);
    let prev = -Infinity;
    row.forEach((w, i) => {
      let x = Math.max(xs[i] + shift, prev + COL_W);
      for (let guard = 0; guard < trunks.length; guard++) {
        const hit = trunks.find((t) => Math.abs(x - t) < COL_W / 2 - 1e-6);
        if (hit === undefined) break;
        x = hit + COL_W / 2;
      }
      pos.set(w.id, { x, y });
      prev = x;
    });
  }

  // Own contacts: rows centred under the target, strongest in the middle.
  const blockTop = y + (y ? TREE_ROW : TREE_TOP);
  let bottom = blockTop;
  g.order.forEach((t, k) => {
    const ids = g.exclusive.get(t) ?? [];
    const c = cols[k];
    for (let r = 0; r * c < ids.length; r++) {
      const row = ids.slice(r * c, (r + 1) * c);
      const slots = centreOut(row.length);
      const ry = blockTop + r * TREE_ROW;
      row.forEach((id, i) => pos.set(id, { x: tx.get(t)! + (slots[i] - (row.length - 1) / 2) * COL_W, y: ry }));
      bottom = Math.max(bottom, ry);
    }
  });
  if (g.loose.length) looseRow(g.loose, bottom + TREE_ROW, pos);
  separate(pos, g.targetIds);

  // Along a tight row, every other label a line lower: neighbours a column
  // apart are closer than a number is wide.
  const labelLower = new Set<string>();
  const rows = new Map<number, string[]>();
  for (const [id, p] of pos) {
    if (g.targetIds.has(id)) continue;
    const k = Math.round(p.y);
    if (!rows.has(k)) rows.set(k, []);
    rows.get(k)!.push(id);
  }
  for (const ids of rows.values()) {
    ids.sort((a, b) => pos.get(a)!.x - pos.get(b)!.x || a.localeCompare(b));
    ids.forEach((id, i) => {
      const prev = ids[i - 1];
      if (prev && !labelLower.has(prev) && pos.get(id)!.x - pos.get(prev)!.x < 1.6 * COL_W) labelLower.add(id);
    });
  }

  // The frame takes in the lanes above the targets too.
  const routes = routeTree(net, pos);
  const bounds = boundsOf(new Map([...pos, ...routes.bends]));
  return { pos, bounds, labelSide, labelLower };
}

/**
 * Organization: an org chart. The contacts shared between targets sit in a
 * row above them (over the middle of the targets they link); each target's
 * own contacts hang below it in a narrow branch, at most five across,
 * strongest first, alternate rows offset so links pass between the contacts
 * above rather than through them.
 */
export function organizationLayout(net: Network): LinkLayout {
  const g = classify(net);
  const pos = new Map<string, Point>();
  const counts = g.order.map((t) => g.exclusive.get(t)?.length ?? 0);
  const cols = counts.map((n) => Math.max(1, Math.min(5, n)));
  const tx = targetRow(
    g.order,
    cols.map((c) => (c + 0.5) * COL_W),
  );
  for (const [t, x] of tx) pos.set(t, { x, y: 0 });
  const width = Math.max(COL_W, ...[...tx.values()].map((x) => Math.abs(x) * 2 + 2 * TARGET_GAP));
  // Shared contacts above, rows going up.
  sharedRows(g, tx, -ROW_H * 1.35, -ROW_H, width, pos);
  let bottom = 0;
  g.order.forEach((t, k) => {
    const ids = g.exclusive.get(t) ?? [];
    const c = cols[k];
    ids.forEach((id, i) => {
      const row = Math.floor(i / c);
      const inRow = Math.min(c, ids.length - row * c);
      const shift = row % 2 === 1 ? 0.5 : 0;
      const x = tx.get(t)! + (i % c - (inRow - 1) / 2 + (inRow === c ? shift - 0.25 : 0)) * COL_W;
      const y = ROW_H * 1.3 + row * ROW_H;
      pos.set(id, { x, y });
      bottom = Math.max(bottom, y);
    });
  });
  if (g.loose.length) looseRow(g.loose, bottom + ROW_H * 1.5, pos);
  separate(pos, g.targetIds);
  return { pos, bounds: boundsOf(pos) };
}
