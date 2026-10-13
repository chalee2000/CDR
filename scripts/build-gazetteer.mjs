// Builds src/assets/th-area-centroids.json: a point for every Thai
// subdistrict (tambon/khwaeng) and district (amphoe/khet), keyed by Thai
// names. CDR files without cell coordinates (AIS) place each site at its
// subdistrict, else its district, instead of around the province centre.
//
// Sources:
// - Subdistrict points and Thai names: kongvut/thai-province-data
//   (MIT License, Copyright (c) 2025 Kongvut Sangkla),
//   https://github.com/kongvut/thai-province-data
// - District boundaries: geoBoundaries THA ADM2 (Royal Thai Survey
//   Department, OCHA ROAP; CC BY 3.0 IGO), https://www.geoboundaries.org
//   A district's point is a point inside its boundary near its centre, so
//   districts whose subdistricts have no points (all of Bangkok) still get
//   one, and a subdistrict point lying outside its own district is dropped.
//
//   npm run make:gazetteer            (downloads the source files)
//   npm run make:gazetteer -- <dir>   (reads sub_district.json, district.json,
//                                      province.json, ADM1.geojson, ADM2.geojson from <dir>)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KONGVUT = 'https://raw.githubusercontent.com/kongvut/thai-province-data/master/api/latest/';
const GEOBOUNDARIES = 'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/THA/';
const dir = process.argv[2];
async function load(name, url) {
  if (dir) return JSON.parse(readFileSync(join(dir, name), 'utf8'));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

// Must match areaKey() in src/lib/analysis/locations.ts.
const key = (v) =>
  String(v ?? '')
    .trim()
    .replace(/^(จังหวัด|จ\.|กิ่งอำเภอ|อำเภอ|อ\.|เขต|ตำบล|ต\.|แขวง)\s*/, '')
    .replace(/\s+/g, '');
const en = (v) => String(v ?? '').toLowerCase().replace(/ province$/, '').replace(/[^a-z]/g, '');
const r4 = (x) => Math.round(x * 1e4) / 1e4;

// --- Geometry on [lon, lat] rings (GeoJSON order) ---------------------------
const polygonsOf = (f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates);
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolygon = (p, poly) => inRing(p, poly[0]) && !poly.slice(1).some((hole) => inRing(p, hole));
const inFeature = (p, f) => polygonsOf(f).some((poly) => inPolygon(p, poly));
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}
/** Kilometres from a point to the nearest edge of a feature (equirectangular, fine at this scale). */
function kmToEdge([x, y], f) {
  const kx = 111.32 * Math.cos((y * Math.PI) / 180);
  const ky = 110.57;
  let best = Infinity;
  for (const poly of polygonsOf(f)) {
    for (const ring of poly) {
      for (let i = 1; i < ring.length; i++) {
        const ax = (ring[i - 1][0] - x) * kx, ay = (ring[i - 1][1] - y) * ky;
        const bx = (ring[i][0] - x) * kx, by = (ring[i][1] - y) * ky;
        const dx = bx - ax, dy = by - ay;
        const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
        best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
      }
    }
  }
  return best;
}
/**
 * A point inside the feature near its centre: the centroid of its largest
 * part when that lies inside (most districts), else the inside point that
 * is farthest from the boundary on a grid over the part (U-shaped coasts).
 */
function interiorPoint(f) {
  const polys = polygonsOf(f);
  const poly = polys.reduce((a, b) => (Math.abs(ringArea(b[0])) > Math.abs(ringArea(a[0])) ? b : a));
  const ring = poly[0];
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    cx += (ring[j][0] + ring[i][0]) * cross;
    cy += (ring[j][1] + ring[i][1]) * cross;
    a += cross;
  }
  const c = [cx / (3 * a), cy / (3 * a)];
  const part = { geometry: { type: 'Polygon', coordinates: poly } };
  if (inPolygon(c, poly) && kmToEdge(c, part) > 0.5) return c;
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let best = c, bestD = -1;
  for (let i = 1; i < 40; i++) {
    for (let j = 1; j < 40; j++) {
      const p = [x0 + ((x1 - x0) * i) / 40, y0 + ((y1 - y0) * j) / 40];
      if (!inPolygon(p, poly)) continue;
      const d = kmToEdge(p, part);
      if (d > bestD) [best, bestD] = [p, d];
    }
  }
  return best;
}

// --- Load ---------------------------------------------------------------------
const [subs, districts, provinces, adm1, adm2] = await Promise.all([
  load('sub_district.json', `${KONGVUT}sub_district.json`),
  load('district.json', `${KONGVUT}district.json`),
  load('province.json', `${KONGVUT}province.json`),
  load('ADM1.geojson', `${GEOBOUNDARIES}ADM1/geoBoundaries-THA-ADM1_simplified.geojson`),
  load('ADM2.geojson', `${GEOBOUNDARIES}ADM2/geoBoundaries-THA-ADM2_simplified.geojson`),
]);
const live = (x) => !x.deleted_at;
const pById = new Map(provinces.filter(live).map((p) => [p.id, p]));
const dById = new Map(districts.filter(live).map((d) => [d.id, d]));
const subsOf = new Map();
for (const s of subs.filter(live)) {
  if (!dById.has(s.district_id)) continue;
  if (!subsOf.has(s.district_id)) subsOf.set(s.district_id, []);
  subsOf.get(s.district_id).push(s);
}
const hasPoint = (s) => typeof s.lat === 'number' && typeof s.long === 'number';

