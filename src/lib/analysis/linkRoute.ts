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
  const bends = new Map<string, Point>();
  const pieces: RoutePiece[] = [];
  const at = (id: string) => pos.get(id) ?? { x: 0, y: 0 };
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
