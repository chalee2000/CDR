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
  /** A bridge between two neighbours, just inside the ellipse (its trunks are short and go straight). */
  rim?: boolean;
}

/**
 * The ring road round the outside of the targets' ellipse (half-axes a, b)
 * that links between targets which are not neighbours follow: its first lane
 * `gap` outside the ellipse, each further lane `step` further out.
 */
export interface Road {
  a: number;
  b: number;
  gap: number;
  step: number;
}

/** A target's angle round an ellipse (half-axes a, b), as the ellipse's own parameter. */
const roadAngle = (p: Point, road: Road) => Math.atan2(p.y / road.b, p.x / road.a);
const TAU = 2 * Math.PI;
const norm = (x: number) => ((x % TAU) + TAU) % TAU;

/**
 * Each link between two targets on the ring road: it runs the shorter way
 * round, on the lowest lane free of every other link it would run alongside
 * (shorter runs nearer the ellipse, so runs nest instead of crossing).
 */
export function roadPlan(pairs: [string, string][], at: (id: string) => Point, road: Road): Map<string, { lane: number; t0: number; dt: number }> {
  const arcs = pairs.map(([p, q]) => {
    const t0 = roadAngle(at(p), road);
    let dt = norm(roadAngle(at(q), road) - t0);
    if (dt > Math.PI) dt -= TAU;
    return { key: pairKey(p, q), t0, dt, lo: norm(dt >= 0 ? t0 : t0 + dt), len: Math.abs(dt) + 0.08 };
  });
  arcs.sort((p, q) => p.len - q.len || p.key.localeCompare(q.key));
  const lanes: (typeof arcs)[] = [];
  const out = new Map<string, { lane: number; t0: number; dt: number }>();
  const within = (x: number, arc: (typeof arcs)[number]) => norm(x - arc.lo) <= arc.len;
  for (const arc of arcs) {
    let lane = lanes.findIndex((others) => others.every((o) => !within(arc.lo, o) && !within(o.lo, arc)));
    if (lane < 0) lane = lanes.push([]) - 1;
    lanes[lane].push(arc);
    out.set(arc.key, { lane, t0: arc.t0, dt: arc.dt });
  }
  return out;
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
 * The ladders of bundled contacts (see routeBundles): beside each column a
 * spine for each target, level stubs from it to the contacts (each carrying
 * its link's count and arrows), stop by stop. Returns the trunks still to be
 * laid, one per target and ladder, from the target to where it meets its
 * spine (`join`), and the links done.
 */
function ladderParts(net: Network, at: (id: string) => Point, bundles: Bundle[]) {
  const bends = new Map<string, Point>();
  const pieces: RoutePiece[] = [];
  const byKey = new Map(net.edges.map((e) => [pairKey(e.source, e.target), e]));
  const done = new Set<string>();
  // Trunks, laid once every target's cable is known.
  const trunks: { t: string; join: string; keys: string[]; rim: boolean }[] = [];
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
        trunks.push({ t, join, keys: stops.map((st) => st.key), rim: !!bd.rim });
        // The spine, stop by stop: each stretch carries the links beyond it.
        stops.forEach((st, j) => pieces.push({ source: j ? stops[j - 1].id : join, target: st.id, edges: stops.slice(j).map((o) => o.key), kind: 'bus', owner: t }));
      });
    }
  });
  return { bends, pieces, trunks, done };
}

/** A target's links into the chart part from one cable this far in (as a share of the way to where they go), within these bounds. */
const SPLIT_SHARE = 0.3;
const SPLIT_MIN = 75;
const SPLIT_MAX = 250;
/** The ring road bends at least this often (radians), so it follows the ellipse. */
const ROAD_BEND = (6 * Math.PI) / 180;

