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

/**
 * Packed: each target is a disc with its own contacts on a sunflower spiral
 * around it (strongest nearest), each set of shared contacts its own disc
 * next to the first of its targets, and the discs packed in rows to about
 * the shape of a screen. Nothing is wasted on empty space.
 */
export function packedLayout(net: Network): LinkLayout {
  const g = classify(net);
  const pos = new Map<string, Point>();
  // Area each contact takes on the spiral: hexagonal packing at MIN_GAP.
  const cellArea = 1.08 * (Math.sqrt(3) / 2) * MIN_GAP * MIN_GAP;
  const spiral = (n: number, inner: number) => Array.from({ length: n }, (_, i) => Math.sqrt(inner * inner + (cellArea * (i + 0.5)) / Math.PI));
  interface Disc {
    centre?: string;
    members: string[];
    radii: number[];
    r: number;
  }
  const disc = (centre: string | undefined, members: string[]): Disc => {
    const radii = spiral(members.length, centre ? TARGET_GAP : 0);
    const r = Math.max(centre ? TARGET_GAP * 0.6 : 0, (radii[radii.length - 1] ?? 0) + MIN_GAP / 2);
    return { centre, members, radii, r };
  };
  // Shared sets follow the first of their targets in the drawing order.
  const sharedAfter = new Map<string, string[][]>();
  const rank = new Map(g.order.map((t, i) => [t, i]));
  for (const [key, ids] of [...g.shared].sort((a, b) => a[0].localeCompare(b[0]))) {
    const first = key.split('\u0000').sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))[0];
    if (!sharedAfter.has(first)) sharedAfter.set(first, []);
    sharedAfter.get(first)!.push(ids);
  }
  const discs: Disc[] = [];
  for (const t of g.order) {
    discs.push(disc(t, g.exclusive.get(t) ?? []));
    for (const ids of sharedAfter.get(t) ?? []) discs.push(disc(undefined, ids));
  }
  if (g.loose.length) discs.push(disc(undefined, g.loose));

  // Shelf packing to about 16:9.
  const gap = MIN_GAP * 0.6;
  const area = discs.reduce((a, d) => a + (2 * d.r + gap) ** 2, 0);
  const width = Math.max(Math.sqrt((area * 16) / 9), ...discs.map((d) => 2 * d.r));
  const rows: { discs: Disc[]; w: number; h: number }[] = [];
  for (const d of discs) {
    const row = rows[rows.length - 1];
    const w = 2 * d.r;
    if (row && row.w + gap + w <= width) {
      row.discs.push(d);
      row.w += gap + w;
      row.h = Math.max(row.h, w);
    } else rows.push({ discs: [d], w, h: w });
  }
  let y = 0;
  for (const row of rows) {
    let x = -row.w / 2;
    for (const d of row.discs) {
      const c = { x: x + d.r, y: y + row.h / 2 };
      if (d.centre) pos.set(d.centre, c);
      d.members.forEach((id, i) => {
        const a = i * GOLDEN - Math.PI / 2;
        pos.set(id, { x: c.x + d.radii[i] * Math.cos(a), y: c.y + d.radii[i] * Math.sin(a) });
      });
      x += 2 * d.r + gap;
    }
    y += row.h + gap;
  }
  separate(pos, g.targetIds);
  return { pos, bounds: boundsOf(pos) };
}

/** Columns of a contact block under each target, chosen so the whole chart is about 16:9. */
function blockColumns(counts: number[], extraRows: number, maxCols: number): number[] {
  let best: number[] = counts.map(() => 1);
  let bestScore = Infinity;
  for (const a of [0.15, 0.25, 0.4, 0.6, 1, 1.5, 2.2, 3.2, 4.5, 6.5]) {
    const cols = counts.map((n) => Math.max(1, Math.min(maxCols, Math.ceil(Math.sqrt(n * a)))));
    const w = cols.reduce((s, c, i) => s + Math.max(c * COL_W, 2 * TARGET_GAP) + (i ? COL_W * 0.6 : 0), 0);
    const h = (Math.max(1, ...counts.map((n, i) => Math.ceil(n / cols[i]))) + extraRows + 1) * ROW_H;
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

/**
 * Hierarchy: the targets in a row on top; the contacts they share in the
 * band below, each under the middle of its targets; each target's own
 * contacts in a block under it, strongest first (odd rows offset by half a
 * column so links do not run straight through the contacts above).
 */
export function hierarchyLayout(net: Network): LinkLayout {
  const g = classify(net);
  const pos = new Map<string, Point>();
  const counts = g.order.map((t) => g.exclusive.get(t)?.length ?? 0);
  const sharedCount = [...g.shared.values()].reduce((s, ids) => s + ids.length, 0);
  const cols = blockColumns(counts, Math.ceil(sharedCount / 12), 14);
  const tx = targetRow(
    g.order,
    cols.map((c) => c * COL_W),
  );
  for (const [t, x] of tx) pos.set(t, { x, y: 0 });
  const width = Math.max(COL_W, ...[...tx.values()].map((x) => Math.abs(x) * 2 + 2 * TARGET_GAP));
  const top = ROW_H * 1.35;
  const shRows = sharedRows(g, tx, top, ROW_H, width, pos);
  const blockTop = top + (shRows ? shRows * ROW_H + ROW_H * 0.4 : 0);
  let bottom = blockTop;
  g.order.forEach((t, k) => {
    const ids = g.exclusive.get(t) ?? [];
    const c = cols[k];
    ids.forEach((id, i) => {
      const row = Math.floor(i / c);
      const col = i % c;
      const shift = c > 1 ? (row % 2 === 1 ? 0.25 : -0.25) : 0;
      const x = tx.get(t)! + (col - (c - 1) / 2 + shift) * COL_W;
      const y = blockTop + row * ROW_H;
      pos.set(id, { x, y });
      bottom = Math.max(bottom, y);
    });
  });
  if (g.loose.length) looseRow(g.loose, bottom + ROW_H * 1.5, pos);
  separate(pos, g.targetIds);
  return { pos, bounds: boundsOf(pos) };
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
