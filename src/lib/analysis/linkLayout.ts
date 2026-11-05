import { JOIN_STEP, LANE_STEP, ladderSides, ORG_LANE_STEP, orgLaneCounts, planStreets, roadPlan, routeOrg, routeTree, SPINE_GAP, SPINE_JOIN, SPINE_LANE, STREET_STEP, streetRuns, type Bundle, type Comb, type OrgBands, type Road, type StreetGrid } from './linkRoute';
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
  /** Numbers whose label sits a line further out, so neighbours in a tight row do not collide. */
  labelLower?: Set<string>;
  /** Organization chart: each target's spines, for drawing its right-angled links. */
  combs?: Map<string, Comb>;
  /** Links between targets are drawn straight (the layout keeps their path clear). */
  straightTargetLinks?: boolean;
  /** Curveness of particular links between targets, keyed `source\u0000target` as in the network. */
  targetCurves?: Map<string, number>;
  /** Contacts sharing (much the same) targets, whose links are drawn joined into one trunk to each. */
  bundles?: Bundle[];
  /** The ring road that links between targets which are not neighbours follow round the outside. */
  road?: Road;
  /** Packed: the target in whose disc each shared contact lives. */
  homes?: Map<string, string>;
  /** Packed: the streets between the discs that links between them run along. */
  streets?: StreetGrid;
  /** Organization with only shared contacts: the targets' row and the first lanes above and below it. */
  orgBands?: OrgBands;
  /** Labels lifted (-1) or lowered (1) about a line from beside their icon. */
  labelShift?: Map<string, number>;
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
  // Many targets: their order round the ellipse, and the contacts shared by
  // each pair of neighbours (keyed by the first one's place).
  let around = order;
  let bridges = new Map<number, string[]>();
  // One end of a bridge (many targets): a target at p, its fan pointing phi.
  let endOf: (t: string, p: Point, phi: number) => BridgeEnd = (_t, p, phi) => ({ p, fanR: 0, phi });
  let targetCurves: Map<string, number> | undefined;
  let bundles: Bundle[] | undefined;
  let road: Road | undefined;
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
    // evenly spaced along it (those sharing the most contacts side by side)
    // and just far enough apart that neighbouring fans do not meet. Contacts
    // shared by two neighbours bridge the gap between them just inside the
    // ellipse; the rest go further in, on ladders of those sharing the same
    // targets or on their own.
    around = aroundTheRing(order, shared, net);
    const maxR = Math.max(RING0, ...order.map(clusterR));
    const unit = ellipseTrack(ELLIPSE, 1);
    const spots = around.map((_, i) => unit.at((unit.total * i) / k));
    let nearest = Infinity;
    spots.forEach((p, i) => (nearest = Math.min(nearest, Math.hypot(p.x - spots[(i + 1) % k].x, p.y - spots[(i + 1) % k].y))));
    let b = Math.max(300, (2.2 * maxR) / nearest);
    bridges = bridgeGroups(around, shared);
    // A bridge keeps clear of the fans and labels either side of it.
    endOf = (t, p, phi) => ({ p, fanR: clusterR(t) ? clusterR(t) + 0.6 * MIN_GAP : 0, fanSpan: span, phi, side: targetLabelSide(phi) });
    // The ellipse grows until everything shared that is not on a bridge
    // fits inside it, and (a little) until every bridge has room between its
    // two fans.
    const where = new Map(around.map((t, i) => [t, i]));
    const room = (bb: number) => {
      const at = (t: string) => ({ x: bb * spots[where.get(t)!].x, y: bb * spots[where.get(t)!].y });
      const ends = (t: string) => endOf(t, at(t), outwardAt(spots[where.get(t)!]));
      // Room for every ladder at its full spacing (closed up only if the ellipse may grow no more).
      const plan = planLadders(around, bridges, total, ends, LADDER_STEPS.slice(0, 1));
      const spilled = plan.reduce((n, l) => n + l.members.length - l.spots.length, 0);
      const items = innerItems(leftOver(shared, plan), total, links);
      const taken = plan.flatMap((l) => (l.box ? [l.box] : []));
      return { innerFit: placeInner(items, at, links, ellipseRoom(around, at, ends, bb), taken), laddersFit: !spilled, items };
    };
    // A first guess from the room the inside needs (packed loosely).
    const need = room(b).items.reduce((s, it) => {
      const { box } = innerShape(it, { x: 0, y: 0 }, LADDER_STEPS[0], () => ({ x: 0, y: 0 }));
      return s + (box.x1 - box.x0 + INNER_CLEAR) * (box.y1 - box.y0 + INNER_CLEAR);
    }, 0);
    const b0 = b;
    b = Math.max(b, Math.sqrt(need / (0.4 * Math.PI * ELLIPSE * INNER_LIMIT * INNER_LIMIT)));
    for (let i = 0; i < 30; i++) {
      const r = room(b);
      if (r.innerFit && (r.laddersFit || b >= 1.5 * b0)) break;
      b *= 1.1;
    }
    innerB = b;
    around.forEach((id, i) => {
      const p = spots[i];
      hub.set(id, { x: p.x * b, y: p.y * b });
      outward.set(id, outwardAt(p));
    });
  }
  for (const [id, p] of hub) pos.set(id, { ...p });

  let labelSide: LinkLayout['labelSide'];
  if (k > 3) {
    // A target's label goes on the side away from its fan.
    labelSide = new Map();
    for (const [id, phi] of outward) labelSide.set(id, targetLabelSide(phi));
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

  // Shared contacts: on ladders (or on their own) when there are many
  // targets, otherwise between the targets they link, strongest in the middle.
  if (k > 3) {
    const sides = (labelSide ??= new Map());
    const ends = (t: string) => endOf(t, hub.get(t)!, outward.get(t)!);
    const plan = planLadders(around, bridges, total, ends);
    placeBridges(plan, pos, sides, (bundles ??= []));
    // The other shared contacts inside: ladders of those sharing the same targets, and single contacts.
    const taken = plan.flatMap((l) => (l.box ? [l.box] : []));
    const at = (t: string) => hub.get(t)!;
    placeInner(innerItems(leftOver(shared, plan), total, links), at, links, ellipseRoom(around, at, ends, innerB), taken, { pos, labelSide: sides, bundles });
    // Neighbours' links bow out round the rim, clear of the bridge between
    // them; links across the chart stay straight.
    const place = new Map(around.map((t, i) => [t, i]));
    for (const e of net.edges) {
      const [i, j] = [place.get(e.source), place.get(e.target)];
      if (i === undefined || j === undefined) continue;
      const d = Math.abs(i - j);
      if (Math.min(d, k - d) !== 1) continue;
      const [p, q] = [hub.get(e.source)!, hub.get(e.target)!];
      // ECharts bends a link towards mid + c·(q.y − p.y, p.x − q.x).
      const out = (q.y - p.y) * (p.x + q.x) + (p.x - q.x) * (p.y + q.y);
      (targetCurves ??= new Map()).set(`${e.source}\u0000${e.target}`, out > 0 ? 0.25 : -0.25);
    }
    // With no fans round the outside (only shared contacts), links between
    // targets that are not neighbours go round the outside on a ring road,
    // clear of the middle.
    if (roadPairs(net, around).length && order.every((t) => !exclusive.get(t)!.length)) road = { a: ELLIPSE * innerB, b: innerB, gap: ROAD_GAP, step: ROAD_STEP };
  }
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
  let bounds = boundsOf(pos);
  if (road) {
    // Room for every lane of the ring road, and the counts on it.
    const lanes = Math.max(0, ...[...roadPlan(roadPairs(net, around), (t) => pos.get(t)!, road).values()].map((w) => w.lane));
    const off = road.gap + lanes * road.step + 0.5 * MIN_GAP;
    bounds = { minX: Math.min(bounds.minX, -road.a - off), maxX: Math.max(bounds.maxX, road.a + off), minY: Math.min(bounds.minY, -road.b - off), maxY: Math.max(bounds.maxY, road.b + off) };
  }
  return { pos, bounds, labelSide, ...(k > 3 ? { straightTargetLinks: true, targetCurves, ...(bundles?.length ? { bundles } : {}), ...(road ? { road } : {}) } : {}) };
}