/**
 * Bundled links (Peacock with many targets), tidy as a ladder: beside each
 * bundle's column of contacts stands a straight up-and-down spine for each of
 * its targets (see ladderSides), level stubs run from a spine to its contacts
 * (each stub carries its link's count and arrows), and one trunk runs from
 * the spine's end nearer the target to the target.
 *
 * A target's links into the chart (trunks to ladders inside, links to
 * contacts on their own) leave it as one cable and part a little way in.
 * Links between neighbouring targets bow out (`curves`); with a `road`, links
 * between other targets run round the outside on it; anything else is drawn
 * straight. Worked out from where the numbers are, so it follows numbers
 * moved by hand.
 */
export function routeBundles(net: Network, pos: Map<string, Point>, bundles: Bundle[], curves?: Map<string, number>, road?: Road): Routes {
  const at = (id: string) => pos.get(id) ?? { x: 0, y: 0 };
  const { bends, pieces, trunks, done } = ladderParts(net, at, bundles);

  const isTarget = new Set(net.nodes.filter((n) => n.isTarget).map((n) => n.id));
  const targetsOf = new Map<string, number>();
  for (const e of net.edges) {
    if (isTarget.has(e.source) === isTarget.has(e.target)) continue;
    const c = isTarget.has(e.source) ? e.target : e.source;
    targetsOf.set(c, (targetsOf.get(c) ?? 0) + 1);
  }

  // Each target's links into the chart: trunks to ladders inside, and links to shared contacts on their own.
  type Out = { t: string; to: string; point: Point; keys: string[]; e?: NetEdge };
  const outs = new Map<string, Out[]>();
  const add = (o: Out) => outs.set(o.t, [...(outs.get(o.t) ?? []), o]);
  for (const tr of trunks) {
    if (tr.rim) pieces.push({ source: tr.t, target: tr.join, edges: tr.keys, kind: 'bus', owner: tr.t });
    else add({ t: tr.t, to: tr.join, point: bends.get(tr.join)!, keys: tr.keys });
  }
  const tt: NetEdge[] = [];
  for (const e of net.edges) {
    const key = pairKey(e.source, e.target);
    if (done.has(key)) continue;
    const [s, t] = [isTarget.has(e.source), isTarget.has(e.target)];
    if (s && t) tt.push(e);
    else if (s !== t && (targetsOf.get(s ? e.target : e.source) ?? 0) >= 2) add({ t: s ? e.source : e.target, to: s ? e.target : e.source, point: at(s ? e.target : e.source), keys: [key], e });
    else pieces.push({ source: e.source, target: e.target, edges: [key], kind: 'edge', label: true, arrows: [e.ba > 0, e.ab > 0] });
  }
  const direct = (o: Out) => {
    if (!o.e) pieces.push({ source: o.t, target: o.to, edges: o.keys, kind: 'bus', owner: o.t });
    else pieces.push({ source: o.e.source, target: o.e.target, edges: o.keys, kind: 'edge', label: true, arrows: [o.e.ba > 0, o.e.ab > 0] });
  };
  for (const [t, list] of [...outs].sort((p, q) => p[0].localeCompare(q[0]))) {
    const T = at(t);
    const mid = list.reduce((acc, o) => ({ x: acc.x + o.point.x / list.length, y: acc.y + o.point.y / list.length }), { x: 0, y: 0 });
    const d = Math.hypot(mid.x - T.x, mid.y - T.y);
    const u = d ? { x: (mid.x - T.x) / d, y: (mid.y - T.y) / d } : { x: 0, y: 0 };
    const far = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, SPLIT_SHARE * d));
    // Only links going on well past the parting point share the cable.
    const ahead = (o: Out) => (o.point.x - T.x) * u.x + (o.point.y - T.y) * u.y > far + 20;
    const shared = d ? list.filter(ahead) : [];
    if (shared.length < 2) {
      list.forEach(direct);
      continue;
    }
    const split = `__split:${t}`;
    bends.set(split, { x: T.x + u.x * far, y: T.y + u.y * far });
    pieces.push({ source: t, target: split, edges: shared.flatMap((o) => o.keys), kind: 'bus', owner: t });
    for (const o of list) {
      if (!shared.includes(o)) direct(o);
      else if (!o.e) pieces.push({ source: split, target: o.to, edges: o.keys, kind: 'bus', owner: t });
      else {
        const tFirst = o.e.source === t;
        pieces.push({ source: split, target: o.to, edges: o.keys, kind: 'edge', owner: t, label: true, arrows: [(tFirst ? o.e.ba : o.e.ab) > 0, (tFirst ? o.e.ab : o.e.ba) > 0] });
      }
    }
  }

  // Links between targets: neighbours bow out, others take the ring road (or go straight).
  const curved = (e: NetEdge) => curves?.get(`${e.source}\u0000${e.target}`) ?? curves?.get(`${e.target}\u0000${e.source}`);
  const plan = road ? roadPlan(tt.filter((e) => curved(e) === undefined).map((e) => [e.source, e.target]), at, road) : new Map();
  for (const e of tt) {
    const key = pairKey(e.source, e.target);
    const way = plan.get(key);
    if (!road || !way) {
      pieces.push({ source: e.source, target: e.target, edges: [key], kind: 'edge', label: true, arrows: [e.ba > 0, e.ab > 0], curve: curves?.get(`${e.source}\u0000${e.target}`) });
      continue;
    }
    // From the source out to its lane, round, and in to the target.
    const off = road.gap + way.lane * road.step;
    const n = Math.max(1, Math.ceil(Math.abs(way.dt) / ROAD_BEND));
    const ids: string[] = [e.source];
    for (let j = 0; j <= n; j++) {
      const th = way.t0 + (way.dt * j) / n;
      const id = `__road:${key}:${j}`;
      bends.set(id, { x: (road.a + off) * Math.cos(th), y: (road.b + off) * Math.sin(th) });
      ids.push(id);
    }
    ids.push(e.target);
    const middle = Math.floor((ids.length - 1) / 2);
    for (let j = 0; j + 1 < ids.length; j++) {
      const arrows: [boolean, boolean] = [j === 0 && e.ba > 0, j === ids.length - 2 && e.ab > 0];
      pieces.push({ source: ids[j], target: ids[j + 1], edges: [key], kind: 'edge', label: j === middle, arrows });
    }
  }
  return { bends, pieces };
}

