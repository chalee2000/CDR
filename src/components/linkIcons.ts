import { photoImage } from './photo';

/**
 * Node icons for the link chart, investigation-chart style: a glyph (or the
 * person's photo) inside a circle with a ring in the colour(s) of the targets
 * the number is linked to. Drawn on a canvas at 3x and cached as PNG data
 * URLs, so they stay sharp when zoomed and export cleanly. Only our own glyph
 * paths and palette colours are drawn — never user text.
 */

export type Glyph = 'mobile' | 'landline' | 'globe' | 'service' | 'other' | 'person';

interface GlyphDef {
  d: string;
  stroke?: boolean;
  evenodd?: boolean;
}

// 24 x 24 glyphs drawn for this app.
const GLYPHS: Record<Glyph, GlyphDef> = {
  mobile: {
    d: 'M8.5 2.5h7a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2z M8.6 5h6.8v11.6H8.6z M10.85 18.85a1.15 1.15 0 1 0 2.3 0a1.15 1.15 0 1 0-2.3 0z',
    evenodd: true,
  },
  landline: {
    d: 'M3.5 8.2C3.5 6.1 7.3 4.5 12 4.5s8.5 1.6 8.5 3.7v1.6c0 .7-.6 1.2-1.3 1.2h-2.4c-.7 0-1.3-.5-1.3-1.2V8.6c-1.1-.3-2.3-.4-3.5-.4s-2.4.1-3.5.4v1.2c0 .7-.6 1.2-1.3 1.2H4.8c-.7 0-1.3-.5-1.3-1.2z M8 11.6h8l3.6 6.3c.5.9-.2 2.1-1.2 2.1H5.6c-1 0-1.7-1.2-1.2-2.1z M10 16.3a2 2 0 1 0 4 0a2 2 0 1 0-4 0z',
    evenodd: true,
  },
  globe: {
    d: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0z M12 3c-2.6 2.5-4 5.6-4 9s1.4 6.5 4 9 M12 3c2.6 2.5 4 5.6 4 9s-1.4 6.5-4 9 M3.7 9h16.6 M3.7 15h16.6',
    stroke: true,
  },
  service: {
    d: 'M3.5 20.5V9.2L12 3.5l8.5 5.7v11.3h-6v-5h-5v5z M6.9 10.6h2.3v2.3H6.9z M10.85 10.6h2.3v2.3h-2.3z M14.8 10.6h2.3v2.3h-2.3z',
    evenodd: true,
  },
  other: { d: 'M9.6 4 7.6 20 M16.4 4l-2 16 M4.5 9h15.2 M3.8 15h15.2', stroke: true },
  person: { d: 'M12 3.4a4.3 4.3 0 1 1 0 8.6a4.3 4.3 0 1 1 0-8.6z M3.7 20.6c.4-4.2 4-6.9 8.3-6.9s7.9 2.7 8.3 6.9z' },
};

export interface IconSpec {
  glyph: Glyph;
  /** Displayed diameter in CSS px. */
  size: number;
  fill: string;
  ink: string;
  /** One colour = full ring; several = equal arcs (a contact shared by targets). */
  ring: string[];
  ringWidth: number;
  /** Outer halo ring (targets get a double ring). */
  halo?: string;
  /** Criminal-record mark at the top right. */
  badge?: { fill: string; ink: string; edge: string };
  /** Person photo (validated data URL); the glyph shows until it is decoded. */
  photo?: string;
}

const SCALE = 3;
const cache = new Map<string, string>();
const photoIds = new Map<string, number>();

export function iconUrl(spec: IconSpec): string {
  const img = spec.photo ? photoImage(spec.photo) : undefined;
  let photoKey = '';
  if (spec.photo) {
    if (!photoIds.has(spec.photo)) photoIds.set(spec.photo, photoIds.size + 1);
    photoKey = `${photoIds.get(spec.photo)}${img ? '' : '-pending'}`;
  }
  const key = [spec.glyph, Math.round(spec.size), spec.fill, spec.ink, spec.ring.join('/'), spec.ringWidth, spec.halo ?? '', spec.badge ? `${spec.badge.fill}${spec.badge.ink}${spec.badge.edge}` : '', photoKey].join('|');
  let url = cache.get(key);
  if (!url) {
    url = draw(spec, img);
    cache.set(key, url);
  }
  return url;
}

function draw(spec: IconSpec, img?: HTMLImageElement): string {
  const px = Math.max(8, Math.round(spec.size * SCALE));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const c = px / 2;
  const full = Math.PI * 2;
  let r = c - SCALE;
  const disc = (radius: number, colour: string) => {
    ctx.beginPath();
    ctx.arc(c, c, radius, 0, full);
    ctx.fillStyle = colour;
    ctx.fill();
  };

  if (spec.halo) {
    disc(r, spec.ring[0] ?? spec.fill);
    r -= 2 * SCALE;
    disc(r, spec.halo);
    r -= 1.5 * SCALE;
  }
  const rw = spec.ringWidth * SCALE;
  if (spec.ring.length <= 1) {
    disc(r, spec.ring[0] ?? spec.fill);
  } else {
    // Equal arcs with small gaps, one per linked target, starting at 12 o'clock.
    disc(r, spec.fill);
    const gap = (6 * Math.PI) / 180;
    const seg = full / spec.ring.length;
    ctx.lineWidth = rw;
    ctx.lineCap = 'butt';
    spec.ring.forEach((colour, i) => {
      ctx.beginPath();
      ctx.arc(c, c, r - rw / 2, -Math.PI / 2 + i * seg + gap / 2, -Math.PI / 2 + (i + 1) * seg - gap / 2);
      ctx.strokeStyle = colour;
      ctx.stroke();
    });
  }
  const inner = r - rw;
  disc(inner, spec.fill);

  if (img) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, inner, 0, full);
    ctx.clip();
    ctx.drawImage(img, c - inner, c - inner, inner * 2, inner * 2);
    ctx.restore();
  } else {
    const g = GLYPHS[spec.glyph];
    const box = inner * 1.22;
    ctx.save();
    ctx.translate(c - box / 2, c - box / 2);
    ctx.scale(box / 24, box / 24);
    const path = new Path2D(g.d);
    if (g.stroke) {
      ctx.strokeStyle = spec.ink;
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(path);
    } else {
      ctx.fillStyle = spec.ink;
      ctx.fill(path, g.evenodd ? 'evenodd' : 'nonzero');
    }
    ctx.restore();
  }

  if (spec.badge) {
    const br = px * 0.15;
    const off = (r - br * 0.6) * Math.SQRT1_2;
    const bx = c + off;
    const by = c - off;
    ctx.beginPath();
    ctx.arc(bx, by, br + 1.5 * SCALE, 0, full);
    ctx.fillStyle = spec.badge.edge;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, full);
    ctx.fillStyle = spec.badge.fill;
    ctx.fill();
    ctx.fillStyle = spec.badge.ink;
    ctx.font = `700 ${Math.round(br * 1.45)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', bx, by + br * 0.06);
  }
  return canvas.toDataURL('image/png');
}
