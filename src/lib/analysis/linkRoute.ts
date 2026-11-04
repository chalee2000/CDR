import { pairKey, type Point } from './linkLayout';
import type { NetEdge, Network } from './network';

/**
 * Right-angled links for a hierarchy chart, as in an investigation chart: a
 * line down from each target (its trunk), across on a lane above each row of
 * its contacts (the bus), and down into each contact. Worked out from where
 * the numbers are, so the lines follow when numbers are moved by hand.
 *
 * The chart draws straight lines only, so the corners are invisible points
 * ("bends") and every link is a few straight pieces. Trunk and bus pieces
 * are shared by all the links that run along them (drawn once); the last
 * piece into a contact belongs to its own link and carries its weight,
 * count and arrows.
 */

/** Distance of a bus above the row it serves (chart units): room for a count and an arrow. */
export const LANE = 60;
/** Gap between parallel buses that would otherwise run along each other. */
export const LANE_STEP = 7;
/** Gap between the lines that enter one number from different targets. */
export const DROP_STEP = 7;
/** Distance of the lane above the targets that links between targets use. */
export const TT_LANE = 56;

export interface RoutePiece {
  source: string;
  target: string;
  /** Keys (pairKey) of the links that run along this piece. */
  edges: string[];
  /** bus: a trunk or bus piece shared by several links; edge: a piece of one link. */
  kind: 'bus' | 'edge';
  /** The target whose colour the piece takes (none for links between targets). */
  owner?: string;
  /** This piece carries its link's count. */
  label?: boolean;
  /** Counts into the same number stack up: 0 nearest the number. */
  stack?: number;
  /** Arrow at the source end, at the target end. */
  arrows?: [boolean, boolean];
  /** Curveness for a straight piece that should bow (links between neighbouring targets). */
  curve?: number;
}

export interface Routes {
  bends: Map<string, Point>;
  pieces: RoutePiece[];
}

const EPS = 0.01;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Lowest level each interval can take without running along another. */
function levels<T>(items: T[], span: (t: T) => [number, number], tie: (a: T, b: T) => number): Map<T, number> {
  const sorted = [...items].sort((a, b) => span(a)[0] - span(b)[0] || tie(a, b));
  const ends: number[] = [];
  const out = new Map<T, number>();
  for (const it of sorted) {
    const [lo, hi] = span(it);
    let level = ends.findIndex((end) => end + 12 < lo);
    if (level < 0) level = ends.length;
    ends[level] = hi;
    out.set(it, level);
  }
  return out;
}