/** A cable into a disc ends this far beyond the disc's contacts that it serves. */
const CABLE_GAP = 37;

/**
 * Packed: the table of discs, for links that run along the streets between
 * them: the y of each row and x of each column (of disc centres), and of each
 * street (above the first row, between rows, below the last; left of the
 * first column, between columns, right of the last).
 */
export interface StreetGrid {
  rows: number[];
  cols: number[];
  hStreets: number[];
  vStreets: number[];
}

/** A link (or a target's links into another target's disc) along the streets, from one target to another. */
export interface StreetRun {
  key: string;
  from: string;
  to: string;
}

/** Lanes of a street lie this far apart. */
export const STREET_STEP = 9;
/** Lines leaving or entering a target stand this far apart. */
const LEG_STEP = 8;

const nearestIndex = (list: number[], v: number) => list.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(list[best] - v) ? i : best), 0);

/**
 * The streets a run takes: out of its target straight up or down to the
 * street on the side facing the other (for targets in the same row, the
 * street on the outside of the table, or above a middle row), along it, and
 * (for rows further apart) down the street between columns beside the first
 * target to the street on the near side of the second, then along that.
 */
function streetsOf(run: StreetRun, at: (id: string) => Point, grid: StreetGrid): { h1: number; v?: number; h2: number } {
  const [U, T] = [at(run.from), at(run.to)];
  const [ru, rt] = [nearestIndex(grid.rows, U.y), nearestIndex(grid.rows, T.y)];
  const last = grid.rows.length - 1;
  if (ru === rt) {
    const h = ru === last && last > 0 ? last + 1 : ru;
    return { h1: h, h2: h };
  }
  const h1 = ru < rt ? ru + 1 : ru;
  const h2 = ru < rt ? rt : rt + 1;
  if (h1 === h2) return { h1, h2 };
  const [cu, ct] = [nearestIndex(grid.cols, U.x), nearestIndex(grid.cols, T.x)];
  const v = ct > cu ? cu + 1 : ct < cu ? cu : cu + 1 < grid.vStreets.length - 1 ? cu + 1 : cu;
  return { h1, v, h2 };
}