/** Width over height of the ellipse many targets sit on (the chart box is wide). */
const ELLIPSE = 1.6;
/** The ring road's first lane stands this far outside the targets' ellipse, each further lane this much further out. */
const ROAD_GAP = 1.5 * MIN_GAP;
const ROAD_STEP = 0.5 * MIN_GAP;

/** Links between targets that are not neighbours round the ellipse (those the ring road carries). */
function roadPairs(net: Network, around: string[]): [string, string][] {
  const place = new Map(around.map((t, i) => [t, i]));
  const k = around.length;
  return net.edges
    .filter((e) => place.has(e.source) && place.has(e.target) && e.source !== e.target)
    .filter((e) => {
      const d = Math.abs(place.get(e.source)! - place.get(e.target)!);
      return Math.min(d, k - d) !== 1;
    })
    .map((e) => [e.source, e.target]);
}
/** A bridge (with the ends of its spines) starts this far inside the line between its two targets. */
const BRIDGE_START = 0.7 * MIN_GAP;
/**
 * Down a bridge's column: room for each contact's icon and the label under
 * it; a long column closes up (its labels then show as the chart is zoomed)
 * before any of its contacts are sent to the inner rings.
 */
const LADDER_STEPS = [1.9 * MIN_GAP, 1.6 * MIN_GAP, 1.35 * MIN_GAP];
/** A bridge reaches no further than this share of the way to the middle. */
const LADDER_DEPTH = 0.85;
/** Room a number's label takes (a chart is drawn at about 0.4 px a unit). */
const LABEL_W = 3 * MIN_GAP;
const LABEL_H = 0.8 * MIN_GAP;
/** From a target's centre to the edge of its icon, about. */
const TARGET_R = 0.75 * MIN_GAP;

type Side = 'top' | 'bottom' | 'left' | 'right';
interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const pad = (b: Box, m: number): Box => ({ x0: b.x0 - m, x1: b.x1 + m, y0: b.y0 - m, y1: b.y1 + m });
/** Space kept between two bridges. */
const LADDER_CLEAR = 0.3 * MIN_GAP;
/** Bridges are placed biggest first (then round the ring), so the big ones keep their room. */
const bridgeOrder = (bridges: Map<number, string[]>) => [...bridges].sort((p, q) => q[1].length - p[1].length || p[0] - q[0]);

/** A target round the ellipse: its fan points along the ellipse's outward normal. */
const outwardAt = (p: Point) => Math.atan2(p.y, p.x / (ELLIPSE * ELLIPSE));
/** A target's label goes on the side away from its fan. */
function targetLabelSide(phi: number): Side {
  const [dx, dy] = [Math.cos(phi), Math.sin(phi)];
  return dy > 0.6 ? 'top' : dy < -0.6 ? 'bottom' : dx > 0 ? 'left' : 'right';
}
/** A target's icon and its label. */
function targetBoxes(p: Point, side?: Side): Box[] {
  const icon = { x0: p.x - TARGET_R, x1: p.x + TARGET_R, y0: p.y - TARGET_R, y1: p.y + TARGET_R };
  const label =
    side === 'left'
      ? { x0: p.x - TARGET_R - LABEL_W, x1: p.x, y0: p.y - LABEL_H / 2, y1: p.y + LABEL_H / 2 }
      : side === 'right'
        ? { x0: p.x, x1: p.x + TARGET_R + LABEL_W, y0: p.y - LABEL_H / 2, y1: p.y + LABEL_H / 2 }
        : side === 'top'
          ? { x0: p.x - LABEL_W / 2, x1: p.x + LABEL_W / 2, y0: p.y - TARGET_R - LABEL_H, y1: p.y }
          : { x0: p.x - LABEL_W / 2, x1: p.x + LABEL_W / 2, y0: p.y, y1: p.y + TARGET_R + LABEL_H };
  return [icon, label];
}

/** One end of a bridge: a target, its fan (radius, pointing phi, spanning fanSpan), where its label is. */
interface BridgeEnd {
  p: Point;
  fanR: number;
  phi: number;
  fanSpan?: number;
  side?: Side;
}