export function routeTree(net: Network, pos: Map<string, Point>): Routes {
  const bends = new Map<string, Point>();
  const pieces: RoutePiece[] = [];
  const targets = new Set(net.nodes.filter((n) => n.isTarget).map((n) => n.id));
  const at = (id: string) => pos.get(id) ?? { x: 0, y: 0 };
  const bend = (owner: string, x: number, y: number) => {
    const id = `__bend:${owner}:${r1(x)}:${r1(y)}`;
    if (!bends.has(id)) bends.set(id, { x, y });
    return id;
  };

  interface Leg {
    t: string;
    x: string;
    key: string;
    tToX: boolean;
    xToT: boolean;
    dir: 1 | -1;
    /** Where the line enters the contact, and the lane it comes along. */
    bx: number;
    lane: number;
  }
  const legs: Leg[] = [];
  const tts: NetEdge[] = [];
  for (const e of net.edges) {
    const key = pairKey(e.source, e.target);
    const st = targets.has(e.source);
    const tt = targets.has(e.target);
    if (st && tt) tts.push(e);
    else if (!st && !tt) pieces.push({ source: e.source, target: e.target, edges: [key], kind: 'edge', label: true, arrows: [e.ba > 0, e.ab > 0] });
    else {
      const t = st ? e.source : e.target;
      const x = st ? e.target : e.source;
      legs.push({ t, x, key, tToX: st ? e.ab > 0 : e.ba > 0, xToT: st ? e.ba > 0 : e.ab > 0, dir: at(x).y >= at(t).y ? 1 : -1, bx: 0, lane: 0 });
    }
  }

  // A contact of several targets takes their lines side by side, in their order across.
  const byContact = new Map<string, Leg[]>();
  for (const l of legs) {
    if (!byContact.has(l.x)) byContact.set(l.x, []);
    byContact.get(l.x)!.push(l);
  }
  for (const [x, ls] of byContact) {
    ls.sort((a, b) => at(a.t).x - at(b.t).x || a.t.localeCompare(b.t));
    ls.forEach((l, k) => (l.bx = at(x).x + (k - (ls.length - 1) / 2) * DROP_STEP));
  }

  // Each row of contacts has a bus per target above it; buses that would run
  // along each other take parallel lanes.
  const rows = new Map<string, Leg[]>();
  for (const l of legs) {
    const k = `${l.dir}:${Math.round(at(l.x).y)}`;
    if (!rows.has(k)) rows.set(k, []);
    rows.get(k)!.push(l);
  }
  for (const [k, ls] of rows) {
    const dir = ls[0].dir;
    const y = Number(k.split(':')[1]);
    const byTarget = new Map<string, Leg[]>();
    for (const l of ls) {
      if (!byTarget.has(l.t)) byTarget.set(l.t, []);
      byTarget.get(l.t)!.push(l);
    }
    const span = (t: string): [number, number] => {
      const xs = [at(t).x, ...byTarget.get(t)!.map((l) => l.bx)];
      return [Math.min(...xs), Math.max(...xs)];
    };
    const lv = levels([...byTarget.keys()], span, (a, b) => at(a).x - at(b).x || a.localeCompare(b));
    for (const [t, tl] of byTarget) for (const l of tl) l.lane = y - dir * (LANE + lv.get(t)! * LANE_STEP);
  }

  // Counts of the lines into one number stack, the nearest lane's lowest.
  const stackOf = new Map<Leg, number>();
  for (const ls of byContact.values()) {
    [...ls].sort((a, b) => Math.abs(a.lane - at(a.x).y) - Math.abs(b.lane - at(b.x).y) || a.t.localeCompare(b.t)).forEach((l, k) => stackOf.set(l, k));
  }

  const byTarget = new Map<string, Leg[]>();
  for (const l of legs) {
    if (!byTarget.has(l.t)) byTarget.set(l.t, []);
    byTarget.get(l.t)!.push(l);
  }
  for (const [t, tl] of byTarget) {
    const T = at(t);
    // Trunk: down (and up, for contacts moved above) in pieces between lanes.
    for (const side of [1, -1]) {
      const mine = tl.filter((l) => (side === 1 ? l.lane > T.y : l.lane <= T.y));
      const stops = [...new Set(mine.map((l) => l.lane))].sort((a, b) => side * (a - b));
      let from = t;
      for (const y of stops) {
        const to = bend(t, T.x, y);
        const edges = mine.filter((l) => side * (l.lane - y) >= -EPS).map((l) => l.key);
        pieces.push({ source: from, target: to, edges, kind: 'bus', owner: t });
        from = to;
      }
    }
    // Buses: along each lane, in pieces between the points where lines leave it.
    const lanes = new Map<number, Leg[]>();
    for (const l of tl) {
      if (!lanes.has(l.lane)) lanes.set(l.lane, []);
      lanes.get(l.lane)!.push(l);
    }
    for (const [y, ll] of lanes) {
      const xs = [...new Set([T.x, ...ll.map((l) => l.bx)].map(r1))].sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i++) {
        const a = xs[i];
        const b = xs[i + 1];
        if (b - a < EPS) continue;
        const left = b <= r1(T.x) + EPS;
        const edges = ll.filter((l) => (left ? r1(l.bx) <= a + EPS : r1(l.bx) >= b - EPS)).map((l) => l.key);
        pieces.push({ source: bend(t, a, y), target: bend(t, b, y), edges, kind: 'bus', owner: t });
      }
      // The last piece of each link: down into the contact.
      for (const l of ll) pieces.push({ source: bend(t, l.bx, y), target: l.x, edges: [l.key], kind: 'edge', owner: t, label: true, arrows: [l.xToT, l.tToX], stack: stackOf.get(l) ?? 0 });
    }
  }

  // Links between targets: up, along a lane above them, and down.
  const ttLevel = levels(
    tts,
    (e) => [Math.min(at(e.source).x, at(e.target).x), Math.max(at(e.source).x, at(e.target).x)],
    (a, b) => pairKey(a.source, a.target).localeCompare(pairKey(b.source, b.target)),
  );
  const exits = new Map<string, NetEdge[]>();
  for (const e of tts) {
    for (const t of [e.source, e.target]) {
      if (!exits.has(t)) exits.set(t, []);
      exits.get(t)!.push(e);
    }
  }
  const exitX = (t: string, e: NetEdge) => {
    const es = exits.get(t)!;
    const other = (f: NetEdge) => at(f.source === t ? f.target : f.source).x;
    const sorted = [...es].sort((a, b) => other(a) - other(b) || pairKey(a.source, a.target).localeCompare(pairKey(b.source, b.target)));
    return at(t).x + (sorted.indexOf(e) - (es.length - 1) / 2) * DROP_STEP;
  };
  tts.forEach((e, i) => {
    const key = pairKey(e.source, e.target);
    const A = at(e.source);
    const B = at(e.target);
    const y = Math.min(A.y, B.y) - (TT_LANE + ttLevel.get(e)! * LANE_STEP);
    const a = bend(`tt${i}`, exitX(e.source, e), y);
    const b = bend(`tt${i}`, exitX(e.target, e), y);
    pieces.push({ source: e.source, target: a, edges: [key], kind: 'edge', arrows: [e.ba > 0, false] });
    pieces.push({ source: a, target: b, edges: [key], kind: 'edge', label: true });
    pieces.push({ source: b, target: e.target, edges: [key], kind: 'edge', arrows: [false, e.ab > 0] });
  });

  return { bends, pieces };
}

