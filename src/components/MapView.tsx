import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import outline from '../assets/region-outline.json';
import { approxLevelTh } from '../lib/labels';
import { CHROME, slotColor, type ThemeMode } from '../lib/palette';
import type { ApproxLevel } from '../lib/types';
import { escapeHtml } from './download';

export interface MapSite {
  key: string;
  lat: number;
  lon: number;
  slot: number;
  label: string;
  count: number;
  approx: boolean;
  /** For approximate positions: the area whose point was used. */
  approxLevel?: ApproxLevel;
  lines: string[];
  /** square: a position that is NOT the target's (the other party's). */
  shape?: 'circle' | 'square';
}

export interface MapPath {
  slot: number;
  points: { lat: number; lon: number; label: string; time: string }[];
}

interface Props {
  sites: MapSite[];
  paths: MapPath[];
  showBasemap: boolean;
  mode: ThemeMode;
  /** Changing this re-fits the view to the data. */
  fitKey: string;
}

/** The whole of Thailand: where the map opens and where "ทั้งประเทศ" goes back to. */
const THAILAND = L.latLngBounds([
  [5.6, 97.3],
  [20.5, 105.7],
]);

function showThailand(m: L.Map) {
  m.fitBounds(THAILAND, { padding: [10, 10], animate: false });
}

/**
 * Frames points (a day's route, or the sites) without inviting street-level
 * zoom on approximate positions: a subdistrict point allows about town
 * level, a district point less, a province point only the region.
 */
function frame(m: L.Map, pts: L.LatLngTuple[], framed: MapSite[]) {
  if (pts.length === 0) return;
  const coarse = framed.length > 0 && framed.every((s) => s.approx);
  const maxZoom = !coarse ? 14 : framed.some((s) => s.approxLevel === 'province') ? 8 : framed.some((s) => s.approxLevel === 'amphur') ? 10 : 12;
  if (pts.length === 1) m.setView(pts[0], Math.min(12, maxZoom), { animate: false });
  else m.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom, animate: false });
}

/** The target's own positions set the frame; the other party's only when there are none. */
function framedSites(sites: MapSite[]): MapSite[] {
  const own = sites.filter((s) => s.shape !== 'square');
  return own.length ? own : sites;
}

/**
 * Leaflet map. An offline outline of Thailand and its neighbours sits in a
 * pane BELOW the tiles, so it shows whenever tiles are off or unreachable.
 * Markers are vector circles (no image assets) with a surface-coloured ring;
 * positions that are not the target's are squares.
 */