/** Whether a box reaches into a target's fan (its icons, outward of the target). */
function inFan(box: Box, end: BridgeEnd): boolean {
  if (!end.fanR) return false;
  const { p, fanR, phi } = end;
  // Nowhere near the fan.
  if (Math.hypot(Math.max(box.x0 - p.x, 0, p.x - box.x1), Math.max(box.y0 - p.y, 0, p.y - box.y1)) >= fanR) return false;
  if (p.x > box.x0 && p.x < box.x1 && p.y > box.y0 && p.y < box.y1) return true;
  const step = 0.2 * MIN_GAP;
  const hit = (x: number, y: number) => {
    const d = Math.hypot(x - p.x, y - p.y);
    if (d >= fanR) return false;
    let off = Math.abs(Math.atan2(y - p.y, x - p.x) - phi) % (2 * Math.PI);
    if (off > Math.PI) off = 2 * Math.PI - off;
    // An icon at the end of the fan reaches a little past it.
    return off < (end.fanSpan ?? Math.PI) / 2 + Math.asin(Math.min(1, (0.6 * MIN_GAP) / Math.max(d, 1)));
  };
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  for (let i = 0; i <= Math.ceil(w / step); i++) {
    const x = box.x0 + Math.min(w, i * step);
    if (hit(x, box.y0) || hit(x, box.y1)) return true;
  }
  for (let i = 0; i <= Math.ceil(h / step); i++) {
    const y = box.y0 + Math.min(h, i * step);
    if (hit(box.x0, y) || hit(box.x1, y)) return true;
  }
  return false;
}

/**
 * Where a bridge of n contacts goes between two targets: one column straight
 * up and down, with a spine either side of it (see routeBundles), just inside
 * the line between the targets, between their fans, clear of their labels
 * and of the bridges already `taken`, and no more than about half way to the
 * middle (the box it takes up comes back with it). Strongest first, nearest
 * the line. Undefined when it does not fit.
 */
function ladderSpots(n: number, A: BridgeEnd, B: BridgeEnd, taken: Box[] = [], steps = LADDER_STEPS): { spots: Point[]; box: Box } | undefined {
  for (const step of steps) {
    const ladder = ladderAt(n, step, A, B, taken);
    if (ladder) return ladder;
  }
  return undefined;
}

/** A ladder of n contacts, step apart (see ladderSpots). */
function ladderAt(n: number, gap: number, A: BridgeEnd, B: BridgeEnd, taken: Box[]): { spots: Point[]; box: Box } | undefined {
  const [p, q] = [A.p, B.p];
  const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  const u = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
  const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  // The normal pointing into the chart.
  let nIn = { x: -u.y, y: u.x };
  if (nIn.x * mid.x + nIn.y * mid.y > 0) nIn = { x: -nIn.x, y: -nIn.y };
  const down = nIn.y >= 0 ? 1 : -1;
  const proj = (v: Point, d: Point) => v.x * d.x + v.y * d.y;
  // The column (relative to its first contact) and what it takes up: its
  // spines and where they meet their trunks, and the label under its lowest contact.
  const ys = Array.from({ length: n }, (_, i) => down * i * gap);
  const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
  const body: Box = { x0: -SPINE_GAP, x1: SPINE_GAP, y0: top - SPINE_JOIN, y1: bottom + Math.max(SPINE_JOIN, TARGET_R + LABEL_H / 2) };
  const corners = [
    { x: body.x0, y: body.y0 },
    { x: body.x1, y: body.y0 },
    { x: body.x0, y: body.y1 },
    { x: body.x1, y: body.y1 },
  ];
  const along = corners.map((c) => proj(c, u));
  const [aMin, aMax] = [Math.min(...along), Math.max(...along)];
  const [lo, hi] = [-len / 2 - aMin, len / 2 - aMax];
  if (lo > hi) return undefined;
  // Its nearest corner just inside the line, no deeper than allowed.
  const d = BRIDGE_START - Math.min(...corners.map((c) => proj(c, nIn)));
  if (Math.max(...ys.map((y) => y * nIn.y)) + d > LADDER_DEPTH * Math.hypot(mid.x, mid.y)) return undefined;
  const avoid = [...targetBoxes(p, A.side), ...targetBoxes(q, B.side)];
  // Centred between the fans, or moved along the line to clear a label.
  const centre = (lo + hi) / 2;
  const step = 0.25 * MIN_GAP;
  for (let j = 0; j <= Math.ceil((hi - lo) / step); j++) {
    for (const a of j ? [centre - j * step, centre + j * step] : [centre]) {
      if (a < lo - 1e-6 || a > hi + 1e-6) continue;
      const o = { x: mid.x + u.x * a + nIn.x * d, y: mid.y + u.y * a + nIn.y * d };
      const placed = { x0: o.x + body.x0, x1: o.x + body.x1, y0: o.y + body.y0, y1: o.y + body.y1 };
      if ([...avoid, ...taken].some((bx) => overlaps(bx, placed)) || inFan(placed, A) || inFan(placed, B)) continue;
      return { spots: ys.map((y) => ({ x: o.x, y: o.y + y })), box: placed };
    }
  }
  return undefined;
}

/**
 * Many targets round an ellipse: the order that puts as many shared
 * contacts (and links between targets) as possible between direct
 * neighbours, the rest as close as they can be. Starts from the greedy chain
 * and improves it by reversing stretches and swapping pairs until nothing
 * helps; the first target stays on top.
 */
function aroundTheRing(order: string[], shared: Map<string, string[]>, net: Network): string[] {
  const k = order.length;
  const idx = new Map(order.map((t, i) => [t, i]));
  const w = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const bump = (a: number | undefined, b: number | undefined, v: number) => {
    if (a === undefined || b === undefined || a === b) return;
    w[a][b] += v;
    w[b][a] += v;
  };
  for (const [key, ids] of shared) {
    const ts = key.split('\u0000').map((t) => idx.get(t));
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) bump(ts[i], ts[j], ids.length);
  }
  for (const e of net.edges) bump(idx.get(e.source), idx.get(e.target), 2);
  const cost = (perm: number[]) => {
    const at = new Array<number>(k);
    perm.forEach((t, p) => (at[t] = p));
    let c = 0;
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        if (!w[i][j]) continue;
        // Neighbours cost nothing (their contacts bridge the gap between
        // them); anything further costs about the same, a little more the
        // further round it is, so as many as possible become neighbours.
        const d = Math.min(Math.abs(at[i] - at[j]), k - Math.abs(at[i] - at[j]));
        if (d > 1) c += w[i][j] * (1 + 0.15 * (d - 1));
      }
    }
    return c;
  };
  let perm = order.map((_, i) => i);
  let best = cost(perm);
  const tryPerm = (cand: number[]) => {
    const c = cost(cand);
    if (c < best - 1e-9) {
      perm = cand;
      best = c;
      return true;
    }
    return false;
  };
  for (let pass = 0; pass < 50; pass++) {
    let improved = false;
    for (let i = 0; i < k - 1; i++) {
      for (let j = i + 1; j < k; j++) {
        if (tryPerm([...perm.slice(0, i), ...perm.slice(i, j + 1).reverse(), ...perm.slice(j + 1)])) improved = true;
        const swapped = [...perm];
        [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
        if (tryPerm(swapped)) improved = true;
      }
    }
    if (!improved) break;
  }
  const start = perm.indexOf(0);
  return [...perm.slice(start), ...perm.slice(0, start)].map((i) => order[i]);
}

