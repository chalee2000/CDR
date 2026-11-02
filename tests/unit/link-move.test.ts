import { describe, expect, it } from 'vitest';
import { boxOf, chartFrame, clampDelta, pickInRect, unionBox } from '../../src/lib/analysis/linkMove';

describe('chartFrame', () => {
  const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 100 };

  it('widens the short side to the drawing area around the same centre', () => {
    // A 2:1 area around a 4:1 layout: taller, same width and centre.
    expect(chartFrame(bounds, { w: 800, h: 400 })).toEqual({ minX: 0, minY: -50, maxX: 400, maxY: 150 });
    // An 8:1 area: wider, same height.
    expect(chartFrame(bounds, { w: 800, h: 100 })).toEqual({ minX: -200, minY: 0, maxX: 600, maxY: 100 });
  });

  it('leaves a layout of the same shape, or with no area yet, as it is', () => {
    expect(chartFrame(bounds, { w: 400, h: 100 })).toEqual(bounds);
    expect(chartFrame(bounds)).toEqual(bounds);
    expect(chartFrame(bounds, { w: 0, h: 300 })).toEqual(bounds);
  });

  it('gives a single point some room', () => {
    const f = chartFrame({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, { w: 200, h: 100 });
    expect(f.maxX - f.minX).toBeCloseTo(2);
    expect(f.maxY - f.minY).toBeCloseTo(1);
    expect((f.minX + f.maxX) / 2).toBe(5);
  });
});

describe('boxOf and unionBox', () => {
  it('bounds the points, and nothing for none', () => {
    expect(boxOf([])).toBeUndefined();
    expect(
      boxOf([
        { x: 3, y: -1 },
        { x: -2, y: 4 },
      ]),
    ).toEqual({ minX: -2, minY: -1, maxX: 3, maxY: 4 });
  });

  it('grows a frame to take in moved numbers', () => {
    const frame = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(unionBox(frame)).toEqual(frame);
    expect(unionBox(frame, { minX: 5, minY: -3, maxX: 12, maxY: 6 })).toEqual({ minX: 0, minY: -3, maxX: 12, maxY: 10 });
  });
});

describe('clampDelta', () => {
  const frame = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const group = { minX: 40, minY: 40, maxX: 60, maxY: 60 };

  it('moves freely inside the frame', () => {
    expect(clampDelta(group, frame, 15, -25)).toEqual([15, -25]);
  });

  it('stops the group at each edge', () => {
    expect(clampDelta(group, frame, 80, 0)).toEqual([40, 0]);
    expect(clampDelta(group, frame, -80, 0)).toEqual([-40, 0]);
    expect(clampDelta(group, frame, 0, 80)).toEqual([0, 40]);
    expect(clampDelta(group, frame, 0, -80)).toEqual([0, -40]);
  });

  it('never pushes a group that is already outside further out, but lets it back in', () => {
    const out = { minX: 90, minY: 40, maxX: 120, maxY: 60 };
    expect(clampDelta(out, frame, 10, 0)).toEqual([0, 0]);
    expect(clampDelta(out, frame, -30, 0)).toEqual([-30, 0]);
    expect(clampDelta(out, frame, -100, 0)).toEqual([-90, 0]);
  });
});

describe('pickInRect', () => {
  const points: [string, { x: number; y: number }][] = [
    ['a', { x: 0, y: 0 }],
    ['b', { x: 10, y: 10 }],
    ['c', { x: 20, y: 5 }],
    ['d', { x: -5, y: 30 }],
  ];

  it('picks the numbers inside, whichever way the box was dragged', () => {
    expect(pickInRect(points, { x: -1, y: -1 }, { x: 15, y: 15 })).toEqual(['a', 'b']);
    expect(pickInRect(points, { x: 15, y: 15 }, { x: -1, y: -1 })).toEqual(['a', 'b']);
    expect(pickInRect(points, { x: 25, y: -1 }, { x: 5, y: 12 })).toEqual(['b', 'c']);
  });

  it('counts a number on the edge as inside, and none for an empty box', () => {
    expect(pickInRect(points, { x: 10, y: 10 }, { x: 20, y: 5 })).toEqual(['b', 'c']);
    expect(pickInRect(points, { x: 40, y: 40 }, { x: 50, y: 50 })).toEqual([]);
  });
});