// Province boundaries by English name.
const provByEn = new Map([...pById.values()].map((p) => [en(p.name.en), p]));
const provFeature = new Map();
for (const f of adm1.features) {
  const p = provByEn.get(en(f.properties.shapeName));
  if (!p) throw new Error(`province boundary without a match: ${f.properties.shapeName}`);
  provFeature.set(p.id, f);
}

// District boundaries, matched by English name. A name used in several
// places is narrowed to the province around the district (the simplified
// outlines disagree near borders, so the nearest province when none contains
// it), then to the district most of the subdistrict points inside it belong to.
const ALIASES = { vadhana: 'watthana' };
const distByEn = new Map();
for (const d of dById.values()) {
  const k = en(d.name.en);
  if (!distByEn.has(k)) distByEn.set(k, []);
  distByEn.get(k).push(d);
}
function provinceAround(at) {
  const inside = [...provFeature].find(([, pf]) => inFeature(at, pf));
  if (inside) return inside[0];
  return [...provFeature].map(([id, pf]) => [id, kmToEdge(at, pf)]).sort((a, b) => a[1] - b[1])[0][0];
}
function byVotes(f, candidates) {
  const votes = new Map();
  for (const c of candidates) for (const s of subsOf.get(c.id) ?? []) if (hasPoint(s) && inFeature([s.long, s.lat], f)) votes.set(c.id, (votes.get(c.id) ?? 0) + 1);
  const top = [...votes].sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= 2 ? dById.get(top[0]) : undefined;
}
const distFeature = new Map();
const unmatched = [];
for (const f of adm2.features) {
  const at = interiorPoint(f);
  const name = en(f.properties.shapeName);
  let candidates = distByEn.get(ALIASES[name] ?? name) ?? [];
  if (candidates.length > 1) {
    const prov = provinceAround(at);
    candidates = candidates.filter((c) => c.province_id === prov);
  }
  const d = candidates.length === 1 ? candidates[0] : byVotes(f, candidates.length ? candidates : [...dById.values()].filter((c) => c.province_id === provinceAround(at)));
  if (!d || distFeature.has(d.id)) {
    unmatched.push(f.properties.shapeName);
    continue;
  }
  distFeature.set(d.id, { f, at });
}

// --- Output -------------------------------------------------------------------
const out = {};
let points = 0, dropped = 0, moved = 0, viaBoundary = 0;
const droppedNames = [];
for (const d of dById.values()) {
  const p = pById.get(d.province_id);
  if (!p) continue;
  const tambons = {};
  const boundary = distFeature.get(d.id);
  for (const s of subsOf.get(d.id) ?? []) {
    if (!hasPoint(s)) continue;
    let at = [s.long, s.lat];
    if (boundary && !inFeature(at, boundary.f)) {
      // Simplified boundaries are off by up to a few hundred metres: a point
      // within 1.5 km of its district moves inward (toward the district's
      // point) so coastal subdistricts stay on land; farther ones are wrong.
      if (kmToEdge(at, boundary.f) > 1.5) {
        dropped++;
        droppedNames.push(`${p.name.th}/${d.name.th}/${s.name.th}`);
        continue;
      }
      const from = at;
      at = boundary.at;
      for (let i = 1; i < 20; i++) {
        const q = [from[0] + ((boundary.at[0] - from[0]) * i) / 20, from[1] + ((boundary.at[1] - from[1]) * i) / 20];
        if (inFeature(q, boundary.f) && kmToEdge(q, boundary.f) > 0.3) {
          at = q;
          break;
        }
      }
      moved++;
    }
    tambons[key(s.name.th)] = [r4(at[1]), r4(at[0])];
    points++;
  }
  const pts = Object.values(tambons);
  // District point: inside its boundary, else the mean of its subdistricts.
  if (boundary) {
    tambons[''] = [r4(boundary.at[1]), r4(boundary.at[0])];
    viaBoundary++;
  } else if (pts.length) {
    tambons[''] = [r4(pts.reduce((a, q) => a + q[0], 0) / pts.length), r4(pts.reduce((a, q) => a + q[1], 0) / pts.length)];
  } else continue;
  (out[key(p.name.th)] ??= {})[key(d.name.th)] = tambons;
}

const file = new URL('../src/assets/th-area-centroids.json', import.meta.url);
writeFileSync(
  file,
  JSON.stringify({
    source:
      'Subdistricts: kongvut/thai-province-data (MIT License, Copyright (c) 2025 Kongvut Sangkla). Districts: geoBoundaries THA ADM2, Royal Thai Survey Department and OCHA ROAP (CC BY 3.0 IGO), https://www.geoboundaries.org',
    areas: out,
  }),
);
const nDistricts = Object.values(out).reduce((a, x) => a + Object.keys(x).length, 0);
console.log(`wrote ${file.pathname}: ${points} subdistricts, ${nDistricts} districts (${viaBoundary} from boundaries) in ${Object.keys(out).length} provinces`);
console.log(`moved ${moved} subdistrict points just outside their district inward; dropped ${dropped} outside their district${dropped ? `: ${droppedNames.join(', ')}` : ''}`);
if (unmatched.length) console.log(`district boundaries without a match: ${unmatched.join(', ')}`);