/**
 * Lanes for runs along the streets: on each street, runs that would lie
 * along each other take different lanes. Returns each run's streets and
 * lanes, and how many lanes each street has.
 */
export function planStreets(runs: StreetRun[], at: (id: string) => Point, grid: StreetGrid) {
  const ways = new Map(runs.map((r) => [r.key, streetsOf(r, at, grid)]));
  const along: { street: string; run: StreetRun; part: 'h1' | 'v' | 'h2'; lo: number; hi: number }[] = [];
  for (const r of runs) {
    const w = ways.get(r.key)!;
    const [U, T] = [at(r.from), at(r.to)];
    const vx = w.v !== undefined ? grid.vStreets[w.v] : T.x;
    along.push({ street: `h${w.h1}`, run: r, part: 'h1', lo: Math.min(U.x, vx), hi: Math.max(U.x, vx) });
    if (w.v !== undefined) {
      const [y1, y2] = [grid.hStreets[w.h1], grid.hStreets[w.h2]];
      along.push({ street: `v${w.v}`, run: r, part: 'v', lo: Math.min(y1, y2), hi: Math.max(y1, y2) });
      along.push({ street: `h${w.h2}`, run: r, part: 'h2', lo: Math.min(vx, T.x), hi: Math.max(vx, T.x) });
    }
  }
  const lanes = new Map<string, number>();
  const counts = new Map<string, number>();
  const byStreet = new Map<string, typeof along>();
  for (const a of along) byStreet.set(a.street, [...(byStreet.get(a.street) ?? []), a]);
  for (const [street, list] of byStreet) {
    const level = levels(list, (a) => [a.lo, a.hi], (a, b) => a.run.key.localeCompare(b.run.key) || a.part.localeCompare(b.part));
    for (const [a, l] of level) lanes.set(`${a.run.key}:${a.part}`, l);
    counts.set(street, Math.max(...level.values()) + 1);
  }
  return { ways, lanes, counts };
}

/** The runs along the streets of a packed chart: each link between targets, and each target's links into another target's disc. */
export function streetRuns(net: Network, homes: Map<string, string>): { runs: StreetRun[]; into: Map<string, NetEdge[]>; tt: Map<string, NetEdge>; straight: NetEdge[] } {
  const isTarget = new Set(net.nodes.filter((n) => n.isTarget).map((n) => n.id));
  const into = new Map<string, NetEdge[]>();
  const tt = new Map<string, NetEdge>();
  const straight: NetEdge[] = [];
  const runs: StreetRun[] = [];
  for (const e of net.edges) {
    const [s, t] = [isTarget.has(e.source), isTarget.has(e.target)];
    if (s && t) {
      if (e.source === e.target) continue;
      const key = pairKey(e.source, e.target);
      tt.set(key, e);
      runs.push({ key, from: e.source, to: e.target });
      continue;
    }
    if (!s && !t) {
      straight.push(e);
      continue;
    }
    const [from, c] = s ? [e.source, e.target] : [e.target, e.source];
    const home = homes.get(c);
    if (!home || home === from) {
      straight.push(e);
      continue;
    }
    const key = `${from}>${home}`;
    if (!into.has(key)) {
      into.set(key, []);
      runs.push({ key, from, to: home });
    }
    into.get(key)!.push(e);
  }
  runs.sort((p, q) => p.key.localeCompare(q.key));
  return { runs, into, tt, straight };
}