/** Contacts shared by exactly two neighbours round the ring, keyed by the first neighbour's place. */
function bridgeGroups(around: string[], shared: Map<string, string[]>): Map<number, string[]> {
  const k = around.length;
  const place = new Map(around.map((t, i) => [t, i]));
  const out = new Map<number, string[]>();
  for (const [key, ids] of shared) {
    const ts = key.split('\u0000');
    if (ts.length !== 2 || !place.has(ts[0]) || !place.has(ts[1])) continue;
    const [i, j] = [place.get(ts[0])!, place.get(ts[1])!].sort((a, b) => a - b);
    const first = j - i === 1 ? i : i === 0 && j === k - 1 ? j : -1;
    if (first < 0) continue;
    out.set(first, [...(out.get(first) ?? []), ...ids]);
  }
  return out;
}

/** A ladder worked out for two neighbours: their shared contacts, strongest first, and spots for as many as fit. */
interface LadderPlan {
  a: string;
  b: string;
  members: string[];
  spots: Point[];
  /** What the ladder takes up (with room to spare round it), if placed. */
  box?: Box;
}

/**
 * Two neighbours' shared contacts as a ladder between them (see ladderSpots),
 * as many as fit, strongest nearest the line between the two targets;
 * biggest bridges first, each clear of those before it.
 */
function planLadders(around: string[], bridges: Map<number, string[]>, total: (id: string) => number, endOf: (t: string) => BridgeEnd, steps = LADDER_STEPS): LadderPlan[] {
  const k = around.length;
  const taken: Box[] = [];
  return bridgeOrder(bridges).map(([first, ids]) => {
    const [a, b] = [around[first], around[(first + 1) % k]];
    const members = byWeight([...ids], total);
    let ladder: ReturnType<typeof ladderSpots>;
    for (let n = members.length; n > 0 && !(ladder = ladderSpots(n, endOf(a), endOf(b), taken, steps)); n--);
    const box = ladder && pad(ladder.box, LADDER_CLEAR);
    if (box) taken.push(box);
    return { a, b, members, spots: ladder?.spots ?? [], box };
  });
}

/** The shared contacts not placed on a bridge, by the targets they share. */
function leftOver(shared: Map<string, string[]>, plan: LadderPlan[]): Map<string, string[]> {
  const placed = new Set(plan.flatMap((l) => l.members.slice(0, l.spots.length)));
  return new Map([...shared].map(([key, ids]) => [key, ids.filter((id) => !placed.has(id))] as const));
}

/**
 * Puts the planned ladders in place. Their links are drawn joined, one spine
 * and trunk to each target (see routeBundles). What does not fit is placed
 * inside (see placeInner).
 */
function placeBridges(plan: LadderPlan[], pos: Map<string, Point>, labelSide: NonNullable<LinkLayout['labelSide']>, bundles: Bundle[]) {
  for (const { a, b, members, spots } of plan) {
    const placed = members.slice(0, spots.length);
    placed.forEach((id, i) => {
      pos.set(id, spots[i]);
      labelSide.set(id, 'bottom');
    });
    if (placed.length) bundles.push({ targets: [a, b], members: placed, rim: true });
  }
}

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
  return { total, at };
}

/** Shared contacts placed inside the ellipse: a ladder of those sharing the same targets, or one contact on its own. */
interface InnerItem {
  targets: string[];
  members: string[];
}

/** Inner ladders and contacts stay this far inside the ellipse. */
const INNER_LIMIT = 0.9;
/** Things placed inside the ellipse are drawn this share of the way from the middle to their targets' weighted middle. */
const INNER_PULL = 0.85;
/** Gap kept round each thing placed inside the ellipse. */
const INNER_CLEAR = 0.15 * MIN_GAP;
/** The search for room walks out from where a thing would best go in steps this long. */
const SEARCH_STEP = 0.3 * MIN_GAP;

/** A ladder has at most this many spines (targets). */
const MAX_LADDER_TARGETS = 4;
/** Two groups share a ladder when this much of their targets is shared (two or more of them). */
const MERGE_ALIKE = 0.5;

/**
 * The shared contacts left for the inside of the ellipse, as items. Those
 * sharing the same targets form a group; groups whose targets are much alike
 * (say A–B and A–B–C) are merged, most alike first, as long as the ladder
 * keeps to four targets. A group of two or more contacts makes a ladder (its
 * contacts by their targets, those with the most first, then strongest
 * first, so each spine stays short); a contact alike with no one goes on its
 * own. Big ladders first, then single contacts, strongest first.
 */
function innerItems(rest: Map<string, string[]>, total: (id: string) => number, links: Map<string, Map<string, number>>): InnerItem[] {
  const groups: InnerItem[] = [...rest].filter(([, ids]) => ids.length).map(([key, ids]) => ({ targets: key.split('\u0000'), members: [...ids] }));
  const alike = (p: InnerItem, q: InnerItem) => {
    const both = p.targets.filter((t) => q.targets.includes(t)).length;
    const all = new Set([...p.targets, ...q.targets]).size;
    return both >= 2 && all <= MAX_LADDER_TARGETS ? both / all : 0;
  };
  for (;;) {
    let [best, bi, bj] = [0, -1, -1];
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = alike(groups[i], groups[j]);
        if (a > best + 1e-9) [best, bi, bj] = [a, i, j];
      }
    }
    if (best < MERGE_ALIKE) break;
    const [p, q] = [groups[bi], groups[bj]];
    groups[bi] = { targets: [...new Set([...p.targets, ...q.targets])].sort(), members: [...p.members, ...q.members] };
    groups.splice(bj, 1);
  }
  const key = (m: string) => [...(links.get(m)?.keys() ?? [])].sort().join('\u0000');
  const reach = (m: string) => links.get(m)?.size ?? 0;
  const items = groups.flatMap((g): InnerItem[] => {
    const members = [...g.members].sort((p, q) => reach(q) - reach(p) || key(p).localeCompare(key(q)) || total(q) - total(p) || p.localeCompare(q));
    return members.length >= 2 ? [{ targets: g.targets, members }] : members.map((m) => ({ targets: g.targets, members: [m] }));
  });
  const weight = (it: InnerItem) => it.members.reduce((s, m) => s + total(m), 0);
  return items.sort((p, q) => q.members.length - p.members.length || weight(q) - weight(p) || p.members[0].localeCompare(q.members[0]));
}