/** A target's org-chart branch: spines hanging below it, relative to the target. */
export interface Comb {
  /** x of each spine, from the target. */
  spines: number[];
  /** y of the bar joining several spines, from the target. */
  bus: number;
}

/**
 * Organization chart: a target's own contacts below it hang off its spines
 * on short level stubs (the stub carries the link's count and arrows);
 * shared contacts and links between targets go as in a hierarchy.
 */
export function routeOrg(net: Network, pos: Map<string, Point>, combs: Map<string, Comb>): Routes {
  const targets = new Set(net.nodes.filter((n) => n.isTarget).map((n) => n.id));
  const at = (id: string) => pos.get(id) ?? { x: 0, y: 0 };

  // A contact of one target only, below it, hangs on that target's spines.
  const toTargets = new Map<string, NetEdge[]>();
  for (const e of net.edges) {
    const st = targets.has(e.source);
    if (st === targets.has(e.target)) continue;
    const x = st ? e.target : e.source;
    if (!toTargets.has(x)) toTargets.set(x, []);
    toTargets.get(x)!.push(e);
  }
  interface Hang {
    x: string;
    key: string;
    tToX: boolean;
    xToT: boolean;
    spine: number;
  }
  const hangs = new Map<string, Hang[]>();
  const combEdges = new Set<NetEdge>();
  for (const [x, es] of toTargets) {
    if (es.length !== 1) continue;
    const e = es[0];
    const st = targets.has(e.source);
    const t = st ? e.source : e.target;
    const comb = combs.get(t);
    if (!comb?.spines.length || at(x).y <= at(t).y) continue;
    combEdges.add(e);
    const xs = comb.spines.map((dx) => at(t).x + dx);
    let spine = 0;
    xs.forEach((sx, i) => Math.abs(sx - at(x).x) < Math.abs(xs[spine] - at(x).x) && (spine = i));
    if (!hangs.has(t)) hangs.set(t, []);
    hangs.get(t)!.push({ x, key: pairKey(e.source, e.target), tToX: st ? e.ab > 0 : e.ba > 0, xToT: st ? e.ba > 0 : e.ab > 0, spine });
  }

  const { bends, pieces } = routeTree({ ...net, edges: net.edges.filter((e) => !combEdges.has(e)) }, pos);
  const bend = (owner: string, x: number, y: number) => {
    const id = `__comb:${owner}:${r1(x)}:${r1(y)}`;
    if (!bends.has(id)) bends.set(id, { x, y });
    return id;
  };

  for (const [t, hs] of hangs) {
    const T = at(t);
    const comb = combs.get(t)!;
    const xs = comb.spines.map((dx) => T.x + dx);
    const busY = T.y + comb.bus;
    const used = [...new Set(hs.map((h) => h.spine))].sort((a, b) => a - b);
    // Several spines (or one off to the side): down from the target to a bar, along it to each.
    const tops = new Map<number, string>();
    if (xs.length === 1 && Math.abs(xs[0] - T.x) < EPS) tops.set(0, t);
    else {
      const top = bend(t, T.x, busY);
      pieces.push({ source: t, target: top, edges: hs.map((h) => h.key), kind: 'bus', owner: t });
      const stops = [...new Set([T.x, ...used.map((i) => xs[i])].map(r1))].sort((a, b) => a - b);
      for (let i = 0; i + 1 < stops.length; i++) {
        const [a, b] = [stops[i], stops[i + 1]];
        if (b - a < EPS) continue;
        const left = b <= r1(T.x) + EPS;
        const edges = hs.filter((h) => (left ? r1(xs[h.spine]) <= a + EPS : r1(xs[h.spine]) >= b - EPS)).map((h) => h.key);
        pieces.push({ source: bend(t, a, busY), target: bend(t, b, busY), edges, kind: 'bus', owner: t });
      }
      for (const i of used) tops.set(i, bend(t, xs[i], busY));
    }
    // Down each spine in pieces between the stubs, then a stub to each contact.
    for (const i of used) {
      const mine = hs.filter((h) => h.spine === i);
      const ys = [...new Set(mine.map((h) => r1(at(h.x).y)))].sort((a, b) => a - b);
      let from = tops.get(i)!;
      for (const y of ys) {
        const to = bend(t, xs[i], y);
        pieces.push({ source: from, target: to, edges: mine.filter((h) => r1(at(h.x).y) >= y - EPS).map((h) => h.key), kind: 'bus', owner: t });
        from = to;
      }
      for (const h of mine) pieces.push({ source: bend(t, xs[i], r1(at(h.x).y)), target: h.x, edges: [h.key], kind: 'edge', owner: t, label: true, arrows: [h.xToT, h.tToX] });
    }
  }
  return { bends, pieces };
}