/**
 * Packed, tidy as a circuit board: links between targets, and a target's
 * links into another target's disc (to the contacts that live there, see
 * packedLayout), run along the streets between the discs on lanes of their
 * own (see streetsOf), at right angles. A target's runs into other discs
 * leave it together, up or down, as one cable; runs arrive at a disc side by
 * side and end just outside it, where a cable parts to each contact (the
 * short branch carries the link's count and arrows). Links between targets
 * run whole, with their arrows at the targets. A contact's link to the target
 * it lives with, and lone links, are straight. Worked out from where the
 * numbers are, so it follows numbers moved by hand.
 */
export function routeStreets(net: Network, pos: Map<string, Point>, homes: Map<string, string>, grid: StreetGrid): Routes {
  const bends = new Map<string, Point>();
  const pieces: RoutePiece[] = [];
  const at = (id: string) => pos.get(id) ?? { x: 0, y: 0 };
  const { runs, into, tt, straight } = streetRuns(net, homes);
  for (const e of straight) pieces.push({ source: e.source, target: e.target, edges: [pairKey(e.source, e.target)], kind: 'edge', label: true, arrows: [e.ba > 0, e.ab > 0] });
  const { ways, lanes, counts } = planStreets(runs, at, grid);
  const laneAt = (street: 'h' | 'v', i: number, lane: number) => {
    const base = street === 'h' ? grid.hStreets[i] : grid.vStreets[i];
    return base + (lane - ((counts.get(`${street}${i}`) ?? 1) - 1) / 2) * STREET_STEP;
  };
  const yOf = (r: StreetRun) => laneAt('h', ways.get(r.key)!.h1, lanes.get(`${r.key}:h1`)!);
  const yEnd = (r: StreetRun) => {
    const w = ways.get(r.key)!;
    return w.v !== undefined ? laneAt('h', w.h2, lanes.get(`${r.key}:h2`)!) : yOf(r);
  };
  const isTt = (r: StreetRun) => tt.has(r.key);
  const side = (id: string, y: number) => (y < at(id).y ? -1 : 1);

  // Where each run leaves its target: cables from one target on one side
  // share its centre line; links between targets each have a line of their own.
  const outX = new Map<string, number>();
  const inX = new Map<string, number>();
  const legs = (list: { r: StreetRun; y: number; toward: number }[], centre: number, own: boolean) => {
    // Lines coming from the left take the left, those whose lane is further take the places nearer the centre.
    const left = list.filter((l) => l.toward < centre).sort((p, q) => Math.abs(q.y) - Math.abs(p.y) || p.r.key.localeCompare(q.r.key));
    const right = list.filter((l) => l.toward >= centre).sort((p, q) => Math.abs(q.y) - Math.abs(p.y) || p.r.key.localeCompare(q.r.key));
    const out = new Map<string, number>();
    left.forEach((l, i) => out.set(l.r.key, centre - (i + (own ? 1 : 0.5)) * LEG_STEP));
    right.forEach((l, i) => out.set(l.r.key, centre + (i + (own ? 1 : 0.5)) * LEG_STEP));
    return out;
  };
  const targets = [...new Set(runs.flatMap((r) => [r.from, r.to]))].sort();
  for (const t of targets) {
    const T = at(t);
    for (const s of [-1, 1]) {
      const leaving = runs.filter((r) => r.from === t && side(t, yOf(r)) === s);
      const arriving = runs.filter((r) => r.to === t && side(t, yEnd(r)) === s);
      const cables = leaving.filter((r) => !isTt(r));
      for (const r of cables) outX.set(r.key, T.x);
      const toward = (r: StreetRun, from: boolean) => {
        const w = ways.get(r.key)!;
        if (from) return w.v !== undefined ? grid.vStreets[w.v] : at(r.to).x;
        return w.v !== undefined ? grid.vStreets[w.v] : at(r.from).x;
      };
      // Lines of their own: links between targets leaving, and everything arriving.
      const own = [
        ...leaving.filter(isTt).map((r) => ({ r, y: yOf(r) - T.y, toward: toward(r, true), dir: 'out' as const })),
        ...arriving.map((r) => ({ r: { ...r, key: `${r.key}#in` }, y: yEnd(r) - T.y, toward: toward(r, false), dir: 'in' as const })),
      ];
      for (const [key, x] of legs(own, T.x, cables.length > 0)) {
        if (key.endsWith('#in')) inX.set(key.slice(0, -3), x);
        else outX.set(key, x);
      }
    }
  }

  // Cables leaving a target on one side: one line out, parting at each lane.
  for (const t of targets) {
    for (const s of [-1, 1]) {
      const cables = runs.filter((r) => r.from === t && !isTt(r) && side(t, yOf(r)) === s).sort((p, q) => Math.abs(yOf(p) - at(t).y) - Math.abs(yOf(q) - at(t).y) || p.key.localeCompare(q.key));
      let prev = t;
      cables.forEach((r, i) => {
        const id = `__street:${r.key}:out`;
        bends.set(id, { x: at(t).x, y: yOf(r) });
        pieces.push({ source: prev, target: id, edges: cables.slice(i).flatMap((c) => into.get(c.key)!.map((e) => pairKey(e.source, e.target))), kind: 'bus', owner: t });
        prev = id;
      });
    }
  }

  for (const r of runs) {
    const w = ways.get(r.key)!;
    const T = at(r.to);
    const xOut = outX.get(r.key)!;
    const xIn = inX.get(r.key)!;
    const y1 = yOf(r);
    const y2 = yEnd(r);
    const pts: Point[] = [];
    pts.push({ x: xOut, y: y1 });
    if (w.v !== undefined) {
      const vx = laneAt('v', w.v, lanes.get(`${r.key}:v`)!);
      pts.push({ x: vx, y: y1 }, { x: vx, y: y2 });
    }
    pts.push({ x: xIn, y: y2 });
    const ids = pts.map((p, i) => {
      const id = i === 0 && !isTt(r) ? `__street:${r.key}:out` : `__street:${r.key}:${i}`;
      if (!bends.has(id)) bends.set(id, p);
      return id;
    });
    if (isTt(r)) {
      const e = tt.get(r.key)!;
      // The whole link, from target to target, its count on the longest stretch.
      const fromSource = e.source === r.from;
      const path = [r.from, ...ids, r.to];
      const where = (id: string) => bends.get(id) ?? at(id);
      const len = (i: number) => Math.hypot(where(path[i + 1]).x - where(path[i]).x, where(path[i + 1]).y - where(path[i]).y);
      let longest = 1;
      for (let i = 1; i < path.length - 2; i++) if (len(i) > len(longest)) longest = i;
      for (let i = 0; i + 1 < path.length; i++) {
        const arrows: [boolean, boolean] = [i === 0 && (fromSource ? e.ba : e.ab) > 0, i === path.length - 2 && (fromSource ? e.ab : e.ba) > 0];
        pieces.push({ source: path[i], target: path[i + 1], edges: [r.key], kind: 'edge', label: i === longest, arrows });
      }
      continue;
    }
    // A cable: along the streets, down to just outside the disc, then a branch to each contact.
    const links = into.get(r.key)!;
    const keys = links.map((e) => pairKey(e.source, e.target));
    const contact = (e: NetEdge) => (e.source === r.from ? e.target : e.source);
    const s = side(r.to, y2);
    const reach = Math.max(...links.map((e) => (at(contact(e)).y - T.y) * s));
    const endY = T.y + s * Math.max(reach + CABLE_GAP, 0.5 * Math.abs(y2 - T.y));
    const end = `__street:${r.key}:end`;
    bends.set(end, { x: xIn, y: Math.abs(endY - T.y) < Math.abs(y2 - T.y) ? endY : y2 });
    const path = [...ids, end];
    for (let i = 0; i + 1 < path.length; i++) pieces.push({ source: path[i], target: path[i + 1], edges: keys, kind: 'bus', owner: r.from });
    for (const e of links) {
      const fFirst = e.source === r.from;
      pieces.push({ source: end, target: contact(e), edges: [pairKey(e.source, e.target)], kind: 'edge', owner: r.from, label: true, arrows: [(fFirst ? e.ba : e.ab) > 0, (fFirst ? e.ab : e.ba) > 0] });
    }
  }
  return { bends, pieces };
}