export function MapView({ sites, paths, showBasemap, mode, fitKey }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>(null);
  const tiles = useRef<L.TileLayer>(null);
  const outlineLayer = useRef<L.GeoJSON>(null);
  const data = useRef<L.LayerGroup>(null);
  // The map's own buttons read the sites shown now, not those at creation.
  const current = useRef(sites);
  current.current = sites;

  useEffect(() => {
    if (!el.current) return;
    const box = el.current;
    const m = L.map(box, { preferCanvas: true, zoomSnap: 0.5, worldCopyJump: false });
    // Tests and styles can read the zoom level off the box.
    m.on('zoomend', () => (box.dataset.zoom = String(m.getZoom())));
    showThailand(m);
    // Below + and −: back to the whole country, or in to the target's sites.
    const ViewButtons = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const bar = L.DomUtil.create('div', 'leaflet-bar map-view-buttons');
        const button = (text: string, label: string, action: () => void) => {
          const b = L.DomUtil.create('button', '', bar);
          b.type = 'button';
          b.textContent = text;
          b.title = label;
          b.setAttribute('aria-label', label);
          L.DomEvent.on(b, 'click', (e) => {
            L.DomEvent.stop(e);
            action();
          });
        };
        button('ทั้งประเทศ', 'ดูทั้งประเทศไทย', () => showThailand(m));
        button('ซูมไปที่เสา', 'ซูมไปที่เสาของเป้าหมาย', () => {
          const sites = framedSites(current.current);
          frame(m, sites.map((s) => [s.lat, s.lon] as L.LatLngTuple), sites);
        });
        L.DomEvent.disableClickPropagation(bar);
        return bar;
      },
    });
    new ViewButtons().addTo(m);
    m.createPane('outline');
    m.getPane('outline')!.style.zIndex = '150';
    outlineLayer.current = L.geoJSON(outline as GeoJSON.FeatureCollection, { pane: 'outline', interactive: false }).addTo(m);
    data.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      map.current = null;
      // Leaflet finishes a zoom animation from a 250 ms timer that reads the
      // map panes; removing the map before it fires throws "_leaflet_pos".
      m.stop();
      setTimeout(() => m.remove(), 300);
    };
  }, []);

  useEffect(() => {
    const c = CHROME[mode];
    outlineLayer.current?.setStyle((f) => ({
      color: c.axis,
      weight: 1,
      fillColor: f?.properties?.thailand ? (mode === 'light' ? '#e6eaf2' : '#1a2740') : mode === 'light' ? '#f3f5f9' : '#121c30',
      fillOpacity: 1,
    }));
  }, [mode]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (showBasemap && !tiles.current) {
      tiles.current = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; ผู้ร่วมพัฒนา <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m);
    } else if (!showBasemap && tiles.current) {
      tiles.current.remove();
      tiles.current = null;
    }
  }, [showBasemap]);

  useEffect(() => {
    const g = data.current;
    if (!g) return;
    g.clearLayers();
    const c = CHROME[mode];
    const showingPath = paths.some((p) => p.points.length > 0);
    const max = Math.max(1, ...sites.filter((s) => s.shape !== 'square').map((s) => s.count));
    const maxSquare = Math.max(1, ...sites.filter((s) => s.shape === 'square').map((s) => s.count));
    for (const s of sites) {
      const color = slotColor(s.slot, mode);
      // With a day path on screen the sites recede so the route reads first.
      const opacity = showingPath ? 0.2 : s.approx ? 0.4 : 0.85;
      const tip = `${escapeHtml(s.label)}${s.approx ? ' (ตำแหน่งโดยประมาณ)' : ''}`;
      const popup = `<strong>${escapeHtml(s.label)}</strong><br>${s.lines.map(escapeHtml).join('<br>')}${s.approx ? `<br><em>ไม่มีพิกัดในไฟล์ — แสดงที่จุดกลาง${approxLevelTh(s.approxLevel)}ตามชื่อพื้นที่ในไฟล์</em>` : ''}`;
      if (s.shape === 'square') {
        const side = Math.round(12 + 12 * Math.sqrt(s.count / maxSquare));
        L.marker([s.lat, s.lon], {
          icon: L.divIcon({
            className: 'peer-square',
            iconSize: [side, side],
            html: `<span style="background:${color};opacity:${showingPath ? 0.3 : s.approx ? 0.5 : 0.9};border-color:${c.surface}"></span>`,
          }),
          keyboard: false,
        })
          .bindTooltip(`■ ${tip} — ตำแหน่งของคู่สาย`)
          .bindPopup(popup)
          .addTo(g);
        continue;
      }
      L.circleMarker([s.lat, s.lon], {
        radius: 5 + 13 * Math.sqrt(s.count / max),
        color: c.surface,
        weight: showingPath ? 1 : 2,
        fillColor: color,
        fillOpacity: opacity,
      })
        .bindTooltip(tip)
        .bindPopup(popup)
        .addTo(g);
    }
    for (const p of paths) {
      if (p.points.length < 1) continue;
      const color = slotColor(p.slot, mode);
      L.polyline(
        p.points.map((x) => [x.lat, x.lon] as L.LatLngTuple),
        { color, weight: 2.5, opacity: 0.95 },
      ).addTo(g);
      p.points.forEach((x, i) => {
        L.circleMarker([x.lat, x.lon], { radius: 5, color: c.surface, weight: 2, fillColor: color, fillOpacity: 1 })
          .bindTooltip(`${i + 1}. ${escapeHtml(x.time)} — ${escapeHtml(x.label)}`)
          .addTo(g);
      });
    }
  }, [sites, paths, mode]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    // A day's route the user picked takes the frame; otherwise the map opens
    // on the whole country and the "ซูมไปที่เสา" button goes to the sites.
    const pathPts = paths.flatMap((p) => p.points.map((x) => [x.lat, x.lon] as L.LatLngTuple));
    if (pathPts.length) frame(m, pathPts, framedSites(sites));
    else showThailand(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return <div ref={el} className={`map-box${mode === 'dark' ? ' map-dark' : ''}`} role="region" aria-label="แผนที่เสาสัญญาณ" />;
}