/** Contacts shared by the same targets, whose links are joined into one trunk to each. */
export interface Bundle {
  targets: string[];
  members: string[];
}

/** A bundle's spines stand this far either side of its contacts (the nearest one). */
export const SPINE_GAP = 100;
/** Further spines on the same side stand this much further out, one after another. */
export const SPINE_LANE = 25;
/** A spine runs on this far past its last contact, to where its trunk meets it. */
export const SPINE_JOIN = 34;
/** Where trunks meet spines on one side: each a step further from the contacts than the next one out. */
export const JOIN_STEP = 22;
/** Stubs into one contact from spines on the same side run this far apart, so they do not lie on one another. */
export const STUB_SPREAD = 6;

/**
 * Which side of a bundle's column each of its targets takes, nearest spine
 * first: targets left of the column on the left, the rest on the right (each
 * side keeps at least one when there are two or more). On a side, the target
 * seen most steeply above or below takes the spine nearest the column, so the
 * trunks fan out without crossing.
 */
export function ladderSides(targets: string[], at: (id: string) => Point, colX: number, midY: number): { left: string[]; right: string[] } {
  const sorted = [...targets].sort((p, q) => at(p).x - at(q).x || p.localeCompare(q));
  const n = sorted.length;
  const nLeft = Math.max(n >= 2 ? 1 : 0, Math.min(n >= 2 ? n - 1 : n, sorted.filter((t) => at(t).x < colX).length));
  const steep = (t: string) => Math.abs(at(t).y - midY) / (Math.abs(at(t).x - colX) + 1);
  const inner = (list: string[]) => list.sort((p, q) => steep(q) - steep(p) || p.localeCompare(q));
  return { left: inner(sorted.slice(0, nLeft)), right: inner(sorted.slice(nLeft)) };
}