/**
 * Organization with only shared contacts: the y of the targets' row, and of
 * the first lane above it (`up`) and below it (`down`); lanes go on outwards.
 */
export interface OrgBands {
  row: number;
  up: number;
  down: number;
}

/** Lanes of an org chart's bands lie this far apart. */
export const ORG_LANE_STEP = 9;

type OrgRun = { key: string; band: 'up' | 'down'; lo: number; hi: number; tt: boolean; t?: string; join?: string; keys?: string[]; e?: NetEdge };

/**
 * The runs of an org chart of ladders and their lanes: a trunk from each
 * target to each of its ladders, in the band (above or below the row) the
 * ladder stands in, and links between targets, below the row on the lanes
 * nearest it. Runs that would lie along each other take different lanes.
 */
function orgPlan(net: Network, at: (id: string) => Point, trunks: { t: string; join: string; keys: string[] }[], bends: Map<string, Point>, done: Set<string>, bands: OrgBands) {
  const isTarget = new Set(net.nodes.filter((n) => n.isTarget).map((n) => n.id));
  const runs: OrgRun[] = [];
  for (const tr of trunks) {
    const [T, J] = [at(tr.t), bends.get(tr.join)!];
    runs.push({ key: `${tr.t}>${tr.join}`, band: J.y < bands.row ? 'up' : 'down', lo: Math.min(T.x, J.x), hi: Math.max(T.x, J.x), tt: false, t: tr.t, join: tr.join, keys: tr.keys });
  }
  for (const e of net.edges) {
    const key = pairKey(e.source, e.target);
    if (done.has(key) || !isTarget.has(e.source) || !isTarget.has(e.target) || e.source === e.target) continue;
    const [a, b] = [at(e.source), at(e.target)];
    runs.push({ key, band: 'down', lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), tt: true, e });
  }
  const lanes = new Map<string, number>();
  const counts = { up: 0, down: 0 };
  for (const band of ['up', 'down'] as const) {
    let offset = 0;
    for (const tt of [true, false]) {
      const list = runs.filter((r) => r.band === band && r.tt === tt);
      if (!list.length) continue;
      const level = levels(list, (r) => [r.lo, r.hi], (p, q) => p.key.localeCompare(q.key));
      for (const [r, l] of level) lanes.set(r.key, offset + l);
      offset += Math.max(...level.values()) + 1;
    }
    counts[band] = offset;
  }
  return { runs, lanes, counts };
}

