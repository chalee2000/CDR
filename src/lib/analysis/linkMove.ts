import type { Point } from './linkLayout';

/**
 * Geometry for moving numbers around a link chart by hand: the frame the chart
 * is fitted to, keeping a moved group inside it, and picking the numbers
 * inside a dragged selection box. All in chart (layout) coordinates.
 */

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The layout's bounds widened on their short side to the drawing area's shape,
 * around the same centre. A chart fitted to this frame looks exactly like one
 * fitted to the bounds (the fit keeps the shape and centres it), but the frame
 * covers the whole drawing area: numbers can be moved anywhere on screen
 * without the fit, and so the whole picture, changing.
 */
export function chartFrame(bounds: Box, box?: { w: number; h: number }): Box {
  if (!box || box.w <= 0 || box.h <= 0) return { ...bounds };
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const aspect = box.w / box.h;
  const fw = Math.max(w, h * aspect);
  const fh = Math.max(h, w / aspect);
  return { minX: cx - fw / 2, minY: cy - fh / 2, maxX: cx + fw / 2, maxY: cy + fh / 2 };
}

/** Smallest box around the points (undefined for none). */
export function boxOf(points: Iterable<Point>): Box | undefined {
  let out: Box | undefined;
  for (const p of points) {
    if (!out) out = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
    else {
      out.minX = Math.min(out.minX, p.x);
      out.minY = Math.min(out.minY, p.y);
      out.maxX = Math.max(out.maxX, p.x);
      out.maxY = Math.max(out.maxY, p.y);
    }
  }
  return out;
}

export function unionBox(a: Box, b?: Box): Box {
  if (!b) return { ...a };
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

/**
 * How far a group may move by (dx, dy) and stay inside the frame. A group that
 * already reaches outside it is not pushed further out, but can come back in.
 */
export function clampDelta(group: Box, frame: Box, dx: number, dy: number): [number, number] {
  const range = (lo: number, hi: number, fLo: number, fHi: number, d: number) => {
    const min = Math.min(0, fLo - lo);
    const max = Math.max(0, fHi - hi);
    return Math.max(min, Math.min(max, d));
  };
  return [range(group.minX, group.maxX, frame.minX, frame.maxX, dx), range(group.minY, group.maxY, frame.minY, frame.maxY, dy)];
}

/** Ids whose point lies inside the box spanned by two corners (dragged in any direction). */
export function pickInRect(points: Iterable<[string, Point]>, a: Point, b: Point): string[] {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const out: string[] = [];
  for (const [id, p] of points) if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) out.push(id);
  return out;
}