/**
 * Where a side's trunks meet its spines (nearest spine first): at the end of
 * the column nearer each target, past the last contact; spines further out
 * meet theirs nearer the column, so a trunk to a spine further in passes
 * beyond the ends of those further out.
 */
export function ladderJoins(side: string[], at: (id: string) => Point, top: number, bottom: number): number[] {
  const mid = (top + bottom) / 2;
  const fromTop = side.map((t) => at(t).y < mid);
  return side.map((_, i) => {
    const same = side.map((__, j) => j).filter((j) => fromTop[j] === fromTop[i]);
    const further = same.filter((j) => j > i).length;
    return fromTop[i] ? top - SPINE_JOIN - further * JOIN_STEP : bottom + SPINE_JOIN + further * JOIN_STEP;
  });
}

/**
 * Bundled links (Peacock with many targets), tidy as a ladder: beside each
 * bundle's column of contacts stands a straight up-and-down spine for each of
 * its targets (see ladderSides), level stubs run from a spine to its contacts
 * (each stub carries its link's count and arrows), and one trunk runs from
 * the spine's end nearer the target to the target. Every other link is drawn
 * straight (links between neighbouring targets bowed by `curves`). Worked out
 * from where the numbers are, so it follows numbers moved by hand.
 */
export function routeBundles(net: Network, pos: Map<string, Point>, bundles: Bundle[], curves?: Map<string, number>): Routes {
  const bends = new Map<string, Point>();
  const pieces: RoutePiece[] = [];
  const at = (id: string) => pos.get(id) ?? { x: 0, y: 0 };
  const byKey = new Map(net.edges.map((e) => [pairKey(e.source, e.target), e]));
  const done = new Set<string>();
  bundles.forEach((bd, i) => {
    const pts = bd.members.map(at);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
    const [xMin, xMax] = [Math.min(...xs), Math.max(...xs)];
    const { left, right } = ladderSides(bd.targets, at, (xMin + xMax) / 2, (top + bottom) / 2);
    for (const [side, base, dir] of [
      [left, xMin, -1],
      [right, xMax, 1],
    ] as const) {
      const joins = ladderJoins(side, at, top, bottom);
      side.forEach((t, lane) => {
        const x = base + dir * (SPINE_GAP + lane * SPINE_LANE);
        const dy = (lane - (side.length - 1) / 2) * STUB_SPREAD;
        const fromTop = joins[lane] < top;
        const join = `__bundle:${i}:${t}`;
        bends.set(join, { x, y: joins[lane] });
        // Stops down the spine, nearest the trunk first.
        const stops: { id: string; y: number; key: string }[] = [];
        bd.members.forEach((m, j) => {
          const key = pairKey(m, t);
          const e = byKey.get(key);
          if (!e) return;
          done.add(key);
          const stop = `${join}:${j}`;
          bends.set(stop, { x, y: pts[j].y + dy });
          stops.push({ id: stop, y: pts[j].y + dy, key });
          const mFirst = e.source === m;
          pieces.push({ source: stop, target: m, edges: [key], kind: 'edge', owner: t, label: true, stack: lane, arrows: [mFirst ? e.ab > 0 : e.ba > 0, mFirst ? e.ba > 0 : e.ab > 0] });
        });
        if (!stops.length) return;
        stops.sort((p, q) => (fromTop ? p.y - q.y : q.y - p.y));
        pieces.push({ source: t, target: join, edges: stops.map((st) => st.key), kind: 'bus', owner: t });
        // The spine, stop by stop: each stretch carries the links beyond it.
        stops.forEach((st, j) => pieces.push({ source: j ? stops[j - 1].id : join, target: st.id, edges: stops.slice(j).map((o) => o.key), kind: 'bus', owner: t }));
      });
    }
  });
  for (const e of net.edges) {
    const key = pairKey(e.source, e.target);
    if (done.has(key)) continue;
    pieces.push({ source: e.source, target: e.target, edges: [key], kind: 'edge', label: true, arrows: [e.ba > 0, e.ab > 0], curve: curves?.get(`${e.source}\u0000${e.target}`) });
  }
  return { bends, pieces };
}