/** How many lanes an org chart of ladders needs above and below its targets' row. */
export function orgLaneCounts(net: Network, pos: Map<string, Point>, bundles: Bundle[], bands: OrgBands) {
  const at = (id: string) => pos.get(id) ?? { x: 0, y: 0 };
  const { bends, trunks, done } = ladderParts(net, at, bundles);
  return orgPlan(net, at, trunks, bends, done, bands).counts;
}

/**
 * Organization with only shared contacts, tidy as an org chart: the targets
 * in a row, their shared contacts on ladders (see routeBundles) above and
 * below it. From each target one line goes up (and one down), parting at
 * each lane into a run along it to a ladder's spine, which it meets from the
 * row's side. Links between targets run below the row on their own lanes,
 * whole, with their arrows at the targets. Worked out from where the numbers
 * are, so it follows numbers moved by hand.
 */
export function routeOrgLadders(net: Network, pos: Map<string, Point>, bundles: Bundle[], bands: OrgBands): Routes {
  const at = (id: string) => pos.get(id) ?? { x: 0, y: 0 };
  const { bends, pieces, trunks, done } = ladderParts(net, at, bundles);
  const { runs, lanes } = orgPlan(net, at, trunks, bends, done, bands);
  const laneY = (r: OrgRun) => (r.band === 'up' ? bands.up - lanes.get(r.key)! * ORG_LANE_STEP : bands.down + lanes.get(r.key)! * ORG_LANE_STEP);
  // Anything else (not expected) goes straight.
  const ttKeys = new Set(runs.filter((r) => r.tt).map((r) => r.key));
  for (const e of net.edges) {
    const key = pairKey(e.source, e.target);
    if (!done.has(key) && !ttKeys.has(key)) pieces.push({ source: e.source, target: e.target, edges: [key], kind: 'edge', label: true, arrows: [e.ba > 0, e.ab > 0] });
  }
  // Trunks: one line from each target into each band, parting at each lane.
  const targets = [...new Set(runs.filter((r) => !r.tt).map((r) => r.t!))].sort();
  for (const t of targets) {
    const T = at(t);
    for (const band of ['up', 'down'] as const) {
      const mine = runs.filter((r) => !r.tt && r.t === t && r.band === band).sort((p, q) => lanes.get(p.key)! - lanes.get(q.key)! || p.key.localeCompare(q.key));
      let prev = t;
      mine.forEach((r, i) => {
        const turn = `__org:${r.key}:turn`;
        bends.set(turn, { x: T.x, y: laneY(r) });
        pieces.push({ source: prev, target: turn, edges: mine.slice(i).flatMap((o) => o.keys!), kind: 'bus', owner: t });
        prev = turn;
        const J = bends.get(r.join!)!;
        if (Math.abs(J.x - T.x) > 0.5) {
          const under = `__org:${r.key}:under`;
          bends.set(under, { x: J.x, y: laneY(r) });
          pieces.push({ source: turn, target: under, edges: r.keys!, kind: 'bus', owner: t });
          pieces.push({ source: under, target: r.join!, edges: r.keys!, kind: 'bus', owner: t });
        } else pieces.push({ source: turn, target: r.join!, edges: r.keys!, kind: 'bus', owner: t });
      });
    }
  }
  // Links between targets: down from each end on a line of its own, along a lane, and up again.
  const tts = runs.filter((r) => r.tt);
  const legX = new Map<string, number>();
  const ends = [...new Set(tts.flatMap((r) => [r.e!.source, r.e!.target]))];
  for (const t of ends) {
    const T = at(t);
    const mine = tts.filter((r) => r.e!.source === t || r.e!.target === t);
    const other = (r: OrgRun) => at(r.e!.source === t ? r.e!.target : r.e!.source).x;
    // Further lanes nearer the centre line, so legs do not cross the lanes of others.
    const left = mine.filter((r) => other(r) < T.x).sort((p, q) => lanes.get(q.key)! - lanes.get(p.key)! || p.key.localeCompare(q.key));
    const right = mine.filter((r) => other(r) >= T.x).sort((p, q) => lanes.get(q.key)! - lanes.get(p.key)! || p.key.localeCompare(q.key));
    left.forEach((r, i) => legX.set(`${r.key}@${t}`, T.x - (i + 1) * LEG_STEP));
    right.forEach((r, i) => legX.set(`${r.key}@${t}`, T.x + (i + 1) * LEG_STEP));
  }
  for (const r of tts) {
    const e = r.e!;
    const y = laneY(r);
    const [a, b] = [`__org:${r.key}:a`, `__org:${r.key}:b`];
    bends.set(a, { x: legX.get(`${r.key}@${e.source}`)!, y });
    bends.set(b, { x: legX.get(`${r.key}@${e.target}`)!, y });
    pieces.push({ source: e.source, target: a, edges: [r.key], kind: 'edge', arrows: [e.ba > 0, false] });
    pieces.push({ source: a, target: b, edges: [r.key], kind: 'edge', label: true, arrows: [false, false] });
    pieces.push({ source: b, target: e.target, edges: [r.key], kind: 'edge', arrows: [false, e.ab > 0] });
  }
  return { bends, pieces };
}