/** A thing placed inside the ellipse, centred at c: where its contacts go and the room it takes up. */
function innerShape(item: InnerItem, c: Point, step: number, at: (id: string) => Point): { spots: Point[]; box: Box } {
  const n = item.members.length;
  if (n === 1) return { spots: [c], box: { x0: c.x - LABEL_W / 2, x1: c.x + LABEL_W / 2, y0: c.y - 0.55 * MIN_GAP, y1: c.y + 0.55 * MIN_GAP + LABEL_H } };
  const top = c.y - ((n - 1) * step) / 2;
  const bottom = top + (n - 1) * step;
  const { left, right } = ladderSides(item.targets, at, c.x, c.y);
  const stagger = Math.max(0, Math.max(left.length, right.length) - 1) * JOIN_STEP;
  return {
    spots: item.members.map((_, i) => ({ x: c.x, y: top + i * step })),
    box: {
      x0: c.x - SPINE_GAP - Math.max(0, left.length - 1) * SPINE_LANE,
      x1: c.x + SPINE_GAP + Math.max(0, right.length - 1) * SPINE_LANE,
      y0: top - SPINE_JOIN - stagger,
      y1: bottom + Math.max(SPINE_JOIN + stagger, TARGET_R + LABEL_H / 2),
    },
  };
}

/** Boxes kept in a grid, to find quickly whether a new one would overlap any. */
function boxGrid() {
  const cell = 3 * MIN_GAP;
  const cells = new Map<string, Box[]>();
  const keys = (b: Box) => {
    const out: string[] = [];
    for (let gx = Math.floor(b.x0 / cell); gx <= Math.floor(b.x1 / cell); gx++) for (let gy = Math.floor(b.y0 / cell); gy <= Math.floor(b.y1 / cell); gy++) out.push(`${gx},${gy}`);
    return out;
  };
  return {
    add(b: Box) {
      for (const key of keys(b)) {
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key)!.push(b);
      }
    },
    hits(b: Box) {
      for (const key of keys(b)) for (const o of cells.get(key) ?? []) if (overlaps(o, b)) return true;
      return false;
    },
  };
}

/**
 * Offsets in order of distance out to r, SEARCH_STEP apart (coarser for a
 * big search, so it stays quick), ties broken the same way every time.
 */
function searchOffsets(r: number): Point[] {
  const step = Math.max(SEARCH_STEP, r / 90);
  const n = Math.ceil(r / step);
  const out: Point[] = [];
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) if (i * i + j * j <= n * n) out.push({ x: i * step, y: j * step });
  return out.sort((p, q) => p.x * p.x + p.y * p.y - (q.x * q.x + q.y * q.y) || p.y - q.y || p.x - q.x);
}

/** Where ladders and single contacts may go: clear of `fixed` boxes and of `fans`, `inside` the room, near where their targets pull them. */
interface InnerRoom {
  fixed: Box[];
  fans: BridgeEnd[];
  inside: (box: Box) => boolean;
  /** Things go `pull` of the way from `middle` to their targets' weighted middle. */
  middle: Point;
  pull: number;
  /** How far to look for room. */
  reach: number;
}

/** The inside of the targets' ellipse (half height b), clear of the targets, their labels and fans. */
function ellipseRoom(targets: string[], at: (id: string) => Point, endOf: (t: string) => BridgeEnd, b: number): InnerRoom {
  return {
    fixed: targets.flatMap((t) => targetBoxes(at(t), endOf(t).side)),
    fans: targets.map(endOf),
    inside: (box) => [box.x0, box.x1].every((x) => [box.y0, box.y1].every((y) => Math.hypot(x / (ELLIPSE * b), y / b) <= INNER_LIMIT)),
    middle: { x: 0, y: 0 },
    pull: INNER_PULL,
    reach: 1.8 * b,
  };
}

/**
 * The shared contacts that are not on a bridge, inside the ellipse (half
 * height b): each ladder or contact as near as it can be to where its
 * targets pull it (their weighted middle, drawn in a little: INNER_PULL),
 * clear of the bridges, the targets, their labels and fans, and of each
 * other. With `out`, puts them in place (a ladder that finds no room goes as
 * single contacts; a contact that finds none goes where it would best be);
 * without, only checks that everything fits.
 */
