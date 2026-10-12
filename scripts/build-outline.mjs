// Builds src/assets/region-outline.json: Thailand and its neighbours from
// Natural Earth 1:50m (world-atlas), coordinates rounded to keep it small.
// The map draws this offline basemap under (or instead of) online tiles.
//
//   npm run make:outline
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';

const NAMES = { '764': 'ไทย', '104': 'เมียนมา', '418': 'ลาว', '116': 'กัมพูชา', '458': 'มาเลเซีย', '704': 'เวียดนาม' };
const topo = JSON.parse(readFileSync(new URL('../node_modules/world-atlas/countries-50m.json', import.meta.url), 'utf8'));
const all = feature(topo, topo.objects.countries);

const round = (c) => (typeof c[0] === 'number' ? [Math.round(c[0] * 1000) / 1000, Math.round(c[1] * 1000) / 1000] : c.map(round));

const features = all.features
  .filter((f) => NAMES[f.id])
  .map((f) => ({ type: 'Feature', properties: { name: NAMES[f.id], thailand: f.id === '764' }, geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) } }));

const out = new URL('../src/assets/region-outline.json', import.meta.url);
writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`wrote ${out.pathname} (${features.length} countries)`);