function placeInner(
  items: InnerItem[],
  at: (id: string) => Point,
  links: Map<string, Map<string, number>>,
  room: InnerRoom,
  taken: Box[],
  out?: { pos: Map<string, Point>; labelSide: NonNullable<LinkLayout['labelSide']>; bundles: Bundle[]; boxes?: Box[] },
): boolean {
  const grid = boxGrid();
  for (const box of taken) grid.add(box);
  const offsets = searchOffsets(room.reach);
  const fits = (box: Box) => room.inside(box) && !grid.hits(box) && !room.fixed.some((f) => overlaps(f, box)) && !room.fans.some((e) => inFan(box, e));
  const wantAt = (item: InnerItem): Point => {
    let [x, y, w] = [0, 0, 0];
    for (const t of item.targets) {
      const weight = item.members.reduce((s, m) => s + (links.get(m)?.get(t) ?? 0), 0) || 1;
      x += weight * at(t).x;
      y += weight * at(t).y;
      w += weight;
    }
    return { x: room.middle.x + (room.pull * (x / w - room.middle.x)), y: room.middle.y + room.pull * (y / w - room.middle.y) };
  };
  const find = (item: InnerItem, steps: number[]) => {
    const want = wantAt(item);
    for (const step of steps) {
      for (const o of offsets) {
        const shape = innerShape(item, { x: want.x + o.x, y: want.y + o.y }, step, at);
        if (fits(shape.box)) return shape;
      }
    }
    return undefined;
  };
  const put = (item: InnerItem, shape: { spots: Point[]; box: Box }) => {
    grid.add(pad(shape.box, INNER_CLEAR));
    if (!out) return;
    out.boxes?.push(shape.box);
    item.members.forEach((m, i) => {
      out.pos.set(m, shape.spots[i]);
      out.labelSide.set(m, 'bottom');
    });
    if (item.members.length > 1) out.bundles.push({ targets: item.targets, members: item.members });
  };
  for (const item of items) {
    const shape = find(item, item.members.length > 1 ? LADDER_STEPS : [0]);
    if (shape) {
      put(item, shape);
      continue;
    }
    if (!out) return false;
    // No room: the contacts go on their own, or (failing that) where they would best be.
    for (const m of item.members) {
      const single = { targets: item.targets, members: [m] };
      put(single, find(single, [0]) ?? innerShape(single, wantAt(single), 0, at));
    }
  }
  return true;
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
/** Room either side of a street's lanes. */
const STREET_PAD = 0.6 * MIN_GAP;

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
  // Links between discs run along the streets between rows and columns (see
  // routeStreets): each street as wide as its lanes need. Lay the table out
  // once with plain gaps, count the lanes, then widen the streets.
  const rowIx = (t: string) => usedRows.indexOf(Math.floor(cellOf.get(t)! / cols));
  const colIx = (t: string) => usedCols.indexOf(cellOf.get(t)! % cols);
  const offsets = (sizes: number[], gaps: number[]) => {
    const out: number[] = [];
    let at = gaps[0];
    sizes.forEach((s, i) => {
      out.push(at + s / 2);
      at += s + gaps[i + 1];
    });
    return out;
  };
  const streetsOf = (xs: number[], ys: number[], gx: number[], gy: number[]): StreetGrid => ({
    rows: ys,
    cols: xs,
    hStreets: [...ys.map((y, i) => y - rowH[i] / 2 - gy[i] / 2), ys[ys.length - 1] + rowH[ys.length - 1] / 2 + gy[ys.length] / 2],
    vStreets: [...xs.map((x, i) => x - colW[i] / 2 - gx[i] / 2), xs[xs.length - 1] + colW[xs.length - 1] / 2 + gx[xs.length] / 2],
  });
  const homes = new Map([...homed].flatMap(([t, ids]) => ids.map((id) => [id, t] as const)));
  const { runs } = streetRuns(net, homes);
  let gx = Array.from({ length: colW.length + 1 }, () => COL_W);
  let gy = Array.from({ length: rowH.length + 1 }, () => COL_W);
  const placeAt = () => {
    const xs = offsets(colW, gx);
    const ys = offsets(rowH, gy);
    return { grid: streetsOf(xs, ys, gx, gy), centre: new Map(targets.map((t) => [t, { x: xs[colIx(t)], y: ys[rowIx(t)] }])) };
  };
  if (runs.length) {
    const first = placeAt();
    const { counts } = planStreets(runs, (t) => first.centre.get(t)!, first.grid);
    const room = (n: number) => Math.max(COL_W, (n - 1) * STREET_STEP + 2 * STREET_PAD);
    gx = gx.map((_, i) => room(counts.get(`v${i}`) ?? 0));
    gy = gy.map((_, i) => room(counts.get(`h${i}`) ?? 0));
  }
  const { grid, centre } = placeAt();
  for (const [t, c] of centre) pos.set(t, { ...c });
  // Which way a target's lines to another leave it: towards the street between them.
  const last = usedRows.length - 1;
  const facing = (t: string, u: string) => (rowIx(t) < rowIx(u) ? 1 : rowIx(t) > rowIx(u) ? -1 : rowIx(t) === last && last > 0 ? 1 : -1);
  // A target's name goes on the side fewer of its lines use (under it, unless most come from below).
  const nameUp = new Set(targets.filter((t) => partners.get(t)!.reduce((sum, u) => sum + facing(t, u) * tie.get(pairKey(t, u))!, 0) > 0));
  for (const t of nameUp) labelSide.set(t, 'top');

  // Fill each disc's rings, inner first; shared contacts take the outer slots
  // facing their other targets, the rest spread evenly.
  const gap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  for (const t of targets) {
    const c = centre.get(t)!;
    const towards = partners.get(t)!.flatMap((u) => Array.from({ length: corridorWidth(t, u) }, () => (facing(t, u) * Math.PI) / 2));
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
      if (r === 0) for (const j of [...free]) if (gap(slotAngle(j), nameUp.has(t) ? -Math.PI / 2 : Math.PI / 2) < NAME_SPOT) free.delete(j);
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
        // Towards the street its other targets' lines come in from.
        for (const [u, w] of others.get(id) ?? []) vy += w * facing(t, u);
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
  // Room for the outer streets too.
  const bounds = { minX: b.minX - LABEL_ROOM, minY: b.minY - 18, maxX: b.maxX + LABEL_ROOM, maxY: b.maxY + 18 };
  if (runs.length) {
    // (A street's gap holds its lanes with room either side.)
    bounds.minY = Math.min(bounds.minY, grid.hStreets[0] - gy[0] / 2);
    bounds.maxY = Math.max(bounds.maxY, grid.hStreets[grid.hStreets.length - 1] + gy[gy.length - 1] / 2);
    bounds.minX = Math.min(bounds.minX, grid.vStreets[0] - gx[0] / 2);
    bounds.maxX = Math.max(bounds.maxX, grid.vStreets[grid.vStreets.length - 1] + gx[gx.length - 1] / 2);
  }
  return { pos, bounds, labelSide, straightTargetLinks: true, ...(runs.length ? { streets: grid, homes } : {}) };
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

/** Contacts linked to no target: one last row, centred. */
function looseRow(ids: string[], y: number, pos: Map<string, Point>) {
  ids.forEach((id, i) => pos.set(id, { x: (i - (ids.length - 1) / 2) * COL_W, y }));
}

/**
 * Shared contacts in a band of rows next to the targets' row (below for
 * dir 1, above for dir -1), each under or over the middle of its targets,
 * kept clear of every target's trunk. `gap(r, buses)` is the distance to row
 * r from the row before it, given how many targets' buses reach row r.
 * Returns the last row's y (0 for none).
 */
function bandRows(g: Groups, tx: Map<string, number>, width: number, dir: 1 | -1, gap: (r: number, buses: number) => number, pos: Map<string, Point>): number {
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
    y += dir * gap(r, new Set(row.flatMap((w) => w.ts)).size);
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
  return y;
}

/**
 * Along a tight row, every other label a line further out: neighbours a
 * column apart are closer than a number is wide.
 */
function staggerRows(pos: Map<string, Point>, ids: string[]): Set<string> {
  const out = new Set<string>();
  const rows = new Map<number, string[]>();
  for (const id of ids) {
    const k = Math.round(pos.get(id)!.y);
    if (!rows.has(k)) rows.set(k, []);
    rows.get(k)!.push(id);
  }
  for (const row of rows.values()) {
    row.sort((a, b) => pos.get(a)!.x - pos.get(b)!.x || a.localeCompare(b));
    row.forEach((id, i) => {
      const prev = row[i - 1];
      if (prev && !out.has(prev) && pos.get(id)!.x - pos.get(prev)!.x < 1.6 * COL_W) out.add(id);
    });
  }
  return out;
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
  const y = bandRows(g, tx, width, 1, (r, buses) => (r === 0 ? TREE_TOP : TREE_ROW) + Math.max(0, buses - 1) * LANE_STEP, pos);

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

  const labelLower = staggerRows(pos, [...pos.keys()].filter((id) => !g.targetIds.has(id)));

  // The frame takes in the lanes above the targets too.
  const routes = routeTree(net, pos);
  const bounds = boundsOf(new Map([...pos, ...routes.bends]));
  return { pos, bounds, labelSide, labelLower };
}

/** Organization chart geometry (chart units). */
const ORG_STUB = 72;
const ORG_ROW = 66;
const ORG_FIRST = 84;
const ORG_BUS = 52;
/** Room for one spine: a contact and its label either side of it. */
const SPINE_W = 380;
/** Above the targets to the first row of shared contacts, then between rows. */
const ORG_TOP = 150;
const ORG_BAND = 124;
/** Room beside the chart for the labels of its outer columns. */
const ORG_LABEL_ROOM = 90;

/**
 * Organization: an org chart. Under each target a spine (several side by
 * side for a long list, joined by a bar) with its own contacts listed down
 * it, left and right, strongest at the top, each on a short level stub
 * carrying the link's count; labels face outwards. Contacts shared between
 * targets sit in rows above them, over the middle of their targets. Links
 * are right-angled throughout (see linkRoute).
 */
export function organizationLayout(net: Network): LinkLayout {
  const g = classify(net);
  const k = g.order.length;
  const counts = g.order.map((t) => g.exclusive.get(t)?.length ?? 0);
  // Only shared contacts (the cross-target chart): ladders above and below the targets.
  if (k >= 2 && g.shared.size && counts.every((n) => !n) && !g.loose.length) return orgLadderLayout(net, g);
  const pos = new Map<string, Point>();
  const labelSide: NonNullable<LinkLayout['labelSide']> = new Map();
  const combs = new Map<string, Comb>();
  const ttCount = net.edges.filter((e) => g.targetIds.has(e.source) && g.targetIds.has(e.target)).length;
  const sharedCount = [...g.shared.values()].reduce((s, ids) => s + ids.length, 0);

  // How long a spine may get: whatever brings the chart nearest 16:9 (on a
  // tie, fewer spines).
  const spinesFor = (rows: number) => counts.map((n) => Math.max(1, Math.ceil(n / (2 * rows))));
  let rowsCap = 40;
  let best = Infinity;
  for (let rows = 40; rows >= 3; rows--) {
    const sp = spinesFor(rows);
    const deepest = Math.max(1, ...counts.map((n, i) => Math.ceil(n / (2 * sp[i]))));
    const w = sp.reduce((a, b) => a + b, 0) * SPINE_W + Math.max(0, k - 1) * COL_W * 0.6;
    const h = ORG_FIRST + deepest * ORG_ROW + (sharedCount ? ORG_TOP + Math.ceil(sharedCount / Math.max(1, w / COL_W)) * ORG_BAND : 0);
    const score = Math.abs(Math.log(w / h / (16 / 9)));
    if (score < best - 1e-9) [rowsCap, best] = [rows, score];
  }
  const spines = spinesFor(rowsCap);
  const tx = targetRow(
    g.order,
    spines.map((n) => n * SPINE_W),
  );
  for (const [t, x] of tx) {
    pos.set(t, { x, y: 0 });
    // Below runs the spine and above the links to the shared row: the name goes beside.
    labelSide.set(t, 'right');
  }
  const width = Math.max(COL_W, ...[...tx.values()].map((x) => Math.abs(x) * 2 + 2 * TARGET_GAP));

  // Shared contacts above, rows going up, each row high enough for the
  // lanes below it (and, for the first, the links between targets).
  bandRows(g, tx, width, -1, (r, buses) => (r === 0 ? ORG_TOP + (Math.max(0, buses - 1) + ttCount) * LANE_STEP : ORG_BAND + Math.max(0, buses - 1) * LANE_STEP), pos);
  for (const ids of g.shared.values()) for (const id of ids) labelSide.set(id, 'top');

  // Own contacts down the spines: across each row spine by spine, left then right.
  let bottom = 0;
  g.order.forEach((t, i) => {
    const s = spines[i];
    const dx = Array.from({ length: s }, (_, j) => (j - (s - 1) / 2) * SPINE_W);
    combs.set(t, { spines: dx, bus: ORG_BUS });
    const first = s > 1 ? ORG_FIRST + 24 : ORG_FIRST;
    const T = pos.get(t)!;
    (g.exclusive.get(t) ?? []).forEach((id, n) => {
      const row = Math.floor(n / (2 * s));
      const p = n % (2 * s);
      const right = p % 2 === 1;
      const y = T.y + first + row * ORG_ROW;
      pos.set(id, { x: T.x + dx[Math.floor(p / 2)] + (right ? ORG_STUB : -ORG_STUB), y });
      labelSide.set(id, right ? 'right' : 'left');
      bottom = Math.max(bottom, y);
    });
  });
  if (g.loose.length) looseRow(g.loose, bottom + ROW_H * 1.5, pos);
  separate(pos, g.targetIds);

  // The frame takes in the lines and the labels beside the outer columns.
  const routes = routeOrg(net, pos, combs);
  const b = boundsOf(new Map([...pos, ...routes.bends]));
  // Shared contacts' labels sit above them; in a tight row, every other one a line higher.
  const labelLower = staggerRows(pos, [...g.shared.values()].flat());
  return { pos, bounds: { minX: b.minX - ORG_LABEL_ROOM, minY: b.minY - 40, maxX: b.maxX + ORG_LABEL_ROOM, maxY: b.maxY + 20 }, labelSide, labelLower, combs };
}

/** Organization with only shared contacts: targets at least this far apart (an icon and a name beside it). */
const ORG_TARGET_MIN = 4.5 * MIN_GAP;
/** Between ladders in a band. */
const ORG_LADDER_GAP = 0.5 * MIN_GAP;
/** From the targets' row to its first lane, and from the last lane to the ladders. */
const ORG_LANE_IN = TARGET_R + 0.4 * MIN_GAP;
const ORG_LANE_OUT = 0.6 * MIN_GAP;

/**
 * Organization with only shared contacts (the cross-target chart): the
 * targets in a row, wide enough apart for their names; the shared contacts on
 * ladders (see innerItems; one contact alone makes a ladder of one), in order
 * of where their targets are, every other one above the row and the rest
 * below, so the chart is half as wide; each band as far from the row as its
 * lanes need (see routeOrgLadders). The row widens to match the bands.
 */
function orgLadderLayout(net: Network, g: Groups): LinkLayout {
  const groups = innerItems(g.shared, g.total, g.links);
  const k = g.order.length;
  const index = new Map(g.order.map((t, i) => [t, i]));
  const step = LADDER_STEPS[0];
  // Long ladders cut into shorter ones (each with the targets its contacts
  // link to), as short as brings the chart nearest 16:9.
  const cut = (most: number): InnerItem[] =>
    groups.flatMap((it) =>
      Array.from({ length: Math.ceil(it.members.length / most) }, (_, i) => {
        const members = it.members.slice(i * most, (i + 1) * most);
        return { targets: it.targets.filter((t) => members.some((m) => g.links.get(m)?.has(t))), members };
      }),
    );
  const ladderW = (it: InnerItem) => 2 * SPINE_GAP + Math.max(0, it.targets.length - 2) * SPINE_LANE + ORG_LADDER_GAP;
  const ladderH = (it: InnerItem) => (it.members.length - 1) * step + SPINE_JOIN + TARGET_R + LABEL_H;
  let items = groups;
  let best = Infinity;
  for (let most = 1; most <= Math.max(1, ...groups.map((it) => it.members.length)); most++) {
    const list = cut(most);
    const bandW = (odd: number) => list.filter((_, i) => i % 2 === odd).reduce((sum, it) => sum + ladderW(it), 0);
    const w = Math.max(bandW(0), bandW(1), k * ORG_TARGET_MIN);
    const h = 2 * Math.max(...list.map(ladderH)) + 2 * ORG_LANE_IN + 2 * MIN_GAP;
    const score = Math.abs(Math.log(w / h / (16 / 9)));
    if (score < best - 1e-9) [items, best] = [list, score];
  }
  let spacing = ORG_TARGET_MIN;
  let placed: { item: InnerItem; up: boolean; x: number }[] = [];
  for (let pass = 0; pass < 4; pass++) {
    const at = (t: string) => ({ x: (index.get(t)! - (k - 1) / 2) * spacing, y: 0 });
    const want = (it: InnerItem) => {
      let [x, w] = [0, 0];
      for (const t of it.targets) {
        const weight = it.members.reduce((s, m) => s + (g.links.get(m)?.get(t) ?? 0), 0) || 1;
        x += weight * at(t).x;
        w += weight;
      }
      return x / w;
    };
    const order = items.map((item) => ({ item, want: want(item) })).sort((p, q) => p.want - q.want || p.item.members[0].localeCompare(q.item.members[0]));
    placed = [];
    let span = 0;
    for (const up of [true, false]) {
      const band = order.filter((_, i) => i % 2 === (up ? 0 : 1));
      const xs: number[] = [];
      const shapes = band.map((b) => innerShape(b.item, { x: b.want, y: 0 }, step, at));
      // Left to right, each clear of the one before, then all shifted to sit as near as they can to where they want to be.
      band.forEach((b, i) => {
        const left = shapes[i].box.x0 - b.want;
        if (!i) xs.push(b.want);
        else xs.push(Math.max(b.want, xs[i - 1] + (shapes[i - 1].box.x1 - band[i - 1].want) + ORG_LADDER_GAP - left));
      });
      const shift = band.reduce((s, b, i) => s + (b.want - xs[i]), 0) / Math.max(1, band.length);
      band.forEach((b, i) => placed.push({ item: b.item, up, x: xs[i] + shift }));
      if (band.length) span = Math.max(span, xs[xs.length - 1] - xs[0] + (shapes[shapes.length - 1].box.x1 - band[band.length - 1].want) - (shapes[0].box.x0 - band[0].want));
    }
    const next = Math.max(ORG_TARGET_MIN, span / Math.max(1, k));
    if (Math.abs(next - spacing) < 1) break;
    spacing = next;
  }
  const pos = new Map<string, Point>();
  const labelSide: NonNullable<LinkLayout['labelSide']> = new Map();
  const labelShift = new Map<string, number>();
  g.order.forEach((t, i) => {
    pos.set(t, { x: (index.get(t)! - (k - 1) / 2) * spacing, y: 0 });
    labelSide.set(t, 'right');
    labelShift.set(t, i % 2 ? 1 : -1);
  });
  const at = (t: string) => pos.get(t)!;
  const bands: OrgBands = { row: 0, up: -ORG_LANE_IN, down: ORG_LANE_IN };
  // Lay the ladders at a distance, count the lanes, then bring them in to suit.
  const lay = (upAt: number, downAt: number) => {
    const boxes: Box[] = [];
    for (const p of placed) {
      const probe = innerShape(p.item, { x: p.x, y: 0 }, step, at);
      const dy = p.up ? upAt - probe.box.y1 : downAt - probe.box.y0;
      const shape = innerShape(p.item, { x: p.x, y: dy }, step, at);
      p.item.members.forEach((m, i) => {
        pos.set(m, shape.spots[i]);
        labelSide.set(m, 'bottom');
      });
      boxes.push(shape.box);
    }
    return boxes;
  };
  const bundles: Bundle[] = placed.map((p) => ({ targets: p.item.targets, members: p.item.members }));
  lay(-4 * MIN_GAP, 4 * MIN_GAP);
  const lanes = orgLaneCounts(net, pos, bundles, bands);
  const boxes = lay(bands.up - Math.max(0, lanes.up - 1) * ORG_LANE_STEP - ORG_LANE_OUT, bands.down + Math.max(0, lanes.down - 1) * ORG_LANE_STEP + ORG_LANE_OUT);
  const b = boundsOf(pos);
  const bounds = { minX: b.minX - ORG_LABEL_ROOM, minY: b.minY - 40, maxX: b.maxX + LABEL_W, maxY: b.maxY + 20 };
  for (const box of boxes) {
    bounds.minX = Math.min(bounds.minX, box.x0);
    bounds.maxX = Math.max(bounds.maxX, box.x1);
    bounds.minY = Math.min(bounds.minY, box.y0);
    bounds.maxY = Math.max(bounds.maxY, box.y1);
  }
  return { pos, bounds, labelSide, labelShift, bundles, orgBands: bands };
}
