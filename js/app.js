import { AEMET_API_KEY, AEMET_KEY_EXPIRES } from './aemet-key.js';
import { bestRoute, avoidAreas, nm as nmDist, MAX_LEG_NM } from './routelib.js';
import { AERODROMES, POINTS, FLEET_TYPES, fleetType, SOP, adByIcao, mergeAip, procedureFor, PROCEDURES } from './data.js';
import { computeNavlog, stdFlags, fuelPolicy, fmtMMSS, fmtHMS, fmtVar, fmtAlt, parseAlt, cruiseTas, distanceNm, midpoint, trueCourse } from './nav.js';
import { buildNavlogPdf, buildMbPdf, PER_SIDE } from './pdf.js';
import { addBriefingPages, addMissionCover, fonts as pdfFonts, pdfText } from './briefpdf.js';
import { renderRouteMap, addMapPage } from './mapprint.js';
import { parseBulletin, pdfLines, notamFlags, pdfFirstPageCanvas } from './notam.js';
import { sampleTerrain, plannedProfile, drawProfile, profileAt } from './profile.js';
import { PlacesLayer } from './places.js';
import { fetchWinds } from './winds.js';
import { fetchWeather, assess, metarSummary, crosswind } from './weather.js';
import { performance, pressureAlt, isaTemp, FT_PER_M } from './perf.js';
import { chartAirspaces, drawAirspaces, drawAmaGrid, airspaceLabels, worldPx as wpx, drawNavaids, navaidLabel, drawObstacles } from './aviation.js';
import { MB_TYPES, computeMb, fmtMoment, cgLimitsAt, KG_TO_LB } from './mb.js';
import { zl, utc, local } from './time.js';
import { APPROVED, IFR_ONLY, EASY_FIRST, FULL_STOP, CLOSING_LOCAL, NO_REFUEL, FREQS, AIP_NOTES, aipNotes, aerodromeOpen, airspaceCrossings, crossingIssue, buildFpl, departureBriefing, arrivalBriefing, temThreats } from './rules.js';
import { listPlans, savePlan, deletePlan, getPlan, planFromPdf, embedPlan, mergePlans } from './plans.js';
import { sunTimes } from './sun.js';

const L = window.L;
const LEBG = adByIcao('LEBG');
const STORE = 'navlog.v1';
const STEP_MIN = 5; // slider steps of 5 minutes
const MAX_DAYS = 3; // plan at most 3 days ahead
let wxState = { key: '', data: null, err: null, loading: false }; // METAR/TAF for the planned aerodromes
const acOf = (type) => MB_TYPES[type] || MB_TYPES.P2008;

/* ---------------- State ---------------- */

const defaultState = () => ({
  main: { waypoints: [adWaypoint(LEBG)], stdDep: true, stdArr: true },
  alt: { waypoints: [], stdDep: false, stdArr: false },
  active: 'main',
  time: null,
  flight: { callsign: '', type: 'P2008', reg: 'EC-ODX', pilot: '', copilot: '', baggage: 0, baggage2: 0, pax: '', pax1: '', pax2: '', emptyMass: '', emptyMoment: '', fob: 120, taxi: '', extra: 0, weather: '', solo: false, pob: 2, lowCloud: false, levelMode: 'fl' },
  view: { base: 'chart', chartV: 1, namesV: 1, points: true, marks: true, names: true, profile: true, winds: true, panel: true },
  unlocked: ['LEBG', 'LERJ'],
  tem: {},
  windSource: null,
  planId: null,
  mb: { studentCode: '', notams: '', tripSource: 'route', tripManual: '', altManual: '' },
  // personal settings (Settings): name, signature, callsigns
  settings: { name: '', signature: '', callsign: '', soloOut: '', soloIn: '' },
  mode: 'mission', // new users start at step 1
});

let uid = Date.now();
let state = load();
let result = null;

function adWaypoint(ad) {
  return { id: ++uid, name: ad.icao, lat: ad.lat, lon: ad.lon, ref: ad.icao, var: ad.var };
}

// a number that could not be read (e.g. typed with a comma by an older version) is saved as null: start it empty
// Pilot mass: the value typed in the M&B, or "my mass" from Settings
function stationMass(f, id) {
  if (id === 'pilot' && (f.pilot === '' || f.pilot == null) && state.settings && state.settings.myMass) return state.settings.myMass;
  return f[id];
}
function cleanNums(o) { return Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, v === null || (typeof v === 'number' && !Number.isFinite(v)) ? '' : v])); }
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s && s.main) { const d = defaultState(); return { ...d, ...s, flight: { ...d.flight, ...cleanNums(s.flight) }, view: { ...d.view, ...s.view, ...(s.view && s.view.chartV ? {} : { base: 'chart', chartV: 1 }), ...(s.view && s.view.namesV ? {} : { names: true, namesV: 1 }) }, mb: { ...d.mb, ...s.mb }, settings: { ...d.settings, ...s.settings }, unlocked: s.unlocked || d.unlocked, tem: s.tem || {} }; }
  } catch (err) {
    // never lose saved work to a bug: keep the stored copy aside before starting fresh
    console.error('Could not read the saved state', err);
    try { const raw = localStorage.getItem(STORE); if (raw) localStorage.setItem(`${STORE}.backup`, raw); } catch { /* storage blocked */ }
  }
  // Settings (name, signature, callsigns, unlocked aerodromes) are also kept on their own
  const d = defaultState();
  try { const k = JSON.parse(localStorage.getItem(`${STORE}.settings`)); if (k) { d.settings = { ...d.settings, ...k.settings }; if (k.unlocked) d.unlocked = k.unlocked; } } catch { /* none */ }
  return d;
}
function save() {
  if (typeof syncActiveLeg === 'function') syncActiveLeg();
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* private mode */ }
  try { localStorage.setItem(`${STORE}.settings`, JSON.stringify({ settings: state.settings, unlocked: state.unlocked })); } catch { /* private mode */ }
}

const route = (k = state.active) => state[k];

/* ---------------- Time ---------------- */

const slider = document.getElementById('timeSlider');
const base = new Date();
base.setSeconds(0, 0);
base.setMinutes(Math.floor(base.getMinutes() / STEP_MIN) * STEP_MIN);

function defaultTime() {
  const t = new Date(base.getTime() + 60 * 60e3);
  const { rise, set } = sunTimes(t, LEBG.lat, LEBG.lon);
  if (rise && set && (t < rise || t > new Date(set.getTime() - 2 * 3600e3))) {
    // outside daylight: suggest 10:00 local the next morning
    const d = new Date(t); if (t > set) d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return d;
  }
  return t;
}
function flightTime() {
  if (!state.time) return defaultTime();
  const t = new Date(state.time);
  // an old saved time in the past snaps to the nearest valid time
  return t < base ? defaultTime() : t;
}
function syncSlider() {
  const t = flightTime();
  let v = Math.round((t - base) / (STEP_MIN * 60e3));
  v = Math.max(0, Math.min(+slider.max, v));
  slider.value = v;
  slider.style.setProperty('--p', `${(v / slider.max) * 100}%`);
}
slider.max = (MAX_DAYS * 24 * 60) / STEP_MIN;
function setTime(t) {
  const min = base.getTime(), max = base.getTime() + MAX_DAYS * 864e5;
  t = new Date(Math.min(max, Math.max(min, t.getTime())));
  t.setSeconds(0, 0); t.setMinutes(Math.round(t.getMinutes() / STEP_MIN) * STEP_MIN);
  state.time = t.toISOString();
  syncSlider();
}
document.getElementById('timeMinus').addEventListener('click', () => { setTime(new Date(flightTime().getTime() - STEP_MIN * 60e3)); update(); });
document.getElementById('timePlus').addEventListener('click', () => { setTime(new Date(flightTime().getTime() + STEP_MIN * 60e3)); update(); });
slider.addEventListener('input', () => {
  state.time = new Date(base.getTime() + slider.value * STEP_MIN * 60e3).toISOString();
  slider.style.setProperty('--p', `${(slider.value / slider.max) * 100}%`);
  renderTime();
  scheduleSave();
});
slider.addEventListener('change', () => update());

const picker = document.getElementById('timePicker');
document.getElementById('timeLabel').addEventListener('click', () => {
  const t = flightTime();
  const local = new Date(t.getTime() - t.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  picker.value = local;
  if (picker.showPicker) { try { picker.showPicker(); return; } catch { /* fall through */ } }
  picker.focus(); picker.click();
});
picker.addEventListener('change', () => {
  if (!picker.value) return;
  const t = new Date(picker.value);
  if (t > new Date(base.getTime() + MAX_DAYS * 864e5)) toast(`Plans can be made up to ${MAX_DAYS} days ahead`);
  setTime(t);
  update();
});

const dFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const zFmt = zl;

// Keep the time card clear of the logo pill: size it from the right column's real width.
const rightCol = document.querySelector('.rightcol');
const syncRightCol = () => document.documentElement.style.setProperty('--rc-w', `${Math.ceil(rightCol.getBoundingClientRect().width)}px`);
if (window.ResizeObserver) new ResizeObserver(syncRightCol).observe(rightCol);
syncRightCol();

function renderTime() {
  const t = flightTime();
  document.getElementById('timeMain').textContent = `${dFmt.format(t)} · ${utc(t)} (${local(t)})`;
  document.getElementById('timeSub').textContent = 'T/O';
  const dep = state.main.waypoints[0] || { lat: LEBG.lat, lon: LEBG.lon };
  const { rise, set } = sunTimes(t, dep.lat, dep.lon);
  const total = result ? result.main.totals.timeSec : 0;
  const ldg = new Date(t.getTime() + total * 1000);
  const parts = [];
  if (rise) parts.push(`<span class="${t < rise ? 'warn' : ''}">SR ${zFmt(rise)}</span>`);
  if (set) parts.push(`<span class="${ldg > set ? 'warn' : ''}">SS ${zFmt(set)}</span>`);
  if (total) parts.push(`<span class="${set && ldg > set ? 'warn' : ''}">Ldg ${zFmt(ldg)}</span>`);
  document.getElementById('sunRow').innerHTML = parts.join('');
}

/* ---------------- Map ---------------- */

const map = L.map('map', {
  zoomControl: false, attributionControl: false, minZoom: 6, maxZoom: 14, worldCopyJump: false,
  center: [LEBG.lat, LEBG.lon], zoom: 10, tap: false, doubleClickZoom: false,
});
L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);

// On retina screens (iPad) request one zoom level deeper so the chart is drawn
// at full device resolution instead of being stretched 2x.
const retina = (window.devicePixelRatio || 1) > 1.5;
const vfrLayer = L.tileLayer('tiles/{z}/{x}/{y}.webp', {
  minZoom: 6, maxZoom: 14, keepBuffer: 4,
  maxNativeZoom: retina ? 11 : 12, minNativeZoom: retina ? 5 : 6,
  tileSize: retina ? 128 : 256, zoomOffset: retina ? 1 : 0,
  attribution: 'Carta VFR 1:500 000 © <a href="https://aip.enaire.es/AIP/CartasInsigniaImpresas-es.html" target="_blank" rel="noopener">ENAIRE · AIP España</a>',
});
const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  subdomains: 'abc', maxZoom: 14, maxNativeZoom: 15,
  attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>, <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a>',
});
let chartMeta = null;

// The app's own chart (Rogers-style): terrain + ground tiles built in CI, aviation drawn on top.
const ownLayer = L.tileLayer('chart/{z}/{x}/{y}.webp', {
  minZoom: 6, maxZoom: 14, keepBuffer: 4,
  maxNativeZoom: retina ? 11 : 12, minNativeZoom: retina ? 5 : 6,
  tileSize: retina ? 128 : 256, zoomOffset: retina ? 1 : 0,
  attribution: 'Terrain SRTM · map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · airspace ENAIRE AIP',
});
let ownMeta = null;
let CHART_AS = [], AMA_CELLS = [], AS_LABELS = [], NAVAIDS = [], OBSTACLES = [];
// Airspaces as canvas tiles (sharp at every zoom, drawn from the AIP data)
const AviationLayer = L.GridLayer.extend({
  createTile(coords) {
    const c = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1), sz = this.getTileSize();
    c.width = sz.x * dpr; c.height = sz.y * dpr;
    const g = c.getContext('2d'); g.scale(dpr, dpr);
    const z = coords.z, ox = coords.x * sz.x, oy = coords.y * sz.y;
    const P = (la, lo) => { const [x, y] = wpx(la, lo, z); return [x - ox, y - oy]; };
    const pad = 0.15 * 2 ** (10 - z);
    const nw = map.unproject([ox, oy], z), se = map.unproject([ox + sz.x, oy + sz.y], z);
    const view = { n: nw.lat + pad, s: se.lat - pad, w: nw.lng - pad, e: se.lng + pad };
    if (z >= 7) drawAmaGrid(g, AMA_CELLS.filter((a) => !(a.e < view.w || a.w > view.e || a.n < view.s || a.s > view.n)), P);
    drawAirspaces(g, CHART_AS, P, z, 1, view);
    drawNavaids(g, NAVAIDS.filter((n) => n.lat > view.s - 0.15 && n.lat < view.n + 0.15 && n.lon > view.w - 0.2 && n.lon < view.e + 0.2), P, z, 1, (la, lo) => defaultVar(la, lo));
    drawObstacles(g, OBSTACLES, P, z, 1, view, sz.x);
    return c;
  },
});
const aviationLayer = new AviationLayer({ pane: 'labels', zIndex: 5, updateWhenZooming: false, keepBuffer: 1 });
// Safari (iPhone/iPad) has a hard limit on total canvas memory: free each tile's canvas as soon as
// it leaves the map, otherwise later canvases (the town names) silently fail to draw.
aviationLayer.on('tileunload', (e) => { if (e.tile && e.tile.width) { e.tile.width = 0; e.tile.height = 0; } });
map.createPane('aviation').style.zIndex = 405;
aviationLayer.options.pane = 'aviation';
const asLabelLayer = L.layerGroup();
// Labels with simple collision avoidance: higher-priority labels first (restricted areas, CTA
// sectors, airspace edges, navaids, grid figures); a label that would overlap one already placed,
// or an aerodrome / reporting point symbol, is left out at this zoom.
function buildAsLabels() {
  asLabelLayer.clearLayers();
  const z = map.getZoom();
  const placed = [];
  const hit = (r) => placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0);
  const rectAt = (lat, lon, w, h, ang = 0) => {
    const p = map.project([lat, lon], z), a = (ang * Math.PI) / 180;
    const W = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a)), H = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
    return { x0: p.x - W / 2, x1: p.x + W / 2, y0: p.y - H / 2, y1: p.y + H / 2 };
  };
  if (state.view.points) for (const p of POINTS) { if (p.type === 'vrp' && z < 9) continue; const q = map.project([p.lat, p.lon], z); placed.push({ x0: q.x - 9, x1: q.x + 44, y0: q.y - 9, y1: q.y + 9 }); }
  const add = (lat, lon, html, rect) => { if (hit(rect)) return false; placed.push(rect); asLabelLayer.addLayer(L.marker([lat, lon], { pane: 'aviation', interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html }) })); return true; };
  const boxes = AS_LABELS.filter((l) => l.kind === 'box').sort((a, b) => (a.color === NAVY_C) - (b.color === NAVY_C));
  for (const l of boxes) {
    if (z < (l.minZoom || 9)) continue;
    const w = Math.max(...l.lines.map((t) => t.length)) * 6.6 + 6, h = l.lines.length * 14;
    add(l.lat, l.lon, `<span class="as-box" style="color:${l.color}">${l.lines.map(esc).join('<br>')}</span>`, rectAt(l.lat, l.lon, w, h));
  }
  for (const l of AS_LABELS) {
    if (l.kind !== 'edge' || z < (l.minZoom || 8)) continue;
    const w = l.text.length * 6.3 + 6;
    if (l.edgePx10 * 2 ** (z - 10) < w + 14) continue; // edge too short at this zoom
    add(l.lat, l.lon, `<span class="as-edge" style="--a:${l.angle.toFixed(1)}deg;color:${l.color}">${esc(l.text)}</span>`, rectAt(l.lat, l.lon, w, 13, l.angle));
  }
  if (z >= 9) for (const n of NAVAIDS) {
    if (/ILS/i.test(n.type)) continue;
    const lb = navaidLabel(n), off = /VOR/i.test(n.type) ? 0.035 * 2 ** (10 - z) * 3 : 0.012 * 2 ** (10 - z) * 3;
    const lat = n.lat - off, lon = n.lon + off * 1.3;
    const w = Math.max(...lb.lines.map((t) => t.length)) * 6.4 + 12, h = 32;
    add(lat, lon, `<span class="nav-box">${lb.lines.map(esc).join('<br>')}</span>`, rectAt(lat, lon, w, h));
  }
  if (z >= 7) for (const c of AMA_CELLS) {
    const lat = c.n - (c.n - c.s) * 0.22, lon = c.w + (c.e - c.w) * 0.72;
    add(lat, lon, `<span class="ama">${Math.floor(c.v / 10)}<small>${c.v % 10}</small></span>`, rectAt(lat, lon, 40, 34));
  }
}
const NAVY_C = '#1d3f8f';
map.on('zoomend', () => { if (map.hasLayer(asLabelLayer)) buildAsLabels(); });
function setAviationData(aip) {
  CHART_AS = chartAirspaces(aip.airspaces || []);
  AMA_CELLS = aip.ama || [];
  AS_LABELS = airspaceLabels(CHART_AS, (aip.aerodromes || []).map((a) => [a.lat, a.lon]));
  NAVAIDS = aip.navaids || [];
  aviationLayer.redraw(); buildAsLabels();
}

async function initBase() {
  try {
    const r = await fetch('chart/meta.json', { cache: 'no-cache' });
    if (r.ok) {
      ownMeta = await r.json();
      if (ownMeta.bounds) ownLayer.options.bounds = L.latLngBounds(ownMeta.bounds);
      let seen = null; try { seen = localStorage.getItem('navlog.chartBuild'); } catch { /* private mode */ }
      if (seen !== ownMeta.built && 'caches' in window) {
        await caches.delete('navlog-ownchart-v1').catch(() => {});
        try { localStorage.setItem('navlog.chartBuild', ownMeta.built); } catch { /* ignore */ }
      }
    }
  } catch { ownMeta = null; }
  try {
    const r = await fetch('tiles/meta.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error();
    chartMeta = await r.json();
    // New chart build (new sheets / AIRAC edition): drop the tiles cached from the old one so the
    // sheets show as one combined chart everywhere, not old pieces where they were viewed before.
    const build = `${chartMeta.built}|${(chartMeta.charts || []).join(',')}`;
    let seen = null; try { seen = localStorage.getItem('navlog.tilesBuild'); } catch { /* private mode */ }
    if (seen !== build && 'caches' in window) {
      await caches.delete('navlog-tiles-v1').catch(() => {});
      try { localStorage.setItem('navlog.tilesBuild', build); } catch { /* ignore */ }
      vfrLayer.redraw();
    }
    if (chartMeta.bounds) vfrLayer.options.bounds = L.latLngBounds(chartMeta.bounds);
    document.getElementById('chartInfo').textContent = `AIP España · ENAIRE · ${chartMeta.charts.join(', ')}`;
  } catch {
    chartMeta = null;
    document.getElementById('chartInfo').textContent = 'VFR chart tiles are not built on this copy yet — showing terrain.';
  }
  setBase(state.view.base);
}
function setBase(b) {
  if (b === 'chart' && !ownMeta) b = chartMeta ? 'vfr' : 'topo';
  if (b === 'vfr' && !chartMeta) b = ownMeta ? 'chart' : 'topo';
  [vfrLayer, topoLayer, ownLayer, aviationLayer, asLabelLayer].forEach((l) => map.removeLayer(l));
  ({ vfr: vfrLayer, topo: topoLayer, chart: ownLayer })[b].addTo(map);
  // the ENAIRE chart already shows the airspaces; on the others they are drawn by the app
  if (b !== 'vfr') { aviationLayer.addTo(map); asLabelLayer.addTo(map); buildAsLabels(); }
  if (placesLayer) placesLayer.setStyle(b === 'vfr' ? 'light' : 'rogers');
  document.querySelector(`input[name=base][value=${b}]`).checked = true;
}

const panes = ['labels', 'points', 'routes', 'marks', 'wpts'];
panes.forEach((p, i) => { map.createPane(p).style.zIndex = 410 + i * 10; });

// Reference points (aerodromes + VRPs)
const pointsLayer = L.layerGroup();
function buildPoints() {
  pointsLayer.clearLayers();
  const z = map.getZoom();
  // A reporting point shared by two aerodromes (e.g. LESA N = LEUN N) gets one marker: the
  // school's aerodrome's one.
  const vrpAt = new Map();
  for (const p of POINTS) if (p.type === 'vrp') {
    const k = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`, cur = vrpAt.get(k);
    if (!cur || (APPROVED.includes(p.ad) && !APPROVED.includes(cur.ad))) vrpAt.set(k, p);
  }
  POINTS.forEach((p) => {
    if (p.type === 'vrp' && z < 9) return;
    if (p.type === 'vrp' && vrpAt.get(`${p.lat.toFixed(4)},${p.lon.toFixed(4)}`) !== p) return;
    const ad = adByIcao(p.ad);
    const minor = p.type === 'ad' && ad && ad.public === false;
    if (minor && z < 9) return;
    const icon = L.divIcon({
      className: '', iconSize: [14, 14], iconAnchor: [7, 7],
      html: `<div class="${p.type === 'ad' ? (minor ? 'pt-ad minor' : 'pt-ad') : 'pt-vrp'}"></div><span class="pt-label">${p.type === 'ad' ? p.label : p.label.split(' ')[0]}</span>`,
    });
    const m = L.marker([p.lat, p.lon], { icon, pane: 'points', keyboard: false });
    // SkyDemon-style: tapping a reporting point or aerodrome adds it to the route.
    m.on('click', (e) => { L.DomEvent.stopPropagation(e); addPoint(p); });
    pointsLayer.addLayer(m);
  });
}
buildPoints();
let lastZ = map.getZoom();
map.on('zoomend', () => { const z = map.getZoom(); if ((z >= 9) !== (lastZ >= 9)) buildPoints(); lastZ = z; });

// Every aerodrome, VRP and VFR route within 200 NM of LEBG / LERJ (AIP, built weekly in CI)
let AIRSPACES = [];
fetch('data/aip.json').then((r) => (r.ok ? r.json() : null)).then((aip) => {
  if (aip && aip.airspaces) { AIRSPACES = aip.airspaces; setAviationData(aip); }
  if (mergeAip(aip)) { buildPoints(); update({ rerenderPanels: true }); }
}).catch(() => {});

// ENAIRE obstacles (≥ 100 m): chart symbols, profile and minimum-altitude check
fetch('data/obstacles.json').then((r) => (r.ok ? r.json() : null)).then((d) => {
  if (!d || !d.obstacles) return;
  OBSTACLES = d.obstacles; aviationLayer.redraw(); update({ rerenderPanels: true });
}).catch(() => {});

const routeLayer = L.layerGroup().addTo(map);

// Town and village names (GeoNames)
let placesLayer = null;
let placesData = [];
fetch('data/places.json').then((r) => (r.ok ? r.json() : [])).then((places) => {
  if (!places.length) return;
  placesData = places;
  // names keep clear of the airspace, navaid and reporting-point labels (already on the map)
  placesLayer = new PlacesLayer(places, { avoid: () => {
    const o = map.getContainer().getBoundingClientRect();
    return [...map.getContainer().querySelectorAll('.as-box, .as-edge, .ama, .nav-box, .pt-label, .pt-ad')].map((el) => {
      const r = el.getBoundingClientRect(); return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
    }).filter((b) => b.w > 0);
  } });
  placesLayer.setStyle(state.view.base === 'vfr' ? 'light' : 'rogers');
  togglePlaces();
}).catch(() => {});
function togglePlaces() {
  if (!placesLayer) return;
  if (state.view.names) placesLayer.addTo(map); else map.removeLayer(placesLayer);
}
let selectedId = null;

// Snapping (Phase 2: choose large, distinctive references). Aerodromes and VRPs win over
// towns; towns only snap when their name is shown at this zoom level.
const SNAP_PX = 20;
function nearestRef(latlng) {
  const pt = map.latLngToContainerPoint(latlng);
  let best = null, bestD = SNAP_PX;
  for (const p of POINTS) {
    if (p.type === 'vrp' && map.getZoom() < 9) continue;
    const d = pt.distanceTo(map.latLngToContainerPoint([p.lat, p.lon]));
    // shared reporting points (e.g. LESA N = LEUN N): the school's aerodrome wins
    const tie = best && Math.abs(d - bestD) < 1 && APPROVED.includes(p.ad) && !APPROVED.includes(best.ad);
    if (d < bestD - (best ? 1 : 0) || tie || (!best && d < bestD)) { bestD = d; best = p; }
  }
  if (best || !state.view.names) return best;
  const z = map.getZoom(), minZ = [6, 8, 10];
  bestD = SNAP_PX;
  for (const [name, lat, lon, rank] of placesData) {
    if (z < minZ[rank]) continue;
    if (Math.abs(lat - latlng.lat) > 0.2 || Math.abs(lon - latlng.lng) > 0.3) continue;
    const d = pt.distanceTo(map.latLngToContainerPoint([lat, lon]));
    if (d < bestD) { bestD = d; best = { key: `town:${name}:${lat}`, type: 'town', label: name, sub: ['City', 'Town', 'Village'][rank], lat, lon }; }
  }
  return best;
}

// Live highlight of the feature a dragged point will snap to.
let snapHint = null;
function showSnapHint(ref) {
  if (snapHint) { routeLayer.removeLayer(snapHint); snapHint = null; }
  if (!ref) return;
  snapHint = L.marker([ref.lat, ref.lon], { pane: 'marks', interactive: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="snap-ring"></div><span class="snap-label">${ref.type === 'town' ? ref.label : refName(ref)}</span>` }) }).addTo(routeLayer);
}

function refName(p) {
  if (p.type === 'town') return p.label;
  return p.type === 'ad' ? p.label : p.label.split(' ')[0] + (p.ad === 'LEBG' ? '' : ` (${p.ad})`);
}

// Magnetic variation for a free point: from the nearest hand-checked VAC value (LEBG, LEVT, LERJ),
// otherwise the nearest aerodrome's AIP value.
function defaultVar(lat, lon) {
  const curated = AERODROMES.filter((a) => a.freq && a.vrps && ['LEBG', 'LEVT', 'LERJ', 'LEVD', 'LELN'].includes(a.icao));
  let best = null, bd = Infinity;
  for (const a of curated) { const d = distanceNm(a, { lat, lon }); if (d < bd) { bd = d; best = a; } }
  if (best && bd < 60) return best.var;
  best = AERODROMES[0]; bd = Infinity;
  for (const a of AERODROMES) { const d = distanceNm(a, { lat, lon }); if (d < bd) { bd = d; best = a; } }
  return best.var;
}

function lastCruiseAlt(wps) {
  for (let i = wps.length - 1; i > 0; i--) if (!wps[i].proc && wps[i].alt) return wps[i].alt;
  return 5500;
}

function newWaypoint(lat, lon, ref) {
  const r = route();
  const prev = r.waypoints[r.waypoints.length - 1];
  const wp = {
    id: ++uid, lat, lon,
    name: ref ? refName(ref) : `WPT ${r.waypoints.length}`,
    ref: ref && ref.type !== 'town' ? ref.key : null,
    town: ref && ref.type === 'town' ? ref.label : undefined,
    // en-route point: 5500 ft southbound, 6500 ft northbound (Spain) — lower it in the profile if terrain allows
    altAuto: !!prev, // default level — lowered/raised automatically once the terrain is known
    alt: prev ? (southbound(((Math.round(trueCourse(prev, { lat, lon }) - (prev.var || 0)) % 360) + 360) % 360) ? 5500 : 6500) : lastCruiseAlt(r.waypoints),
    wdir: prev ? prev.wdir || '' : '', wspd: prev ? prev.wspd || '' : '',
    var: ref && ref.ad ? adByIcao(ref.ad).var : defaultVar(lat, lon),
  };
  return wp;
}

const vrpRef = (adIcao, id) => POINTS.find((p) => p.key === `${adIcao}-${id}`);

function addPoint(ref) {
  const r = route();
  if (!r.waypoints.length && state.active === 'alt') seedAlternate();
  const wps = r.waypoints;
  const first = wps[0], last = wps[wps.length - 1];
  const firstAd = first && first.ref && adByIcao(first.ref);
  const isStart = wps.length === 1;

  // Leaving the departure aerodrome via one of its reporting points: follow the published route.
  if (isStart && firstAd && ref.type === 'vrp' && ref.ad === firstAd.icao) {
    let proc = procedureFor(firstAd.icao, ref.id, 'dep');
    if (proc && state.flight.lowCloud && firstAd.icao === 'LEBG') {
      // SOP2507 low-cloud special operation: leave via S, W or N only, direct to the point at 4500 ft
      if (ref.id === 'E' || ref.id === 'E-1') toast('Low-cloud procedure: E point is not used — leave via S, W or N');
      proc = { ...proc, points: [ref.id], alt: 4500, source: 'LEBG low-cloud procedure (SOP2507)' };
    }
    if (proc) {
      for (const id of proc.points) {
        const p = vrpRef(firstAd.icao, id); if (!p) continue;
        const wp = newWaypoint(p.lat, p.lon, p);
        const a = (proc.pointAlt && proc.pointAlt[id]) ?? proc.alt;
        wp.proc = 'dep'; wp.procRoute = proc.route; if (a) wp.alt = a;
        wps.push(wp);
      }
      toast(`Departure ${proc.points.join(' → ')}${proc.alt ? ` at ${proc.alt} ft` : ''} · ${proc.source}`);
      haptic(); return update({ rerenderPanels: true });
    }
  }
  // Further points of the same departure corridor, tapped one by one (e.g. LERJ → W-2 → W-1 → W):
  // still part of the published departure, so they keep the departure altitude.
  const lastDep = wps.length > 1 && wps.slice(1).every((w) => w.proc === 'dep') ? wps[wps.length - 1] : null;
  const contProc = !isStart && firstAd && ref.type === 'vrp' && ref.ad === firstAd.icao && lastDep ? procedureFor(firstAd.icao, ref.id, 'dep') : null;
  if (contProc && contProc.route && contProc.route === lastDep.procRoute && contProc.points.length > wps.length - 1) {
    const proc = contProc;
    const wp = newWaypoint(ref.lat, ref.lon, ref);
    wp.proc = 'dep'; wp.procRoute = proc.route;
    const alt = state.flight.lowCloud && firstAd.icao === 'LEBG' ? 4500 : proc && proc.alt;
    if (alt) wps.slice(1).concat(wp).forEach((w) => { w.alt = alt; });
    wps.push(wp);
    toast(`Departure continues to ${refName(ref)}${alt ? ` at ${alt} ft` : ''}`);
    haptic(); return update({ rerenderPanels: true });
  }
  if (isStart && firstAd && ref.type !== 'vrp' && state.active === 'main') {
    toast(`Tip: leave ${firstAd.icao} via one of its reporting points (VAC)`);
  }

  // Joining an aerodrome: from its reporting point, follow the published route in.
  if (ref.type === 'ad' && wps.length >= 1) {
    const ad = adByIcao(ref.ad);
    const lastRef = last && last.ref && POINTS.find((p) => p.key === last.ref);
    if (lastRef && lastRef.type === 'vrp' && lastRef.ad === ad.icao) {
      const proc = procedureFor(ad.icao, lastRef.id, 'arr');
      if (proc && state.flight.lowCloud && ad.icao === 'LEBG' && lastRef.id === 'E') toast('Low-cloud procedure: E point is not used — enter via N, W or S–E-1 at 4000 ft');
      if (proc) {
        // Corridor points tapped one by one before the aerodrome (e.g. W → W-1 → W-2 → LERJ):
        // the first of them is the entry point, the rest are part of the arrival.
        // only points on the same published corridor (e.g. LERJ W, W-1, W-2), never other VRPs flown en route
        const ofAd = (w) => { const p = w && w.ref && POINTS.find((x) => x.key === w.ref); const routes = PROCEDURES[ad.icao] ? Object.values(PROCEDURES[ad.icao].routes) : [];
          return p && p.type === 'vrp' && p.ad === ad.icao && routes.some((r) => r.includes(p.id) && r.includes(lastRef.id)); };
        let k = wps.length - 1;
        while (k - 1 >= 1 && ofAd(wps[k - 1]) && wps[k - 1].proc !== 'dep') k--;
        // altitude over each point: per-point SOP value (LEBG) or the corridor altitude; low-cloud 4000 ft
        const lowCloud = state.flight.lowCloud && ad.icao === 'LEBG';
        const pa = (id) => (lowCloud ? 4000 : (proc.pointAlt && proc.pointAlt[id]) ?? proc.alt);
        const idOf = (w) => (POINTS.find((x) => x.key === w.ref) || {}).id;
        for (let j = k; j < wps.length; j++) { const a = pa(idOf(wps[j])); if (a) wps[j].alt = a; if (j > k) wps[j].proc = 'arr'; }
        let lastAlt = pa(lastRef.id);
        if (lastAlt) { last.alt = lastAlt; last.altAuto = false; } // established at the procedure altitude over the entry point
        last.entry = true; // its level comes from the procedure, not the cruising-level rule
        for (const id of proc.points.slice(1)) {
          const p = vrpRef(ad.icao, id); if (!p) continue;
          const wp = newWaypoint(p.lat, p.lon, p);
          lastAlt = pa(id) || lastAlt;
          wp.proc = 'arr'; if (lastAlt) wp.alt = lastAlt;
          wps.push(wp);
        }
        const wp = newWaypoint(ref.lat, ref.lon, ref);
        wp.proc = 'arr'; if (lastAlt) wp.alt = lastAlt;
        wps.push(wp);
        const entryId = (POINTS.find((x) => x.key === wps[k].ref) || lastRef).id;
        const solo = state.flight.solo && proc.solo && !proc.solo.includes(entryId);
        toast(solo ? `Solo flights may only enter via ${proc.solo.join(' or ')} (SOP)` : `Arrival ${proc.points.map((id) => `${id}${pa(id) ? ' ' + pa(id) : ''}`).join(' → ')} → ${ad.icao} · ${proc.source}`);
        haptic(); return update({ rerenderPanels: true });
      }
    } else if (wps.length > 1 && ad.vrps.length) {
      toast(`Tip: join ${ad.icao} via a reporting point (${ad.vrps.slice(0, 5).map((v) => v.id).join(', ')})`);
    }
  }

  const wp = newWaypoint(ref.lat, ref.lon, ref);
  wps.push(wp);
  if (ref.type !== 'ad') toast(`Added ${refName(ref)} · ${ref.sub}`);
  if (ref.type === 'ad' && ref.ad !== firstAd?.icao) checkApproved(ref.ad);
  haptic();
  update({ rerenderPanels: true });
}

/* ---------------- Route library: ready-made routes between the school's aerodromes ----------------
 * Built on the spot from the published procedures, the towns on the chart, ENAIRE's airspaces and
 * grid altitudes: out by a reporting point, town to town (every leg ≤ 20 NM), in by a reporting point.
 * It goes through addPoint, so departure / arrival procedures and their altitudes apply as when tapped. */
var libQuiet = false;
const adPoint = (icao) => POINTS.find((p) => p.type === 'ad' && p.ad === icao);
function libEnds(icao, kind) {
  const a = adPoint(icao); if (!a) return [];
  const pr = PROCEDURES[icao], out = [];
  if (pr) {
    const routes = kind === 'dep' && pr.depRoutes ? pr.depRoutes : pr.routes;
    let ids = Object.values(routes).map((pts) => pts);
    if (kind === 'arr' && icao === 'LEBG' && state.flight.solo && pr.soloEntry) ids = ids.filter((pts) => pr.soloEntry.includes(pts[pts.length - 1]));
    for (const pts of ids) {
      const id = pts[pts.length - 1];
      if ((pr.avoid || []).includes(id)) continue;
      const v = vrpRef(icao, id); if (!v) continue;
      let c = 0, longest = 0, prev = a; for (const pid of pts) { const q = vrpRef(icao, pid); if (q) { const d = nmDist(prev, q); c += d; longest = Math.max(longest, d); prev = q; } }
      out.push({ id, lat: v.lat, lon: v.lon, cost: c + (longest > MAX_LEG_NM ? 120 : 0) }); // avoid published corridors with legs over the limit when there is another way
    }
  } else {
    for (const v of POINTS.filter((p) => p.type === 'vrp' && p.ad === icao)) out.push({ id: v.id, lat: v.lat, lon: v.lon, cost: nmDist(a, v) });
  }
  return out;
}
function libAlternateFor(icao, avoid) {
  const d = adPoint(icao);
  return APPROVED.filter((x) => x !== icao && x !== avoid && adPoint(x) && !IFR_ONLY.includes(x))
    .map((x) => ({ x, d: nmDist(d, adPoint(x)) })).sort((a, b) => a.d - b.d)[0]?.x;
}
function libLeg(from, to) {
  const r = bestRoute(libEnds(from, 'dep'), libEnds(to, 'arr'), placesData, avoidAreas(AIRSPACES, [adPoint(from), adPoint(to)]), AMA_CELLS);
  if (!r) return null;
  const pts = [adPoint(from), vrpRef(from, r.exit),
    ...r.points.map((t) => ({ key: `town:${t.name}:${t.lat}`, type: 'town', label: t.name, sub: 'Town', lat: t.lat, lon: t.lon })),
    vrpRef(to, r.entry), adPoint(to)];
  return pts.every(Boolean) ? pts : null;
}
function buildLibraryRoute(from, to, withAlt = true) {
  if (!placesData.length || !AIRSPACES.length) return toast('Still loading the chart data — try again in a moment');
  if (from === to) return toast('Pick two different aerodromes');
  const main = libLeg(from, to);
  if (!main) return toast(`No route found from ${from} to ${to} with legs of ${MAX_LEG_NM} NM or less`);
  const altIcao = withAlt ? libAlternateFor(to) : null;
  const alt = altIcao ? libLeg(to, altIcao) : null;
  if ((state.main.waypoints.length > 1 || state.alt.waypoints.length > 1) && !confirm(`Replace the current route with ${from} → ${to}?`)) return;
  const keepActive = state.active;
  libQuiet = true;
  try {
    state.main = { ...state.main, waypoints: [] };
    state.alt = { ...state.alt, waypoints: [] };
    state.active = 'main';
    for (const p of main) addPoint(p);
    if (alt) { state.active = 'alt'; for (const p of alt.slice(1)) addPoint(p); }
  } finally { libQuiet = false; state.active = keepActive === 'alt' && alt ? 'alt' : 'main'; }
  update({ rerenderPanels: true });
  setTimeout(fitRoute, 50);
  const towns = main.filter((p) => p.type === 'town').map((p) => p.label);
  toast(`${from} → ${towns.join(' → ') || 'direct'} → ${to}${alt ? ` · alternate ${altIcao}` : ''} — check it before you fly it`);
}

function seedAlternate() {
  const dest = state.main.waypoints[state.main.waypoints.length - 1];
  if (dest) state.alt.waypoints = [{ ...dest, id: ++uid, wdir: '', wspd: '', tas: '' }];
}

map.on('click', (e) => {
  const ref = nearestRef(e.latlng);
  if (ref) return addPoint(ref);
  if (!layersPop.hidden || !plansPop.hidden) return; // tap outside a menu just closes it
  const r = route();
  if (!r.waypoints.length && state.active === 'alt') seedAlternate();
  const wp = newWaypoint(e.latlng.lat, e.latlng.lng, null);
  r.waypoints.push(wp);
  haptic();
  update({ rerenderPanels: true });
  nameFromMap(wp);
});

// Reverse-geocode a friendly name for a tapped point (village/town), like SkyDemon does.
const geoCache = new Map();
async function nameFromMap(wp) {
  if (!navigator.onLine) return;
  const key = `${wp.lat.toFixed(3)},${wp.lon.toFixed(3)}`;
  try {
    let name = geoCache.get(key);
    if (!name) {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${wp.lat}&lon=${wp.lon}&accept-language=es`);
      const j = await r.json();
      const a = j.address || {};
      name = a.village || a.town || a.hamlet || a.city || a.municipality || null;
      if (name) geoCache.set(key, name);
    }
    if (name && /^WPT \d+$/.test(wp.name)) { wp.name = name; update({ rerenderPanels: true }); }
  } catch { /* offline: keep WPT n */ }
}

function wpIcon(n, alt, sel) {
  return L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11], html: `<div class="wpt-marker ${alt ? 'alt' : ''} ${sel ? 'sel' : ''}">${n}</div>` });
}

// Mission leg not planned yet: thin dotted guide from the last point to the target aerodrome.
// Display only — never part of the route, the navlog or any PDF.
function drawMissionGuide() {
  const m = state.mission, leg = m && m.legs.find((l) => l.id === m.active);
  if (!leg) return;
  const guide = (from, icao, color) => {
    const ad = icao && adByIcao(icao);
    if (!from || !ad || from.ref === icao) return;
    L.polyline([[from.lat, from.lon], [ad.lat, ad.lon]], { pane: 'routes', color, weight: 2, opacity: 0.75, dashArray: '2 7', lineCap: 'round', interactive: false }).addTo(routeLayer);
    L.circleMarker([ad.lat, ad.lon], { pane: 'routes', radius: 13, color, weight: 2, dashArray: '3 4', fill: false, interactive: false }).addTo(routeLayer);
  };
  if (state.active === 'main') return guide(state.main.waypoints.at(-1), leg.target, '#d1009a');
  const altFrom = state.alt.waypoints.at(-1) || adByIcao(leg.target);
  if (leg.altTarget && state.alt.waypoints.length < 2) guide(altFrom && { lat: altFrom.lat, lon: altFrom.lon, ref: altFrom.icao || altFrom.ref }, leg.altTarget, '#0a84ff');
}

function drawRoutes() {
  // a leg card whose leg no longer exists (route reset, point deleted, undo, another mission leg) closes
  if (legCardOf) { const w = state[legCardOf.key].waypoints; const i = w.findIndex((x) => x.id === legCardOf.wid); if (i < 1 || w[i - 1].id !== legCardOf.from) map.closePopup(); }
  routeLayer.clearLayers();
  hatJobs = [];
  drawMissionGuide();
  for (const key of ['alt', 'main']) {
    const r = state[key];
    const isAlt = key === 'alt';
    const color = isAlt ? '#0a84ff' : '#d1009a';
    const wps = r.waypoints;
    const active = state.active === key;
    if (wps.length > 1) {
      const latlngs = wps.map((w) => [w.lat, w.lon]);
      L.polyline(latlngs, { pane: 'routes', color: '#fff', weight: active ? 8 : 6, opacity: 0.8, interactive: false }).addTo(routeLayer);
      L.polyline(latlngs, { pane: 'routes', color, weight: active ? 4.5 : 3, opacity: active ? 1 : 0.7, dashArray: isAlt ? '10 7' : null, interactive: false }).addTo(routeLayer);
    }
    // HATs + 2-minute marks from the computed navlog rows
    const nl = result && result[key];
    if (nl && nl.rows.length && state.view.marks) drawLegAnnotations(key, nl.rows, wps, isAlt);

    if (!active) continue;
    // Midpoint handles: drag to insert a waypoint (rubber-banding)
    for (let i = 1; i < wps.length; i++) {
      const m = midpoint(wps[i - 1], wps[i]);
      const h = L.marker([m.lat, m.lon], {
        pane: 'wpts', draggable: true, keyboard: false,
        icon: L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7], html: `<div class="mid-handle ${isAlt ? 'alt' : ''}"></div>` }),
      }).addTo(routeLayer);
      let ghost = null;
      h.on('dragstart', () => { ghost = L.polyline([], { pane: 'routes', color, weight: 3, dashArray: '4 6' }).addTo(routeLayer); });
      h.on('drag', (e) => { ghost.setLatLngs([[wps[i - 1].lat, wps[i - 1].lon], e.target.getLatLng(), [wps[i].lat, wps[i].lon]]); showSnapHint(nearestRef(e.target.getLatLng())); });
      h.on('dragend', (e) => {
        const ll = e.target.getLatLng();
        const ref = nearestRef(ll);
        showSnapHint(null);
        const wp = newWaypoint(ref ? ref.lat : ll.lat, ref ? ref.lon : ll.lng, ref);
        wp.alt = wps[i].alt; wp.wdir = wps[i].wdir; wp.wspd = wps[i].wspd;
        wps.splice(i, 0, wp);
        haptic();
        update({ rerenderPanels: true });
        if (!ref) nameFromMap(wp);
      });
      h.on('click', (e) => L.DomEvent.stopPropagation(e));
    }
    wps.forEach((w, i) => {
      const mk = L.marker([w.lat, w.lon], { pane: 'wpts', draggable: true, icon: wpIcon(i + 1, isAlt, w.id === selectedId), keyboard: false, zIndexOffset: w.id === selectedId ? 1000 : 0 }).addTo(routeLayer);
      mk.bindTooltip(w.name, { permanent: true, direction: 'right', className: 'wpt-tip', offset: [10, 0] });
      mk.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        // Tapping the departure aerodrome again closes the route (return to base).
        if (i === 0 && wps.length > 1 && w.ref && adByIcao(w.ref) && wps[wps.length - 1].ref !== w.ref) {
          const ref = POINTS.find((p) => p.key === w.ref);
          addPoint(ref);
          return;
        }
        // Points on top of each other (e.g. leaving and returning via the same reporting point):
        // each tap selects the next one, which then comes to the top so it can be dragged.
        const here = map.latLngToContainerPoint([w.lat, w.lon]);
        const stack = wps.filter((x) => map.latLngToContainerPoint([x.lat, x.lon]).distanceTo(here) < 14);
        const cur = stack.findIndex((x) => x.id === selectedId);
        const next = stack.length > 1 ? stack[(cur + 1) % stack.length] : w;
        // A reporting point or aerodrome already in the route, tapped while the route is still open:
        // the student may want to fly through it again (out and back via E) — ask.
        const ref = w.ref && POINTS.find((p) => p.key === w.ref);
        const lastW = wps[wps.length - 1];
        const closed = wps.length > 1 && lastW.ref && (POINTS.find((p) => p.key === lastW.ref) || {}).type === 'ad';
        if (ref && key === state.active && !closed && lastW.id !== w.id && !(lastW.ref && lastW.ref === w.ref)) {
          selectWaypoint(next.id, false);
          choice(`${ref.type === 'ad' ? ref.ad : refName(ref)} is already point ${wps.indexOf(w) + 1}.`, [
            { label: `Add ${ref.type === 'ad' ? ref.ad : ref.id || refName(ref)} again`, run: () => addPoint(ref) },
            { label: `Select point ${wps.indexOf(next) + 1}`, run: () => selectWaypoint(next.id, true) },
          ]);
          return;
        }
        if (stack.length === 1 && w.id === selectedId && state.view.compact !== false) { selectedId = null; drawRoutes(); renderRoute(); return; }
        selectWaypoint(next.id, true);
        if (stack.length > 1) toast(`Point ${wps.indexOf(next) + 1} · ${next.name} — ${stack.length} points here, tap again for the next`);
      });
      mk.on('drag', (e) => showSnapHint(nearestRef(e.target.getLatLng())));
      mk.on('dragend', (e) => {
        const ll = e.target.getLatLng();
        const clearGeo = (x) => { if (x && x.ov) for (const k of Object.keys(x.ov)) { delete x.ov[k].tc; delete x.ov[k].dist; delete x.ov[k].mc; delete x.ov[k].mh; delete x.ov[k].wca; if (!Object.keys(x.ov[k]).length) delete x.ov[k]; } };
        clearGeo(w); clearGeo(wps[i + 1]);
        const ref = nearestRef(ll);
        showSnapHint(null);
        if (ref && ref.type === 'town') { w.lat = ref.lat; w.lon = ref.lon; w.ref = null; w.town = ref.label; w.name = ref.label; }
        else if (ref) { w.lat = ref.lat; w.lon = ref.lon; w.ref = ref.key; w.town = undefined; w.name = refName(ref); w.var = adByIcao(ref.ad).var; }
        else { w.lat = ll.lat; w.lon = ll.lng; if (w.ref || w.town) { w.ref = null; w.town = undefined; w.name = `WPT ${i}`; nameFromMap(w); } }
        update({ rerenderPanels: true });
      });
    });
  }
  placeHats();
}

/* Leg card: tap a HAT box on the map for that leg's numbers */
var legCardOf = null;
map.on('popupclose', () => { legCardOf = null; });
function openLegCard(key, i, latlng) {
  const wps = state[key].waypoints, w = wps[i], a = wps[i - 1];
  const rows = result[key].rows.filter((x) => x.legIndex === i);
  if (!w || !a || !rows.length) return;
  const last = rows[rows.length - 1];
  const ete = rows.reduce((t, x) => t + x.eteSec, 0), fuel = Math.round(rows.reduce((t, x) => t + x.fuel, 0) * 10) / 10, dist = rows.reduce((t, x) => t + x.dist, 0);
  const lm = legMinimum(key, i);
  const low = lm && !isProcPoint(wps, i) && parseAlt(w.alt) != null && parseAlt(w.alt) < lm.need;
  const cell = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
  const html = `<div class="leg-card-pop ${key === 'alt' ? 'alt' : ''}">
    <div class="lc-title"><span class="lc-n">${key === 'alt' ? 'A' : ''}${i}</span>${esc(a.name)} → ${esc(w.name)}</div>
    <div class="lc-grid">${cell('MH', `${String(last.mh).padStart(3, '0')}°`)}${cell('Alt', esc(last.altDisp || w.alt || ''))}${cell('ETE', fmtMMSS(ete))}
      ${cell('TC', `${last.tc}°`)}${cell('Dist', `${dist} NM`)}${cell('GS', `${last.gs} kt`)}
      ${cell('Wind', +w.wspd ? `${String(w.wdir).padStart(3, '0')}/${w.wspd}` : '—')}${cell('Fuel', `${fuel} L`)}${cell('Min', lm ? `<span class="${low ? 'bad-t' : ''}">${lm.need} ft</span>` : '—')}</div>
    ${rows.length > 1 ? `<div class="lc-note">includes ${esc(rows.find((x) => x.auto)?.to || '')}</div>` : ''}
    ${low ? `<div class="lc-note bad-t">Below the minimum: ${esc(lm.why)}</div>` : ''}
    <button class="btn small primary" data-legedit="${key}:${w.id}">Edit this leg</button></div>`;
  legCardOf = { key, wid: w.id, from: a.id };
  L.popup({ closeButton: true, autoPan: true, className: 'leg-popup', maxWidth: 300 }).setLatLng(latlng).setContent(html).openOn(map);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-legedit]'); if (!b) return;
  const [key, id] = b.dataset.legedit.split(':');
  map.closePopup();
  goIssue({ route: key, wid: +id });
});

function lerp(a, b, f) { return [a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f]; }

// A short line across the route at position pos (pixels each side), as drawn on a paper chart.
const TICK = '#ffb000'; // 2-minute marks (map and printed chart)
function crossTick(a, b, pos, half, style) {
  const p = map.latLngToLayerPoint(pos);
  const pa = map.latLngToLayerPoint([a.lat, a.lon]), pb = map.latLngToLayerPoint([b.lat, b.lon]);
  const dx = pb.x - pa.x, dy = pb.y - pa.y, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * half, ny = dx / len * half;
  const p1 = map.layerPointToLatLng([p.x + nx, p.y + ny]), p2 = map.layerPointToLatLng([p.x - nx, p.y - ny]);
  return L.polyline([p1, p2], { pane: 'marks', interactive: false, lineCap: 'butt', ...style });
}

function drawLegAnnotations(key, rows, wps, isAlt) {
  const color = isAlt ? '#0a84ff' : '#d1009a';
  const z = map.getZoom();
  // Re-walk legs: each original leg may contain TOC/TOD sub-rows.
  for (let i = 1; i < wps.length; i++) {
    const a = wps[i - 1], b = wps[i];
    const legRows = rows.filter((r) => r.legIndex === i);
    const legDist = legRows.reduce((t, r) => t + r.dist, 0) || 1;
    let done = 0;
    legRows.forEach((r) => {
      const f0 = done / legDist, f1 = (done + r.dist) / legDist;
      // 2-minute marks: every 2 min of flight at this row's ground speed (wind included)
      if (z >= 8 && r.gs > 0 && !r.fixedMin) {
        const step = (r.gs / 60) * 2;
        for (let d = step; d < r.dist - 0.2; d += step) {
          const f = f0 + (d / r.dist) * (f1 - f0);
          // amber with a dark edge so the marks stand out from the pink/blue track
          crossTick(a, b, lerp(a, b, f), 7, { color: '#1a1a1a', weight: 6, opacity: 0.9 }).addTo(routeLayer);
          crossTick(a, b, lerp(a, b, f), 7, { color: TICK, weight: 3 }).addTo(routeLayer);
        }
      }
      if (r.auto && (r.to === 'TOC' || r.to === 'TOD')) {
        const pos = lerp(a, b, f1);
        crossTick(a, b, pos, 11, { color: '#fff', weight: 7, opacity: 0.95 }).addTo(routeLayer);
        crossTick(a, b, pos, 11, { color: '#111', weight: 3.5 }).addTo(routeLayer);
        const up = r.to === 'TOC';
        L.marker(pos, { pane: 'marks', interactive: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="cd-label ${up ? 'up' : 'down'}">${r.to} ${up ? '↑' : '↓'}</span>` }) }).addTo(routeLayer);
      }
      done += r.dist;
    });
    const last = legRows[legRows.length - 1];
    if (!last) continue;
    // Wind arrow (drawn downwind) with speed, at the middle of the leg
    if (state.view.winds && +b.wspd > 0 && z >= 8) {
      const pos = lerp(a, b, 0.5);
      const to = (+b.wdir + 180) % 360;
      L.marker(pos, { pane: 'marks', interactive: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="wind-arrow" style="--r:${to}deg"><svg viewBox="0 0 24 24"><path d="M12 3v18M6 15l6 6 6-6"/></svg><span>${String(b.wdir).padStart(3, '0')}/${b.wspd}</span></div>` }) }).addTo(routeLayer);
    }
    // HAT on the leg, numbered: Heading · Altitude · Time (alternate legs A1, A2…)
    if (z < 9) continue;
    const pxLen = map.latLngToLayerPoint([a.lat, a.lon]).distanceTo(map.latLngToLayerPoint([b.lat, b.lon]));
    if (pxLen < 70) continue; // too short at this zoom: zoom in to see its HAT
    const ete = legRows.reduce((t, r) => t + r.eteSec, 0);
    const hatMk = L.marker(lerp(a, b, 0.5), {
      pane: 'marks', interactive: true, keyboard: false,
      icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="hat ${isAlt ? 'alt' : ''}"><b class="hn">${isAlt ? 'A' : ''}${i}</b><span class="hv">${String(last.mh).padStart(3, '0')}°</span><span class="hv">${last.altDisp || fmtAlt(last.alt, last.altLabel)}</span><span class="hv">${fmtMMSS(ete)}</span></span>` }),
    }).addTo(routeLayer);
    hatMk.on('click', (e) => { L.DomEvent.stopPropagation(e); openLegCard(key, i, e.latlng); });
    hatJobs.push({ a, b, marker: hatMk });
  }
}

// HAT boxes on the map: each tries spots along its leg, either side, and takes the one that covers
// no waypoint, name, TOC/TOD label or other HAT (or the least crowded).
var hatJobs = []; // var: drawRoutes may run before this line during start-up
function placeHats() {
  const jobs = hatJobs; hatJobs = [];
  if (!jobs.length) return;
  const cRect = map.getContainer().getBoundingClientRect();
  const rel = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - cRect.left, y: r.top - cRect.top, w: r.width, h: r.height }; };
  const placed = [...map.getContainer().querySelectorAll('.wpt-label, .cd-label')].map(rel).filter((b) => b.w > 0);
  const cp = (ll) => map.latLngToContainerPoint(Array.isArray(ll) ? ll : [ll.lat, ll.lon]);
  const rings = [], segs = [];
  for (const key of ['main', 'alt']) {
    const w = state[key].waypoints.map(cp);
    w.forEach((p, i) => { rings.push(p); if (i) segs.push([w[i - 1], p]); });
  }
  const ov = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const crosses = (bx, A, B) => { for (let t = 0; t <= 1; t += 0.05) { const x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t; if (x > bx.x && x < bx.x + bx.w && y > bx.y && y < bx.y + bx.h) return true; } return false; };
  for (const j of jobs) {
    const el = j.marker.getElement()?.querySelector('.hat'); if (!el) continue;
    const W = el.offsetWidth, H = el.offsetHeight;
    const A = cp(j.a), B = cp(j.b);
    const dx = B.x - A.x, dy = B.y - A.y, L0 = Math.hypot(dx, dy) || 1, nx = -dy / L0, ny = dx / L0;
    let pick = null;
    for (const f of [0.5, 0.38, 0.62, 0.28, 0.72]) for (const side of [-1, 1]) for (const off of [26, 48, 74]) {
      const cx = A.x + dx * f + side * nx * off, cy = A.y + dy * f + side * ny * off;
      const bx = { x: cx - W / 2, y: cy - H / 2, w: W, h: H };
      let c = Math.abs(f - 0.5) * 400 + (off - 26) * 6 + (side === 1 ? 10 : 0);
      for (const o of placed) c += ov(bx, o) * 30;
      for (const r of rings) c += ov(bx, { x: r.x - 12, y: r.y - 12, w: 24, h: 24 }) * 30;
      for (const sg of segs) if (crosses(bx, sg[0], sg[1])) c += 900;
      if (!pick || c < pick.c) pick = { c, cx, cy, bx };
    }
    placed.push(pick.bx);
    j.marker.setLatLng(map.containerPointToLatLng([pick.cx, pick.cy]));
    el.style.setProperty('transform', 'translate(-50%, -50%)', 'important');
  }
}

function fitRoute() {
  const all = [...state.main.waypoints, ...state.alt.waypoints];
  const ml = state.mission && state.mission.legs.find((l) => l.id === state.mission.active);
  const tgt = ml && ml.target && adByIcao(ml.target);
  if (tgt) all.push({ lat: tgt.lat, lon: tgt.lon });
  if (all.length > 1) map.fitBounds(L.latLngBounds(all.map((w) => [w.lat, w.lon])), { paddingBottomRight: [40, isWide() ? 240 : sheetH() + 40], paddingTopLeft: [isWide() ? document.getElementById('sheet').getBoundingClientRect().right + 30 : 40, 120], maxZoom: 11 });
}

map.on('zoomend', () => drawRoutes());

/* ---------------- Compute ---------------- */

// Planning numbers for the selected aircraft type (SOP cruise speed + fuel flows), with any
// values the student has edited in the Fuel tab.
function planSop() {
  const ft = fleetType(state.flight.type);
  const own = (state.perf && state.perf[ft.id]) || {};
  const pick = (k) => (Number.isFinite(+own[k]) && own[k] !== '' ? +own[k] : ft.perf[k]);
  return { ...SOP, tasBase: pick('tasBase'), ffCruise: pick('ffCruise'), ffClimb: pick('ffClimb'), ffDescent: pick('ffDescent') };
}

// School rule: tanks are always full when departing from the base (LEBG / LERJ) unless stated
// otherwise — FOB follows the type's full tanks until the student types another value.
const BASES = ['LEBG', 'LERJ'];
function compute() {
  const f = state.flight;
  const dep0 = endpoint('main', 0);
  if (!f.fobSet && !(state.mission && f.carried) && (!dep0 || BASES.includes(dep0.icao))) f.fob = acOf(f.type).fuelMaxL;
  const ta = endpoint('main', 0)?.ta || 6000;
  const sop = planSop();
  const altOnly = f.levelMode === 'alt';
  const main = computeNavlog({ ...state.main, fob: +f.fob || 0, ta, altOnly }, sop);
  const lastRem = main.rows.length ? main.rows[main.rows.length - 1].fuelRem : +f.fob || 0;
  const alt = computeNavlog({ ...state.alt, fob: lastRem, ta, altOnly }, sop);
  const dep = endpoint('main', 0), dest = endpoint('main', -1);
  const local = !!dep && !!dest && dep.icao === dest.icao;
  const fuel = fuelPolicy({
    taxi: +f.taxi || 0, trip: main.totals.trip, alternate: alt.totals.trip, extra: +f.extra || 0,
    fob: +f.fob || 0, localFlight: local, flightMin: main.totals.timeSec / 60,
  }, sop);
  const useRoute = state.mb.tripSource === 'route' && main.rows.length > 0;
  const tripL = useRoute ? main.totals.trip : (+state.mb.tripManual || 0);
  const altL = useRoute ? alt.totals.trip : (+state.mb.altManual || 0);
  const ac = acOf(f.type);
  const loads = Object.fromEntries(ac.stations.map((st) => [st.id, +stationMass(f, st.id) || 0]));
  const empty = ac.regs[f.reg] ? null : [+f.emptyMass || 0, +f.emptyMoment || 0];
  const mb = computeMb(f.type, { reg: f.reg, empty, loads, fobL: +f.fob || 0, tripL, altL });
  return { main, alt, fuel, mb };
}

function endpoint(key, idx) {
  const w = state[key].waypoints.at(idx);
  if (!w || !w.ref) return null;
  return adByIcao(w.ref) || null;
}

/* ---------------- Panels ---------------- */

const panels = Object.fromEntries([...document.querySelectorAll('[data-panel]')].map((p) => [p.dataset.panel, p]));
let tab = 'route';
const wideMQ = matchMedia('(min-width: 900px)');
const isWide = () => wideMQ.matches;

const MODES = ['mission', 'plan', 'mb', 'brief', 'settings'];
function showPanels() {
  if (!MODES.includes(state.mode)) state.mode = 'plan';
  if (tab === 'brief') tab = 'route';
  const key = state.mode === 'plan' ? tab : state.mode;
  Object.entries(panels).forEach(([k, p]) => { p.hidden = k !== key; });
  document.getElementById('summary').hidden = state.mode !== 'plan';
  document.getElementById('mbSummary').hidden = state.mode !== 'mb';
  document.getElementById('planTabs').hidden = state.mode !== 'plan';
  document.getElementById('planBar').hidden = state.mode !== 'plan';
  document.getElementById('sheet').dataset.mode = state.mode;
  document.querySelectorAll('.modebar [data-mode]').forEach((x) => x.classList.toggle('on', x.dataset.mode === state.mode));
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
  stepStatus();
}
// Step bar: a tick on the steps that are done (mission chosen, route planned, M&B in limits).
function stepStatus() {
  if (!result) return;
  const done = {
    mission: !!state.mission || state.missionSkipped,
    plan: result.main.rows.length > 0 && (state.alt.waypoints.length > 1 || !!state.mission),
    mb: !!(result.mb && result.mb.ok && +stationMass(state.flight, 'pilot') > 0),
    brief: !!state.briefDone,
  };
  document.querySelectorAll('#modes [data-mode]').forEach((x) => x.classList.toggle('done', !!done[x.dataset.mode]));
}
function goStep(mode) {
  state.mode = mode;
  showPanels();
  if (!isWide() && sheetDetent === 0) setDetent(1);
  renderPanels(); scheduleSave();
  document.getElementById('sheetBody').scrollTop = 0;
}

document.getElementById('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  tab = b.dataset.tab;
  showPanels();
  if (!isWide() && sheetDetent === 0) setDetent(1);
  renderPanels();
});
document.querySelector('.modebar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]'); if (!b) return;
  goStep(b.dataset.mode);
});
// "Next step" buttons at the end of each step
document.getElementById('sheetBody').addEventListener('click', (e) => {
  const ra = e.target.closest('[data-route-go]');
  if (ra) { state.active = ra.dataset.routeGo; if (state.active === 'alt' && !state.alt.waypoints.length) seedAlternate(); update({ rerenderPanels: true }); document.getElementById('sheetBody').scrollTop = 0; return toast('Alternate: tap the chart from your destination to the alternate'); }
  const b = e.target.closest('[data-goto]'); if (!b) return;
  if (b.dataset.goto === 'plan' && !state.mission) state.missionSkipped = true;
  goStep(b.dataset.goto);
});
wideMQ.addEventListener('change', () => {
  if (isWide() && tab === 'profile') tab = 'route';
  showPanels(); setDetent(sheetDetent, false); renderPanels(); renderProfile();
});
document.getElementById('routeSel').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.active = b.dataset.route;
  if (state.active === 'alt' && !state.alt.waypoints.length) seedAlternate();
  update({ rerenderPanels: true });
});

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ICON = {
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
};

function windyLevel(ft) {
  const levels = [[950, 1600], [925, 2500], [900, 3300], [850, 4800], [800, 6400], [750, 8100], [700, 9900]];
  let best = levels[0];
  for (const l of levels) if (Math.abs(l[1] - ft) < Math.abs(best[1] - ft)) best = l;
  return `${best[0]}h`;
}

function soloEntryIssue() {
  if (!state.flight.solo) return null;
  const wps = state.main.waypoints;
  for (let i = 1; i < wps.length; i++) {
    const p = wps[i].ref && POINTS.find((x) => x.key === wps[i].ref);
    const next = wps[i + 1];
    if (!p || p.type !== 'vrp' || !next || next.proc !== 'arr' && !(next.ref === p.ad)) continue;
    const proc = PROCEDURES[p.ad];
    if (proc && proc.soloEntry && !proc.soloEntry.includes(p.id)) return `Solo flights must enter the ${p.ad} FIZ via ${proc.soloEntry.join(' or ')} only (SOP 2513) — you are joining via ${p.id}.`;
  }
  return null;
}

// Cruising levels, Spain (SERA Appendix 3 as applied in Spain, Italy and Portugal): magnetic track
// 090–269° (southbound) → odd thousands + 500 ft; 270–089° (northbound) → even thousands + 500 ft.
// Applies above 3000 ft AGL.
const southbound = (mc) => mc >= 90 && mc < 270;
function semicircularHint(mc, alt) {
  if (alt == null || alt < 3000) return null;
  const odd = southbound(mc);
  const ok = alt % 1000 === 500 && (Math.floor(alt / 1000) % 2 === 1) === odd;
  if (ok) return null;
  const base = Math.floor(alt / 1000);
  const cands = [base - 1, base, base + 1].filter((t) => (t % 2 === 1) === odd && t >= 2).map((t) => t * 1000 + 500);
  return `Cruising level for MC ${String(mc).padStart(3, '0')}°: ${cands.slice(0, 2).join(' / ')} ft (Spain: southbound odd, northbound even, above 3000 ft AGL)`;
}

// Phase 2 manual, company alternate policy: LEBG ↔ LERJ.
function companyAlternate() {
  const d = endpoint('main', -1)?.icao;
  return d === 'LEBG' ? 'LERJ' : d === 'LERJ' ? 'LEBG' : null;
}

// A point flown at its published (VAC / SOP) altitude: part of a departure or arrival, or any reporting
// point of the aerodrome the route starts or ends at — however it was added (tapped, dragged, from a plan).
function isProcPoint(wps, i) {
  const w = wps[i]; if (!w) return false;
  if (w.proc || w.entry) return true;
  const p = w.ref && POINTS.find((q) => q.key === w.ref);
  if (!p || p.type !== 'vrp') return false;
  const adOf = (x) => { const q = x && x.ref && POINTS.find((r) => r.key === x.ref); return q ? q.ad : null; };
  return p.ad === adOf(wps[0]) || p.ad === adOf(wps[wps.length - 1]);
}

function seraIssues(key) {
  const out = [];
  const r = state[key], nl = result[key];
  nl.rows.forEach((row) => {
    if (row.phase !== 'cruise' || row.auto) return;
    const to = r.waypoints[row.legIndex];
    if (to && isProcPoint(r.waypoints, row.legIndex)) return; // procedure altitude (VAC / SOP)
    const h = semicircularHint(row.mc, row.alt);
    if (h) out.push({ level: 'warn', text: `${row.from} → ${row.to}: ${h}`, go: { route: key, wid: to && to.id } });
  });
  return out;
}

function checkApproved(icao) {
  if (IFR_ONLY.includes(icao)) toast(`${icao} is IFR only for school flights`);
  else if (!APPROVED.includes(icao)) toast(`${icao} is not on the school's VFR aerodrome list — check with your instructor`);
  else if (state.flight.solo && !state.unlocked.includes(icao)) toast(`Solo: ${icao} is not in your unlocked aerodromes`);
}

function renderRoute() {
  const key = state.active;
  const r = route();
  const isAlt = key === 'alt';
  const nl = result[key];
  const wps = r.waypoints;
  let html = '';
  if (windChanges.length) html += `<div class="warnings" style="color:var(--tint);background:rgba(10,132,255,0.1)"><b>Winds updated — changes:</b><br>${windChanges.map(esc).join('<br>')}<br>Download the navlog again to reprint.</div>`;
  if (nl.warnings.length) html += `<div class="warnings">${nl.warnings.map(esc).join('<br>')}</div>`;

  const lm = state.flight.levelMode === 'alt' ? 'alt' : 'fl';
  const taFt = endpoint('main', 0)?.ta || 6000;
  html += `<div class="group levelmode"><div class="row"><span class="grow"><b>Levels</b> <span class="label">${lm === 'fl' ? `FL above ${taFt} ft (transition altitude)` : 'altitudes on QNH everywhere'}</span></span>
    <div class="segmented small"><button data-levelmode="fl" class="${lm === 'fl' ? 'on' : ''}">FL</button><button data-levelmode="alt" class="${lm === 'alt' ? 'on' : ''}">ALT</button></div></div></div>`;
  {
    const ads = APPROVED.filter((x) => adPoint(x));
    const opt = (sel) => ads.map((x) => `<option value="${x}" ${x === sel ? 'selected' : ''}>${x} · ${esc((adByIcao(x) || {}).name || '')}</option>`).join('');
    const lf = state.view.libFrom || 'LEBG', lt = state.view.libTo || (lf === 'LEBG' ? 'LERJ' : 'LEBG');
    html += `<details class="group options lib" ${state.view.libOpen ? 'open' : ''}><summary><span>Route library</span><span class="label">ready-made routes</span></summary>
      <div class="row wrap" style="gap:8px"><label class="field"><span>From</span><select data-lib="from">${opt(lf)}</select></label>
        <button class="btn small" data-act="libSwap" aria-label="Swap" style="align-self:flex-end">⇄</button>
        <label class="field"><span>To</span><select data-lib="to">${opt(lt)}</select></label></div>
      <div class="row"><span class="grow label">Out by a reporting point, town to town with no leg over ${MAX_LEG_NM} NM, in by a reporting point; keeps out of restricted areas, prefers low ground; adds the nearest alternate.</span></div>
      <div class="row"><button class="btn primary wide" data-act="libBuild">Build route ${esc(lf)} → ${esc(lt)}</button></div>
    </details>`;
  }
  const optSummary = [r.stdDep && 'std dep', r.stdArr && 'std arr', state.flight.solo && 'solo', state.flight.lowCloud && 'low cloud'].filter(Boolean).join(' · ') || 'none';
  html += `<details class="group options" ${state.view.optsOpen ? 'open' : ''}><summary><span>Flight options</span><span class="label">${optSummary}</span></summary>
    <div class="toggle-row"><span>Standard departure — ${SOP.stdDepMin} min <small class="label">(only when starting at an aerodrome)</small></span>
      <label class="switch"><input type="checkbox" data-flag="stdDep" ${r.stdDep ? 'checked' : ''}><span></span></label></div>
    <div class="toggle-row"><span>Standard arrival — ${SOP.stdArrMin} min <small class="label">(only when ending at an aerodrome)</small></span>
      <label class="switch"><input type="checkbox" data-flag="stdArr" ${r.stdArr ? 'checked' : ''}><span></span></label></div>
    <div class="toggle-row"><span>Solo flight <small class="label">(LEBG entry only via N or W)</small></span>
      <label class="switch"><input type="checkbox" data-solo ${state.flight.solo ? 'checked' : ''}><span></span></label></div>
    <div class="toggle-row"><span>LEBG low-cloud procedure <small class="label">(cloud base below 5000 ft · dual only)</small></span>
      <label class="switch"><input type="checkbox" data-lowcloud ${state.flight.lowCloud ? 'checked' : ''} ${state.flight.solo ? 'disabled' : ''}><span></span></label></div>
  </details>`;
  const soloIssue = soloEntryIssue();
  if (soloIssue) html = `<div class="warnings">${esc(soloIssue)}</div>` + html;
  const semi = seraIssues(key);
  if (semi.length) html = `<ul class="issues tappable">${semi.map((x) => `<li class="warn" data-go="${esc(JSON.stringify(issueTarget(x)))}"><span class="ic">!</span><span>${esc(x.text)}</span><span class="go">›</span></li>`).join('')}</ul>` + html;

  html += `<div class="group-title"><span>${isAlt ? 'Alternate route' : 'Route'} · ${wps.length} point${wps.length === 1 ? '' : 's'}</span>
    <span><button class="btn small" data-act="compact" title="One line per point, or every point open">${state.view.compact === false ? 'Compact' : 'Expand'}</button> <button class="btn small" data-act="windall" title="Same wind for every leg">All winds</button> <button class="btn small" data-act="reverse">Reverse</button> <button class="btn small danger" data-act="clear">Clear</button></span></div>`;

  const sugg = isAlt ? companyAlternate() : null;
  if (sugg && (wps.length <= 1)) {
    html += `<div class="group"><div class="row"><span class="grow">Company alternate policy: <b>${sugg}</b> is the ideal alternate for ${endpoint('main', -1)?.icao}. Check NOTAMs for every alternate.</span><button class="btn small primary" data-act="useAlt" data-ad="${sugg}">Use ${sugg}</button></div></div>`;
  }
  if (!wps.length) {
    html += `<div class="group"><div class="empty">${isAlt ? 'Tap the chart to plan the route to your alternate. It starts at your destination.' : 'Tap the chart to add your first waypoint.'}</div></div>`;
  } else {
    html += `<div class="group ${isAlt ? 'alt-mode' : ''}">`;
    const stdOn = stdFlags(r);
    const compact = state.view.compact !== false;
    wps.forEach((w, i) => {
      const legRows = nl.rows.filter((x) => x.legIndex === i);
      const sub = w.ref ? (POINTS.find((p) => p.key === w.ref)?.sub || '') : `${w.lat.toFixed(4)}, ${w.lon.toFixed(4)}`;
      if (compact && w.id !== selectedId) {
        // one line: number · name · altitude · MH · leg time · fuel (+ a warning sign when something needs a look)
        let line = '', flag = '';
        if (i > 0 && legRows.length) {
          const last = legRows[legRows.length - 1];
          const ete = legRows.reduce((t, x) => t + x.eteSec, 0), fuel = Math.round(legRows.reduce((t, x) => t + x.fuel, 0) * 10) / 10;
          const lm = legMinimum(key, i);
          const low = lm && !isProcPoint(wps, i) && parseAlt(w.alt) != null && parseAlt(w.alt) < lm.need;
          const sera = !isProcPoint(wps, i) && !(i === 1 && stdOn.dep) && !(i === wps.length - 1 && stdOn.arr) ? semicircularHint(last.mc, parseAlt(w.alt)) : null;
          const long = nmDist(wps[i - 1], w) > MAX_LEG_NM + 0.05 && !isProcPoint(wps, i);
          if (low || sera || long) flag = `<span class="wp-flag" title="${esc([low && 'below the minimum altitude', sera && 'cruising level', long && `leg over ${MAX_LEG_NM} NM`].filter(Boolean).join(' · '))}">!</span>`;
          line = `<span><b>${esc(last.altDisp || w.alt || '')}</b></span><span>${String(last.mh).padStart(3, '0')}°</span><span>${fmtMMSS(ete)}</span><span>${fuel} L</span>${w.proc ? '<span class="tag">VAC</span>' : ''}`;
        } else if (i === 0) line = `<span class="label">${esc(sub)}</span>`;
        html += `<div class="wp compact" data-id="${w.id}" data-expand="${w.id}"><div class="wp-n">${i + 1}</div><div class="wp-cname">${esc(w.name)}</div><div class="wp-line">${line}</div>${flag}<span class="go">›</span></div>`;
        return;
      }
      html += `<div class="wp ${compact ? 'open' : ''}" data-id="${w.id}">
        <div class="wp-n" ${compact ? `data-collapse="${w.id}" title="Close"` : ''}>${i + 1}</div>
        <input class="wp-name" data-f="name" value="${esc(w.name)}" aria-label="Waypoint name">
        <div class="wp-actions">
          <button class="icon-btn" data-act="up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
          <button class="icon-btn" data-act="down" aria-label="Move down" ${i === wps.length - 1 ? 'disabled' : ''}>${ICON.down}</button>
          <button class="icon-btn" data-act="del" aria-label="Delete">${ICON.trash}</button>
          ${compact ? `<button class="icon-btn collapse-btn" data-collapse="${w.id}" aria-label="Close">⌃</button>` : ''}
        </div>
        <div class="wp-sub" ${compact ? `data-collapse="${w.id}"` : ''}>${esc(sub)}${adByIcao(w.ref) ? ` · ${adByIcao(w.ref).elev} ft · <a href="${adByIcao(w.ref).vac}" target="_blank" rel="noopener">VAC ↗</a>` : ''}</div>`;
      if (i > 0) {
        const altFt = parseAlt(w.alt) || 0;
        const tasPh = (i === 1 && stdOn.dep) || (i === wps.length - 1 && stdOn.arr) ? planSop().tasBase : cruiseTas(altFt, planSop());
        const m = midpoint(wps[i - 1], w);
        const windy = `https://www.windy.com/?wind,${windyLevel(altFt)},${m.lat.toFixed(3)},${m.lon.toFixed(3)},9`;
        html += `<div class="leg">
          <label class="field"><span>Alt / FL</span><input data-f="alt" inputmode="text" value="${esc(w.alt ?? '')}" placeholder="5500"></label>
          <label class="field narrow"><span>Wind °T${w.windSrc === 'auto' ? ' · auto' : ''}</span><input data-f="wdir" inputmode="numeric" value="${esc(w.wdir ?? '')}" placeholder="000"></label>
          <label class="field narrow"><span>Kt</span><input data-f="wspd" inputmode="numeric" value="${esc(w.wspd ?? '')}" placeholder="0"></label>
          <label class="field narrow"><span>Var °E</span><input data-f="var" inputmode="numeric" value="${esc(w.var ?? '')}" placeholder="1"></label>
          <label class="field narrow"><span>TAS</span><input data-f="tas" inputmode="numeric" value="${esc(w.tas ?? '')}" placeholder="${tasPh}"></label>
          <div class="field narrow"><span>Wind src</span><a href="${windy}" target="_blank" rel="noopener">Windy ↗</a></div>
        </div>`;
        if (legRows.length) {
          const ete = legRows.reduce((t, x) => t + x.eteSec, 0);
          const fuel = Math.round(legRows.reduce((t, x) => t + x.fuel, 0) * 10) / 10;
          const last = legRows[legRows.length - 1];
          const dist = legRows.reduce((t, x) => t + x.dist, 0);
          const sera = !isProcPoint(wps, i) && !(i === 1 && stdOn.dep) && !(i === wps.length - 1 && stdOn.arr) ? semicircularHint(last.mc, parseAlt(w.alt)) : null;
          const lm = legMinimum(key, i);
          const lmLow = lm && !isProcPoint(wps, i) && parseAlt(w.alt) != null && parseAlt(w.alt) < lm.need;
          html += `<div class="leg-out">${w.proc ? `<span class="tag">${w.proc === 'dep' ? 'Departure route' : 'Arrival route'} · VAC</span>` : ''}<span>TC <b>${last.tc}°</b></span><span>MH <b>${last.mh}°</b></span><span>Dist <b>${dist} NM</b></span><span>GS <b>${last.gs} kt</b></span><span>ETE <b>${fmtMMSS(ete)}</b></span><span>Fuel <b>${fuel} L</b></span>${legRows.length > 1 ? `<span>incl. <b>${legRows.find((x) => x.auto)?.to || ''}</b></span>` : ''}${lm ? `<span class="${lmLow ? 'minalt low' : 'minalt'}" title="${esc(lm.why)}">Min <b>${lm.need} ft</b></span>` : ''}${sera ? `<span class="hint">${sera}</span>` : ''}${lmLow ? `<span class="hint">Below the minimum: ${esc(lm.why)}</span>` : ''}</div>`;
        }
      }
      html += '</div>';
    });
    html += '</div>';
  }
  html += `<p class="note">Winds marked “auto” are filled from the Open-Meteo forecast at each leg's altitude and time${state.windSource ? ` (fetched ${new Date(state.windSource.at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })})` : ''}. The SOP's approved sources are <a href="https://www.windy.com" target="_blank" rel="noopener">windy.com</a> and <a href="https://ama.aemet.es/en" target="_blank" rel="noopener">ama.aemet.es</a> — check them on Windy (link on each leg); a wind you type is kept. Winds are true direction. VAR is east-positive (Burgos 1°E): MC = TC − VAR E. Drag the small dot in the middle of a leg to insert a waypoint; drag a waypoint to move it.</p>`;
  const ml = state.mission && state.mission.legs.find((l) => l.id === state.mission.active);
  if (ml) html = `<div class="group"><div class="row"><span class="grow">Mission leg: <b>${esc(ml.label)}</b>${state.mission.type === 'local' ? ' <small class="label">(alternate shared by both navlogs)</small>' : ''}</span><button class="btn small" data-act="toMission">Mission</button></div></div>` + html;
  if (result.main.rows.length) html += state.active === 'main' && state.alt.waypoints.length < 2
    ? `<button class="btn primary wide next-step" data-route-go="alt" style="--c: var(--alt)">Next · plan the alternate →</button>`
    : `<button class="btn primary wide next-step" data-goto="mb" style="--c: var(--c-mb)">Next · 3 M&amp;B →</button>`;
  panels.route.innerHTML = html;
}

/** Number typed by the student: accepts a decimal comma (Spanish keyboards) or point; '' when empty or not a number. */
function num(v) {
  const t = String(v ?? '').trim().replace(/\s+/g, '').replace(',', '.');
  if (t === '') return '';
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : '';
}
const numMin0 = (v) => { const n = num(v); return n === '' ? '' : Math.max(0, n); };
panels.route.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.lib) { state.view[t.dataset.lib === 'from' ? 'libFrom' : 'libTo'] = t.value; scheduleSave(); return renderPanels(); }
  if (t.dataset.flag) { route()[t.dataset.flag] = t.checked; return update({ rerenderPanels: true }); }
  if (t.hasAttribute('data-solo')) { state.flight.solo = t.checked; if (t.checked) state.flight.lowCloud = false; return update({ rerenderPanels: true }); }
  if (t.hasAttribute('data-lowcloud')) { state.flight.lowCloud = t.checked; toast(t.checked ? 'LEBG low-cloud procedure: depart via S, W or N at 4500 ft; arrive via N, W or S–E-1 at 4000 ft. E point not used.' : 'Normal LEBG procedures'); return update({ rerenderPanels: true }); }
  const row = t.closest('.wp'); if (!row || !t.dataset.f) return;
  const w = route().waypoints.find((x) => x.id === +row.dataset.id); if (!w) return;
  const f = t.dataset.f;
  let v = t.value.trim();
  if (f === 'wdir') { v = num(v); if (v !== '') v = ((v % 360) + 360) % 360; }
  if (f === 'wspd' || f === 'tas') v = numMin0(v);
  if (f === 'var') v = num(v);
  if (f === 'alt') v = /^fl/i.test(v) ? v.toUpperCase().replace(/\s+/g, '') : (v === '' ? '' : parseAlt(v));
  w[f] = v;
  if (f === 'alt') w.altAuto = false; // the student chose this level
  if (f === 'wdir' || f === 'wspd') w.windSrc = v === '' ? undefined : 'manual';
  update({ rerenderPanels: true });
});
panels.route.addEventListener('toggle', (e) => { if (e.target.matches('details.lib')) { state.view.libOpen = e.target.open; scheduleSave(); } else if (e.target.matches('details.options')) { state.view.optsOpen = e.target.open; scheduleSave(); } }, true);
panels.route.addEventListener('click', (e) => {
  const col = e.target.closest('[data-collapse]');
  if (col && !e.target.closest('a')) { selectedId = null; drawRoutes(); renderRoute(); return; }
  const ex = e.target.closest('[data-expand]');
  if (ex) { selectWaypoint(+ex.dataset.expand, false); renderRoute(); const el = panels.route.querySelector(`.wp[data-id="${ex.dataset.expand}"]`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
  if (e.target.closest('[data-act=compact]')) { state.view.compact = state.view.compact === false; scheduleSave(); return renderRoute(); }
  if (e.target.closest('[data-act=libBuild]')) { const f = state.view.libFrom || 'LEBG'; return buildLibraryRoute(f, state.view.libTo || (f === 'LEBG' ? 'LERJ' : 'LEBG')); }
  if (e.target.closest('[data-act=libSwap]')) { const f = state.view.libFrom || 'LEBG', t = state.view.libTo || (f === 'LEBG' ? 'LERJ' : 'LEBG'); state.view.libFrom = t; state.view.libTo = f; scheduleSave(); return renderPanels(); }
  const lmb = e.target.closest('[data-levelmode]');
  if (lmb) { state.flight.levelMode = lmb.dataset.levelmode; toast(lmb.dataset.levelmode === 'alt' ? 'Navlog shows altitudes (QNH)' : 'Navlog shows flight levels above the transition altitude'); return update({ rerenderPanels: true }); }
  if (e.target.closest('[data-act=toMission]')) return document.querySelector('#modes [data-mode=mission]').click();
  const b = e.target.closest('[data-act]'); if (!b) return;
  const r = route();
  const act = b.dataset.act;
  if (act === 'useAlt') {
    const p = POINTS.find((x) => x.key === b.dataset.ad);
    if (p) addPoint(p);
    return;
  }
  if (act === 'clear') {
    if (!confirm(`Clear the ${state.active === 'alt' ? 'alternate' : 'main'} route?`)) return;
    r.waypoints = state.active === 'main' ? [adWaypoint(LEBG)] : [];
  } else if (act === 'reverse') {
    r.waypoints.reverse();
  } else if (act === 'windall') {
    const s = prompt('Wind for all legs (true direction/speed), e.g. 240/12');
    const m = s && s.match(/(\d{1,3})\D+(\d{1,3})/);
    if (!m) return;
    r.waypoints.forEach((w, i) => { if (i > 0) { w.wdir = +m[1] % 360; w.wspd = +m[2]; w.windSrc = 'manual'; } });
  } else {
    const row = b.closest('.wp');
    const i = r.waypoints.findIndex((x) => x.id === +row.dataset.id);
    if (act === 'del') r.waypoints.splice(i, 1);
    if (act === 'up' && i > 0) [r.waypoints[i - 1], r.waypoints[i]] = [r.waypoints[i], r.waypoints[i - 1]];
    if (act === 'down' && i < r.waypoints.length - 1) [r.waypoints[i + 1], r.waypoints[i]] = [r.waypoints[i], r.waypoints[i + 1]];
  }
  update({ rerenderPanels: true });
});
panels.route.addEventListener('focusin', (e) => {
  const row = e.target.closest('.wp'); if (row) selectWaypoint(+row.dataset.id, false);
});

function selectWaypoint(id, scroll) {
  const changed = selectedId !== id;
  selectedId = id;
  drawRoutes();
  if (changed && scroll && state.view.compact !== false && tab === 'route' && state.mode === 'plan') renderRoute();
  if (scroll) {
    if (state.mode !== 'plan') { state.mode = 'plan'; showPanels(); }
    if (tab !== 'route') document.querySelector('#tabs [data-tab=route]').click();
    if (!isWide() && sheetDetent === 0) setDetent(1);
    const el = panels.route.querySelector(`.wp[data-id="${id}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function headerFor(key) {
  return { ...headerBase(key), ...((state[key] && state[key].hdrOv) || {}) };
}
function headerBase(key) {
  const f = state.flight;
  const t = flightTime();
  const date = t.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }); // date only (the T/O time is not part of the date box)
  const mainDep = endpoint('main', 0), mainDest = endpoint('main', -1), altDest = endpoint('alt', -1);
  const fp = result.fuel;
  const mb = result.mb;
  const ads = [mainDep, mainDest, altDest].filter(Boolean).filter((a, i, arr) => arr.findIndex((b) => b.icao === a.icao) === i);
  const freqs = ads.map((a) => a.freq).filter(Boolean);
  const nearVitoria = ads.some((a) => ['LEBG', 'LEVT', 'LERJ'].includes(a.icao));
  if (nearVitoria && !freqs.some((x) => x.startsWith('LEVT'))) freqs.push('LEVT:118.450');
  freqs.push('OPS:130.705');
  const freq = freqs.join(' | ');
  if (key === 'main') {
    return {
      date, callsign: f.callsign, reg: f.reg, weather: effWeather(f.weather), freq,
      dep: mainDep?.icao || state.main.waypoints[0]?.name || '', dest: mainDest?.icao || state.main.waypoints.at(-1)?.name || '',
      alt: altDest?.icao || '',
      elevDep: mainDep?.elev ?? '', elevDest: mainDest?.elev ?? '', elevAlt: altDest?.elev ?? '',
      tom: mb?.tom, lmDest: mb?.lm, lmAlt: altDest ? mb?.lmAlt : '',
      trip: fp.trip, altFuel: altDest ? fp.alternate : '', contingency: fp.contingency, finalReserve: fp.finalReserve,
    };
  }
  const trip = result.alt.totals.trip;
  return {
    date, callsign: f.callsign, reg: f.reg, weather: effWeather(f.weather), freq,
    dep: mainDest?.icao || '', dest: altDest?.icao || state.alt.waypoints.at(-1)?.name || '', alt: '',
    elevDep: mainDest?.elev ?? '', elevDest: altDest?.elev ?? '', elevAlt: '',
    tom: mb?.lm, lmDest: mb?.lmAlt, lmAlt: '',
    trip, altFuel: '', contingency: Math.round(trip * SOP.contingencyPct) / 100, finalReserve: fp.finalReserve,
  };
}

/* ---------------- Sheet view: the navlog as the school's LNAV Excel / VOFP form, every cell editable ----------------
 * Same layout as the printed form: header, then blocks of two lines (waypoint, TC, VAR/MC, ALT, TAS,
 * wind, WCA/MH, Dist leg/rem, GS, ETE/ATE, ETA/ATA, Fuel/rem), 7 blocks per half, two halves per page.
 * A typed value overrides the computed one (amber) and flows on through the calculation; clear the
 * cell to go back to the computed value. */
const sheetEl = document.getElementById('nlSheet');
function sheetCell(f, val, { wid = '', k = '', ov = false, cls = '', w = '' } = {}) {
  return `<input class="sc ${ov ? 'ov' : ''} ${cls}" data-f="${f}" data-wid="${wid}" data-k="${k}" value="${esc(val ?? '')}" ${w ? `style="width:${w}"` : ''} autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="next">`;
}
function renderSheetView() {
  if (!sheetEl) return;
  const open = !!state.view.sheetOpen && state.mode === 'plan';
  sheetEl.hidden = !open;
  document.body.classList.toggle('sheet-open', open);
  document.body.classList.toggle('sheet-full', open && !!state.view.sheetFull);
  if (!open) return;
  const key = state.active, nl = result[key], h = headerFor(key), hov = (state[key].hdrOv) || {};
  const wps = state[key].waypoints;
  const H = (f, v, cls = '') => `<input class="sc h ${hov[f] != null && hov[f] !== '' ? 'ov' : ''} ${cls}" data-h="${f}" value="${esc(v ?? '')}" autocomplete="off" spellcheck="false" enterkeyhint="next">`;
  const F = (f, v) => `<input class="sc h" data-hf="${f}" value="${esc(v ?? '')}" autocomplete="off" spellcheck="false" autocapitalize="characters" enterkeyhint="next">`;
  const L = (v) => (v === '' || v == null ? '' : `${Math.round(+v * 100) / 100}`);
  const fob = state[key] === state.alt ? result.main.rows.at(-1)?.fuelRem ?? '' : state.flight.fob;
  let html = `<div class="ss-bar"><b>Navlog sheet</b>
    <div class="segmented small"><button data-ss-route="main" class="${key === 'main' ? 'on' : ''}">Main</button><button data-ss-route="alt" class="${key === 'alt' ? 'on' : ''}">Alternate</button></div>
    <span class="grow"></span>
    <button class="btn small" data-ss="reset">Clear manual edits</button>
    <button class="btn small" data-ss="full">${state.view.sheetFull ? 'Show map' : 'Full screen'}</button>
    <button class="btn small primary" data-act="pdf">PDF</button>
    <button class="btn small" data-ss="close" aria-label="Close">✕</button></div>
  <div class="ss-scroll"><div class="ss-form">
  <table class="ss-head"><tbody>
    <tr><td colspan="2" class="ttl">${key === 'alt' ? 'ALT' : 'L1'}</td><td colspan="8" class="ttl">VISUAL OPERATIONAL FLIGHT PLAN</td><td class="lb">Trip Fuel:</td><td>${H('trip', L(h.trip), 'b')}</td></tr>
    <tr><td class="lb">Date:</td><td>${H('date', h.date)}</td><td class="lb">Departure:</td><td>${H('dep', h.dep, 'b')}</td><td class="lb">Destination:</td><td>${H('dest', h.dest, 'b')}</td><td class="lb">Alternate:</td><td>${H('alt', h.alt, 'b')}</td><td class="lb">Alternate:</td><td>${H('altFuel', L(h.altFuel))}</td><td class="lb">Fuel</td><td>${H('fob', hov.fob ?? fob)}</td></tr>
    <tr><td class="lb">Callsign:</td><td>${F('callsign', state.flight.callsign)}</td><td class="lb">TOM (kg)</td><td>${H('tom', L(h.tom))}</td><td class="lb">LM (kg)</td><td>${H('lmDest', L(h.lmDest))}</td><td class="lb">LM (kg)</td><td>${H('lmAlt', L(h.lmAlt))}</td><td class="lb">Contingency:</td><td>${H('contingency', L(h.contingency))}</td><td class="lb">Distance</td><td>${H('distance', hov.distance ?? nl.totals.dist)}</td></tr>
    <tr><td class="lb">Reg:</td><td>${F('reg', state.flight.reg)}</td><td class="lb">Elevation (ft)</td><td>${H('elevDep', h.elevDep)}</td><td class="lb">Elevation (ft)</td><td>${H('elevDest', h.elevDest)}</td><td class="lb">Elevation (ft)</td><td>${H('elevAlt', h.elevAlt)}</td><td class="lb">Final Reserve:</td><td>${H('finalReserve', L(h.finalReserve))}</td><td colspan="2"></td></tr>
    <tr><td class="lb">Weather Info:</td><td colspan="5">${F('weather', effWeather(state.flight.weather))}</td><td class="lb">AOBT:</td><td>${H('aobt', hov.aobt)}</td><td class="lb">ATOT:</td><td>${H('atot', hov.atot)}</td><td class="lb">LDG / OFF:</td><td>${H('ldg', hov.ldg)}</td></tr>
    <tr><td class="lb">Frequencies:</td><td colspan="7">${H('freq', h.freq)}</td><td class="lb">Squawk</td><td>${H('squawk', hov.squawk)}</td><td class="lb">Total time</td><td class="tt">${fmtHMS(nl.totals.timeSec)}</td></tr>
  </tbody></table>`;
  const rows = nl.rows;
  const pages = Math.max(1, Math.ceil(rows.length / (PER_SIDE * 2)));
  const has = (r, f) => r && r.ovr && r.ovr.includes(f);
  const side = (from) => {
    let t = `<table class="ss-grid"><colgroup><col class="c-nm">${'<col>'.repeat(12)}</colgroup><thead><tr><th rowspan="2">Waypoint</th><th rowspan="2">TC</th><th>VAR</th><th rowspan="2">ALT /<br>Level</th><th rowspan="2">TAS</th><th colspan="2">Wind</th><th>WCA</th><th>Dist</th><th rowspan="2">GS</th><th>ETE</th><th>ETA</th><th>Fuel</th></tr>
      <tr><th>MC</th><th>Dir</th><th>Speed</th><th>MH</th><th>Leg / Rem</th><th>ATE</th><th>ATA</th><th>Rem</th></tr></thead><tbody>`;
    for (let j = 0; j < PER_SIDE; j++) {
      const r = rows[from + j];
      if (!r) { t += '<tr class="t"><td></td><td rowspan="2"></td><td></td><td rowspan="2"></td><td rowspan="2"></td><td rowspan="2"></td><td rowspan="2"></td><td></td><td></td><td rowspan="2"></td><td></td><td></td><td></td></tr><tr class="b"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>'; continue; }
      const o = { wid: r.wid, k: r.k };
      const isFirst = from + j === 0;
      const legEnd = !r.auto; // the row that ends at the leg's waypoint (its altitude is the waypoint's)
      t += `<tr class="t ${r.auto ? 'auto' : ''}" data-wid="${r.wid}"><td>${isFirst ? sheetCell('from0', wps[0]?.name, { ...o, cls: 'nm' }) : ''}</td>
        <td rowspan="2">${sheetCell('tc', r.tc, { ...o, ov: has(r, 'tc') })}</td>
        <td>${sheetCell('var', fmtVar(r.var), o)}</td>
        <td rowspan="2">${sheetCell('alt', r.altDisp, { ...o, ov: has(r, 'altDisp'), cls: legEnd ? '' : 'auto-alt' })}</td>
        <td rowspan="2">${sheetCell('tas', r.tas, { ...o, ov: has(r, 'tas') })}</td>
        <td rowspan="2">${sheetCell('wdir', r.wspd ? String(r.wdir).padStart(3, '0') : '', o)}</td>
        <td rowspan="2">${sheetCell('wspd', r.wspd || '', o)}</td>
        <td>${sheetCell('wca', r.wca > 0 ? `+${r.wca}` : r.wca, { ...o, ov: has(r, 'wca') })}</td>
        <td>${sheetCell('dist', r.dist, { ...o, ov: has(r, 'dist') })}</td>
        <td rowspan="2">${sheetCell('gs', r.gs, { ...o, ov: has(r, 'gs') })}</td>
        <td>${sheetCell('ete', fmtMMSS(r.eteSec), { ...o, ov: has(r, 'ete'), cls: r.fixedMin && !has(r, 'ete') ? 'std' : 'b' })}</td>
        <td>${sheetCell('eta', r.etaOv || '', { ...o, ov: has(r, 'eta') })}</td>
        <td>${sheetCell('fuel', r.fuel, { ...o, ov: has(r, 'fuel') })}</td></tr>
        <tr class="b ${r.auto ? 'auto' : ''}" data-wid="${r.wid}"><td>${sheetCell('to', r.to, { ...o, cls: 'nm', ov: has(r, 'to') })}</td>
        <td>${sheetCell('mc', r.mc, { ...o, ov: has(r, 'mc'), cls: 'b' })}</td>
        <td>${sheetCell('mh', r.mh, { ...o, ov: has(r, 'mh'), cls: 'b' })}</td>
        <td>${sheetCell('rem', r.rem, { ...o, ov: has(r, 'rem') })}</td>
        <td>${sheetCell('ate', r.ateOv || '', { ...o, ov: has(r, 'ate') })}</td>
        <td>${sheetCell('ata', r.ataOv || '', { ...o, ov: has(r, 'ata') })}</td>
        <td>${sheetCell('fuelRem', r.fuelRem, { ...o, ov: has(r, 'fuelRem') })}</td></tr>`;
    }
    return t + '</tbody></table>';
  };
  for (let pg = 0; pg < pages; pg++) {
    html += `<div class="ss-page">${pages > 1 ? `<div class="ss-pg">Sheet ${pg + 1} of ${pages}</div>` : ''}<div class="ss-halves">${side(pg * PER_SIDE * 2)}${side(pg * PER_SIDE * 2 + PER_SIDE)}</div></div>`;
  }
  html += `</div></div><div class="ss-note">Type in any cell — it recalculates like the Excel. <span class="ov-key">Amber</span> = typed by you (clear the cell to go back to the computed value). TOC / TOD rows are added automatically from the altitudes. Moving a point on the map clears the typed TC / distance of its legs.</div>`;
  const act = document.activeElement, keep = act && act.closest && act.closest('#nlSheet') ? { f: act.dataset.f, h: act.dataset.h, hf: act.dataset.hf, wid: act.dataset.wid, k: act.dataset.k } : null;
  sheetEl.innerHTML = html;
  if (keep) {
    const sel = keep.h ? `[data-h="${keep.h}"]` : keep.hf ? `[data-hf="${keep.hf}"]` : `[data-f="${keep.f}"][data-wid="${keep.wid}"][data-k="${keep.k}"]`;
    const el = sheetEl.querySelector(sel); if (el) { el.focus(); try { el.select(); } catch { /* not a text field */ } }
  }
}
// parse "12:30" / "12.5" (minutes) into seconds
const mmssToSec = (v) => { const t = String(v).trim().replace(',', '.'); const m = /^(\d+):(\d{1,2})$/.exec(t); if (m) return +m[1] * 60 + +m[2]; const n = parseFloat(t); return Number.isFinite(n) ? Math.round(n * 60) : null; };
function sheetEdit(t) {
  const key = state.active, r = state[key];
  const v = t.value.trim();
  if (t.dataset.hf) {
    const f = t.dataset.hf;
    if (f === 'callsign') state.flight.callsign = v.toUpperCase();
    else if (f === 'reg') { const regs = Object.keys(acOf(state.flight.type).regs); const m = regs.find((x) => x.replace('-', '') === v.toUpperCase().replace('-', '')); if (m) state.flight.reg = m; else toast(`Registration: ${regs.join(', ')}`); }
    else state.flight[f] = v;
    return;
  }
  if (t.dataset.h) {
    r.hdrOv = r.hdrOv || {};
    const base = headerBase(key)[t.dataset.h];
    if (v === '' || String(base ?? '') === v) delete r.hdrOv[t.dataset.h]; else r.hdrOv[t.dataset.h] = v;
    return;
  }
  const f = t.dataset.f, wps = r.waypoints;
  if (f === 'from0') { if (wps[0] && v) wps[0].name = v; return; }
  const w = wps.find((x) => x.id === +t.dataset.wid); if (!w) return;
  const k = +t.dataset.k;
  const row = result[key].rows.find((x) => x.wid === w.id && x.k === k);
  const setOv = (field, val) => { w.ov = w.ov || {}; w.ov[k] = w.ov[k] || {}; if (val === '' || val == null) delete w.ov[k][field]; else w.ov[k][field] = val; if (!Object.keys(w.ov[k]).length) delete w.ov[k]; };
  switch (f) {
    case 'to': if (row && !row.auto) { if (v) w.name = v; } else setOv('to', v); break;
    case 'var': { const m = /^([+-]?\d+(?:[.,]\d+)?)\s*([EW])?$/i.exec(v); if (m) { const n = +m[1].replace(',', '.'); w.var = m[2] ? (m[2].toUpperCase() === 'W' ? -Math.abs(n) : Math.abs(n)) : n; } else if (v === '') w.var = ''; break; }
    case 'alt':
      if (row && !row.auto) { if (v) { w.alt = /^fl/i.test(v) ? v.toUpperCase().replace(/\s+/g, '') : parseAlt(v); w.altAuto = false; } setOv('altDisp', ''); }
      else setOv('altDisp', v);
      break;
    case 'wdir': { const n = num(v); w.wdir = n === '' ? '' : ((n % 360) + 360) % 360; w.windSrc = 'manual'; break; }
    case 'wspd': w.wspd = numMin0(v); w.windSrc = 'manual'; break;
    case 'ete': setOv('ete', v === '' ? '' : mmssToSec(v)); break;
    case 'eta': case 'ate': case 'ata': setOv(f, v); break;
    default: { // tc, mc, tas, wca, mh, dist, gs, fuel, rem, fuelRem
      const n = num(v.replace(/^\+/, ''));
      const computedNow = row ? row[f] : null;
      if (n === '' ) setOv(f, ''); else if (computedNow != null && +computedNow === n && !(w.ov && w.ov[k] && w.ov[k][f] != null)) { /* unchanged */ } else setOv(f, n);
    }
  }
}
document.getElementById('btnSheet')?.addEventListener('click', () => { state.view.sheetOpen = true; scheduleSave(); renderSheetView(); setTimeout(() => map.invalidateSize(), 250); });
if (sheetEl) {
  sheetEl.addEventListener('change', (e) => {
    const t = e.target; if (!t.matches('input.sc')) return;
    sheetEdit(t);
    setTimeout(() => update({ rerenderPanels: true }), 0); // after focus has moved to the next cell
  });
  sheetEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('input.sc')) return;
    e.preventDefault();
    const all = [...sheetEl.querySelectorAll('input.sc')]; const i = all.indexOf(e.target);
    (all[i + 1] || e.target).focus();
  });
  sheetEl.addEventListener('focusin', (e) => {
    const t = e.target; if (!t.matches('input.sc')) return;
    try { t.select(); } catch { /* ignore */ }
    if (t.dataset.wid && +t.dataset.wid !== selectedId) { selectedId = +t.dataset.wid; drawRoutes(); }
  });
  sheetEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ss],[data-ss-route],[data-act=pdf]'); if (!b) return;
    if (b.dataset.act === 'pdf') return downloadPdf();
    if (b.dataset.ssRoute) { state.active = b.dataset.ssRoute; return update({ rerenderPanels: true }); }
    const a = b.dataset.ss;
    if (a === 'close') { state.view.sheetOpen = false; state.view.sheetFull = false; }
    if (a === 'full') state.view.sheetFull = !state.view.sheetFull;
    if (a === 'reset') {
      if (!confirm('Clear every value you typed in the sheet for this route (back to the computed values)?')) return;
      const r = state[state.active]; r.waypoints.forEach((w) => { delete w.ov; }); delete r.hdrOv;
    }
    scheduleSave(); renderSheetView(); setTimeout(() => map.invalidateSize(), 250);
  });
}

function renderNavlog() {
  const key = state.active;
  const nl = result[key];
  const h = headerFor(key);
  const f = state.flight;
  let html = `<div class="nl-head">
    <div class="field"><span>Aircraft</span><b>${esc(fleetType(f.type).name)} · ${esc(f.reg)}</b></div>
    <div class="field"><span>Departure</span><b>${esc(h.dep) || '—'}</b></div>
    <div class="field"><span>Destination</span><b>${esc(h.dest) || '—'}</b></div>
    <div class="field"><span>Alternate</span><b>${esc(h.alt) || '—'}</b></div>
    <label class="field" style="grid-column: 1 / -1"><span>Weather info</span><input data-ff="weather" value="${esc(effWeather(f.weather))}" placeholder="METAR / TAF summary"></label>
  </div>`;
  if (nl.warnings.length) html += `<div class="warnings">${nl.warnings.map(esc).join('<br>')}</div>`;
  html += `<div class="nl-wrap"><table class="nl"><thead>
    <tr><th rowspan="2">Waypoint</th><th rowspan="2">TC</th><th>VAR</th><th rowspan="2">ALT/<br>Level</th><th rowspan="2">TAS</th><th colspan="2">Wind</th><th>WCA</th><th>Dist Leg</th><th rowspan="2">GS</th><th>ETE</th><th>ETA</th><th>Fuel</th></tr>
    <tr><th>MC</th><th>Dir</th><th>Speed</th><th>MH</th><th>Rem</th><th>ATE</th><th>ATA</th><th>Rem</th></tr>
  </thead><tbody>`;
  if (nl.rows.length) {
    html += `<tr class="top"><td class="wpt">${esc(nl.rows[0].from)}</td><td colspan="12"></td></tr>`;
  }
  nl.rows.forEach((r) => {
    const cls = `${r.auto ? 'auto' : ''} ${r.fixedMin ? 'std' : ''}`;
    html += `<tr class="top ${cls}"><td class="wpt"></td><td rowspan="2">${r.tc}</td><td>${fmtVar(r.var)}</td><td rowspan="2">${esc(r.altDisp)}${r.vs ? `<span class="alt-arrow ${r.vs}">${r.vs === 'up' ? '↑' : '↓'}</span>` : ''}</td><td rowspan="2">${r.tas}</td>
      <td rowspan="2">${r.wspd ? String(r.wdir).padStart(3, '0') : '—'}</td><td rowspan="2">${r.wspd || '—'}</td><td>${r.wca > 0 ? '+' : ''}${r.wca}</td><td>${r.dist}</td>
      <td rowspan="2">${r.gs}</td><td class="ete strong">${fmtMMSS(r.eteSec)}</td><td class="muted">—</td><td>${r.fuel} L</td></tr>
      <tr class="bot ${cls}"><td class="wpt">${esc(r.to)}</td><td class="strong">${r.mc}</td><td class="strong">${r.mh}</td><td>${r.rem}</td><td class="muted">—</td><td class="muted">—</td><td>${r.fuelRem}</td></tr>`;
  });
  if (!nl.rows.length) html += '<tr><td colspan="13" class="empty">Add at least two waypoints.</td></tr>';
  html += `</tbody></table></div>
  <div class="group">
    <div class="row"><span class="grow label">Total distance</span><span class="value">${nl.totals.dist} NM</span></div>
    <div class="row"><span class="grow label">Total time</span><span class="value">${fmtHMS(nl.totals.timeSec)}</span></div>
    <div class="row"><span class="grow label">Trip fuel</span><span class="value">${nl.totals.trip.toFixed(2)} L</span></div>
  </div>
  <p class="note">Blue ETEs are SOP standard times (departure ${SOP.stdDepMin} min, arrival ${SOP.stdArrMin} min). TOC/TOD at ${SOP.roc} ft/min using GS; climb ${SOP.tasClimb} kt / ${planSop().ffClimb} L/h, descent ${SOP.tasDescent} kt / ${planSop().ffDescent} L/h, cruise IAS ${planSop().tasBase} kt + 2 kt/1000 ft, ${planSop().ffCruise} L/h (${esc(fleetType(state.flight.type).perf.src)}). ETA, ATE, ATA are filled in flight.</p>
  <button class="btn primary wide" data-act="pdf">Download navlog PDF</button>`;
  if (result.main.rows.length) html += `<button class="btn primary wide next-step" data-goto="mb" style="--c: var(--c-mb)">Next · 3 M&amp;B →</button>`;
  panels.navlog.innerHTML = html;
}
panels.navlog.addEventListener('change', (e) => {
  const k = e.target.dataset.ff; if (!k) return;
  state.flight[k] = k === 'callsign' ? e.target.value.toUpperCase().trim() : e.target.value;
  update({ rerenderPanels: true });
});
panels.navlog.addEventListener('click', (e) => {
  if (e.target.closest('[data-act=pdf]')) downloadPdf();
});

// SOP fuel policy: cross-country flights (different departure and destination) depart with full tanks.
function crossCountryFull() {
  const dep = endpoint('main', 0), dest = endpoint('main', -1);
  if (!dep || !dest || dep.icao === dest.icao) return '';
  const cap = acOf(state.flight.type).fuelMaxL, fob = +state.flight.fob || 0;
  const ok = fob >= cap;
  return `<div class="row ${ok ? 'check-ok' : 'check-bad'}"><span class="grow label">Cross-country: tanks full before the flight (${cap} L, within M&amp;B limits)</span><span class="value">${ok ? 'OK' : 'NOT FULL'}</span></div>`;
}

function renderFuel() {
  const f = state.flight;
  const p = result.fuel;
  const row = (l, v, cls = '') => `<div class="row ${cls}"><span class="grow label">${l}</span><span class="value">${v}</span></div>`;
  let html = `<div class="group-title"><span>Fuel on board</span></div>
  <div class="group"><div class="row" style="gap:6px;flex-wrap:wrap">
    <label class="field"><span>FOB (L) — ${f.fobSet ? 'from FISUP' : 'full tanks (base rule)'}</span><input data-ff="fob" inputmode="decimal" value="${esc(f.fob)}"></label>
    <label class="field"><span>Taxi (L)</span><input data-ff="taxi" inputmode="decimal" value="${esc(f.taxi)}" placeholder="from POH"></label>
    <label class="field"><span>Extra (L)</span><input data-ff="extra" inputmode="decimal" value="${esc(f.extra)}" placeholder="PIC"></label>
  </div></div>
  <div class="group-title"><span>Minimum fuel (SOP fuel calculations)</span></div>
  <div class="group">
    ${row('1 · Taxi', `${p.taxi} L`)}
    ${row('2 · Trip — climb, cruise, descent, approach', `${p.trip.toFixed(2)} L`)}
    ${row('3 · Alternate', `${p.alternate.toFixed(2)} L`)}
    ${row(`4 · Contingency — ${SOP.contingencyPct} % trip`, `${p.contingency.toFixed(2)} L`)}
    ${row(`5 · Final reserve — ${SOP.finalReserveMin} min holding`, `${p.finalReserve} L`)}
    ${row('6 · Extra — PIC discretion', `${p.extra} L`)}
    ${row('<b>Minimum required</b>', `${p.required} L`)}
  </div>
  <div class="group">${p.checks.map((c) => row(c.text, c.ok ? 'OK' : 'NOT MET', c.ok ? 'check-ok' : 'check-bad')).join('')}
  ${crossCountryFull()}
  ${f.taxi === '' ? row('Taxi fuel', 'Enter from POH', 'check-bad') : ''}</div>
  <div class="group-title"><span>Planning numbers · ${esc(fleetType(f.type).name)}</span>${state.perf && state.perf[f.type] ? '<button class="btn small" data-act="perfReset">Reset</button>' : ''}</div>
  <div class="group"><div class="row wrap">
    ${[['tasBase', 'Cruise IAS (kt)'], ['ffCruise', 'Cruise (L/h)'], ['ffClimb', 'Climb (L/h)'], ['ffDescent', 'Descent (L/h)']].map(([k, l]) => `<label class="field narrow"><span>${l}</span><input data-perf="${k}" inputmode="decimal" value="${planSop()[k]}"></label>`).join('')}
  </div><div class="row"><span class="grow label">${esc(fleetType(f.type).perf.src)}. Climb ${SOP.tasClimb} kt, descent ${SOP.tasDescent} kt, ${SOP.roc} ft/min (Phase 2 manual).</span></div></div>
  <p class="note">Fuel in litres, mass in kg (SOP 2511). Cross-country flights depart with full tanks within M&amp;B limits.</p>`;
  if (result.main.rows.length) html += `<button class="btn primary wide next-step" data-goto="mb" style="--c: var(--c-mb)">Next · 3 M&amp;B →</button>`;
  panels.fuel.innerHTML = html;
}
panels.fuel.addEventListener('click', (e) => {
  if (!e.target.closest('[data-act=perfReset]')) return;
  if (state.perf) delete state.perf[state.flight.type];
  update({ rerenderPanels: true });
});
panels.fuel.addEventListener('change', (e) => {
  const pk = e.target.dataset.perf;
  if (pk) {
    state.perf = state.perf || {};
    const own = (state.perf[state.flight.type] = state.perf[state.flight.type] || {});
    own[pk] = numMin0(e.target.value);
    return update({ rerenderPanels: true });
  }
  const k = e.target.dataset.ff; if (!k) return;
  state.flight[k] = numMin0(e.target.value);
  update({ rerenderPanels: true });
});

function mbTrip() {
  const useRoute = state.mb.tripSource === 'route' && result.main.rows.length > 0;
  return {
    useRoute,
    trip: useRoute ? result.main.totals.trip : (+state.mb.tripManual || 0),
    alt: useRoute ? result.alt.totals.trip : (+state.mb.altManual || 0),
  };
}

/* ---------------- Take-off & landing performance (SOP: "M&B with Take Off and Landing Distances") ---------------- */

// Conditions per aerodrome: from the METAR when it describes the flight time (±2 h of now),
// otherwise ISA / 1013 hPa / calm, and anything the student typed wins.
function perfConditions(role) {
  const ad = role === 'dep' ? endpoint('main', 0) : endpoint('main', -1);
  if (!ad) return null;
  const own = (state.perfCond && state.perfCond[role]) || {};
  const near = Math.abs(flightTime().getTime() - Date.now()) < 2 * 3600e3;
  const m = near && wxState.data && wxState.data[ad.icao] ? wxState.data[ad.icao].metar : null;
  const qnh = own.qnh !== undefined && own.qnh !== '' ? +own.qnh : m && m.altim ? Math.round(m.altim) : 1013;
  const pa = pressureAlt(ad.elev || 0, qnh);
  const oat = own.oat !== undefined && own.oat !== '' ? +own.oat : m && m.temp != null ? m.temp : Math.round(isaTemp(pa));
  const xw = m ? crosswind(ad.icao, m.wdir, m.wspd, 0) : null;
  const wind = own.wind !== undefined && own.wind !== '' ? +own.wind : xw ? xw.hw : 0;
  return {
    ad, role, qnh, pa, oat, wind, rwy: xw?.rwy, surface: own.surface || 'paved', slope: own.slope !== undefined && own.slope !== '' ? +own.slope : 0,
    src: { qnh: own.qnh != null && own.qnh !== '' ? 'typed' : m ? 'METAR' : 'standard', oat: own.oat != null && own.oat !== '' ? 'typed' : m && m.temp != null ? 'METAR' : 'ISA', wind: own.wind != null && own.wind !== '' ? 'typed' : xw ? `METAR, RWY ${xw.rwy}` : 'calm' },
  };
}
function perfType() {
  const f = state.flight;
  if (f.type === 'P2006') return MB_TYPES.P2006.ngRegs.includes(f.reg) ? 'P2006NG' : 'P2006';
  return f.type;
}
function perfResults() {
  const m = result.mb;
  return ['dep', 'dest'].map((role) => {
    const c = perfConditions(role);
    if (!c) return null;
    const weight = m && m.ac.unit === 'lb' ? (role === 'dep' ? m.to.mass : m.ldg.mass) : null;
    return { c, r: performance(perfType(), { ...c, weight }) };
  }).filter(Boolean);
}
function perfHtml() {
  const list = perfResults();
  if (!list.length) return '<div class="group"><div class="empty">Plan a route from an aerodrome to calculate take-off and landing distances.</div></div>';
  const dist = (v, unit) => (unit === 'ft' ? `${v} ft <small class="label">${Math.round(v / FT_PER_M)} m</small>` : `${v} m <small class="label">${Math.round(v * FT_PER_M)} ft</small>`);
  let html = '';
  for (const { c, r } of list) {
    const pc = (state.perfCond && state.perfCond[c.role]) || {};
    html += `<div class="group-title"><span>${c.role === 'dep' ? 'Take-off' : 'Landing'} · ${c.ad.icao} · elev ${c.ad.elev} ft</span></div><div class="group">
      <div class="row wrap">
        <label class="field narrow"><span>QNH</span><input data-pc="${c.role}.qnh" inputmode="numeric" value="${esc(pc.qnh ?? '')}" placeholder="${c.qnh}"></label>
        <label class="field narrow"><span>OAT °C</span><input data-pc="${c.role}.oat" inputmode="numeric" value="${esc(pc.oat ?? '')}" placeholder="${c.oat}"></label>
        <label class="field narrow"><span>Wind kt +head</span><input data-pc="${c.role}.wind" inputmode="numeric" value="${esc(pc.wind ?? '')}" placeholder="${c.wind}"></label>
        <label class="field narrow"><span>Slope %</span><input data-pc="${c.role}.slope" inputmode="decimal" value="${esc(pc.slope ?? '')}" placeholder="0"></label>
        <label class="field narrow"><span>Surface</span><select data-pc="${c.role}.surface"><option value="paved" ${c.surface === 'paved' ? 'selected' : ''}>Paved</option><option value="grass" ${c.surface === 'grass' ? 'selected' : ''}>Grass</option></select></label>
      </div>
      <div class="row"><span class="grow label">Pressure altitude ${c.pa} ft · ISA ${Math.round(isaTemp(c.pa))} °C · QNH ${c.src.qnh}, OAT ${c.src.oat}, wind ${esc(c.src.wind)} (type a value to override)</span></div>`;
    if (!r || r.manual) { html += `<div class="row check-bad"><span class="grow label">${esc(r ? r.manual : 'No table for this type')}</span></div></div>`; continue; }
    const ph = c.role === 'dep' ? r.to : r.ldg;
    if (ph.manual) { html += `<div class="row check-bad"><span class="grow label">${esc(ph.manual)}</span></div></div>`; continue; }
    html += `<div class="row"><span class="grow">${c.role === 'dep' ? 'Take-off ground roll' : 'Landing ground roll'}</span><span class="value">${dist(ph.gr, r.unit)}</span></div>
      ${ph.d50 != null ? `<div class="row"><span class="grow"><b>${c.role === 'dep' ? 'Take-off distance over 50 ft' : 'Landing distance from 50 ft'}</b></span><span class="value"><b>${dist(ph.d50, r.unit)}</b></span></div>` : ''}
      ${ph.out ? '<div class="row check-bad"><span class="grow label">Outside the table — the nearest edge was used. Check the AFM.</span></div>' : ''}
      <div class="row"><span class="grow label">${esc(r.source)}${ph.steps && ph.steps.length ? ` · corrections: ${esc(ph.steps.join(', '))}` : ''}${ph.note ? ` · ${esc(ph.note)}` : ''}. Compare with TORA/LDA (AD 2.13).</span></div></div>`;
  }
  return html;
}

function renderMB() {
  loadWeather();
  const f = state.flight, mbs = state.mb;
  const m = result.mb;
  const ac = acOf(f.type);
  const t = mbTrip();
  const row = (l, v, cls = '') => `<div class="row ${cls}"><span class="grow label">${l}</span><span class="value">${v}</span></div>`;
  const U = ac.unit, A = ac.armUnit, mom = ac.momentDiv ? `${U}·${A}/1000` : `${U}·${A}`;
  const n = (v, dp = 1) => (Number.isFinite(v) ? v.toFixed(dp) : '');
    const regs = Object.keys(ac.regs);
  let html = `<div class="group-title"><span>${esc(ac.name)} · MTOW ${m ? m.mtow : ac.mtow} ${U}</span></div>
  <div class="group"><div class="row wrap">
    <label class="field"><span>Aircraft type</span><select data-ff="type">${FLEET_TYPES.map((x) => `<option value="${x.id}" ${x.id === f.type ? 'selected' : ''}>${x.name}</option>`).join('')}</select></label>
    <label class="field"><span>Registration</span>${regs.length ? `<select data-ff="reg">${regs.map((r) => `<option ${r === f.reg ? 'selected' : ''}>${r}</option>`).join('')}</select>` : `<input data-ff="reg" value="${esc(f.reg)}" placeholder="EC-…" autocapitalize="characters">`}</label>
    <label class="field"><span>Student code</span><input data-mb="studentCode" value="${esc(mbs.studentCode)}" autocapitalize="characters" autocomplete="off"></label>
  </div>`;
  if (!regs.length || !ac.regs[f.reg]) {
    html += `<div class="row wrap"><label class="field"><span>Empty mass (${U})</span><input data-ff="emptyMass" inputmode="decimal" value="${esc(f.emptyMass)}"></label>
      <label class="field"><span>Empty moment (${U}·${A})</span><input data-ff="emptyMoment" inputmode="decimal" value="${esc(f.emptyMoment)}"></label></div>
      <div class="row"><span class="grow label">Not in the fleet overview: copy the empty mass and moment from this aircraft's latest weight &amp; balance report.</span></div>`;
  }
  html += '<div class="row wrap">';
  for (const st of ac.stations) {
    const ph = st.id === 'pilot' ? 'real mass' : st.id === 'copilot' ? '0 if solo' : '0';
    const hint = [U === 'lb' && +f[st.id] ? `${(+f[st.id] * KG_TO_LB).toFixed(1)} lb` : '', st.max ? `max ${st.max} ${U}` : ''].filter(Boolean).join(' · ');
    const fromSettings = st.id === 'pilot' && (f.pilot === '' || f.pilot == null) && state.settings.myMass;
    const ins = st.id === 'copilot' && (state.settings.instructors || []).filter((x) => x.name && +x.mass > 0);
    const pick = ins && ins.length ? `<select data-ins-pick class="ins-pick"><option value="">Instructor…</option>${ins.map((x) => `<option value="${esc(x.name)}" ${f.instructor === x.name && +f.copilot === +x.mass ? 'selected' : ''}>${esc(x.name)} · ${x.mass} kg</option>`).join('')}</select>` : '';
    html += `<label class="field"><span>${esc(st.label)} (kg)</span><input data-ff="${st.id}" inputmode="decimal" value="${esc(stationMass(f, st.id) ?? '')}" placeholder="${ph}">${fromSettings ? '<small class="label">from Settings</small>' : hint ? `<small class="label">${hint}</small>` : ''}${pick}</label>`;
  }
  html += `</div><div class="row wrap">
    <label class="field"><span>Fuel on board (L)</span><input data-ff="fob" inputmode="decimal" value="${esc(f.fob)}"><small class="label">max usable ${ac.fuelMaxL} L</small></label>
    <label class="field"><span>Trip fuel (L)</span>${t.useRoute ? `<b>${t.trip.toFixed(1)}</b>` : `<input data-mb="tripManual" inputmode="decimal" value="${esc(mbs.tripManual)}" placeholder="0">`}</label>
  </div>
  <div class="toggle-row"><span>Take trip fuel from the planned route${result.main.rows.length ? '' : ' <small class="label">(no route yet)</small>'}</span>
    <label class="switch"><input type="checkbox" data-mbflag="tripSource" ${mbs.tripSource === 'route' ? 'checked' : ''}><span></span></label></div>
  </div>`;
  if (m) {
    const ok = (b) => (b ? 'ok' : 'bad');
    const tr = (label, mass, arm, moment, cls = '') => `<tr class="bot ${cls}"><td class="wpt">${label}</td><td>${n(mass)}</td><td>${arm == null ? '' : n(arm, ac.armDp)}</td><td>${fmtMoment(m, moment)}</td></tr>`;
    html += `<div class="group-title"><span>Sheet · ${esc(ac.sheet)}</span></div>
    <div class="nl-wrap"><table class="nl mbt"><thead><tr><th></th><th>Mass (${U})</th><th>Arm (${A})</th><th>Moment (${mom})</th></tr></thead><tbody>`;
    for (const r of m.rows) {
      if (r.id === 'fuel') {
        if (ac.mzfw) html += tr(`Zero-fuel <small class="label">max ${ac.mzfw}</small>`, m.zfw.mass, m.zfw.moment / m.zfw.mass, m.zfw.moment, `total ${ok(m.zfw.mass <= ac.mzfw)}`);
        html += tr(`Fuel <small class="label">${r.litres} L</small>`, r.mass, r.arm, r.moment);
        if (m.ramp) html += tr(`Ramp <small class="label">max ${ac.ramp}</small>`, m.ramp.mass, m.ramp.arm, m.ramp.moment, `total ${ok(m.ramp.mass <= ac.ramp)}`);
        continue;
      }
      html += tr(esc(r.label), r.mass, r.arm, r.moment);
    }
    html += tr(`Takeoff <small class="label">max ${m.mtow}</small>`, m.to.mass, m.to.arm, m.to.moment, `total ${ok(m.to.massOk && m.to.cgOk)}`);
    html += tr(`Trip fuel <small class="label">${t.trip.toFixed(1)} L</small>`, -m.trip.mass, ac.fuelArm, -m.trip.mass * ac.fuelArm);
    html += tr('Landing', m.ldg.mass, m.ldg.arm, m.ldg.moment, `total ${ok(m.ldg.massOk && m.ldg.cgOk)}`);
    html += '</tbody></table></div>';
    const lim = (mass) => { const l = cgLimitsAt(ac.envelope, Math.min(mass, m.mtow)); return l ? `${n(l[0], ac.armDp)} – ${n(l[1], ac.armDp)} ${A}` : ''; };
    const pct = (arm) => (ac.mac ? ` (${m.pct(arm).toFixed(1)} % MAC)` : '');
    html += `<div class="group">
      ${row(`Takeoff mass ≤ ${m.mtow} ${U}`, `${n(m.to.mass)} ${U}`, m.to.massOk ? 'check-ok' : 'check-bad')}
      ${row(`Takeoff C.G. ${lim(m.to.mass)}`, `${n(m.to.arm, ac.armDp)} ${A}${pct(m.to.arm)}`, m.to.cgOk ? 'check-ok' : 'check-bad')}
      ${row(`Landing C.G. ${lim(m.ldg.mass)}`, `${n(m.ldg.arm, ac.armDp)} ${A}${pct(m.ldg.arm)}`, m.ldg.cgOk ? 'check-ok' : 'check-bad')}
      ${m.issues.map((i) => row(esc(i), '✕', 'check-bad')).join('')}
    </div>`;
  } else {
    html += '<div class="group"><div class="empty">Enter the empty mass and moment to calculate.</div></div>';
  }
  html += perfHtml();
  html += `<div class="group">
      <div class="row"><span class="grow label">Fuel on board: use the real quantity checked with FISUP/Dispatcher, not an estimate (SOP).</span></div>
      <div class="row"><span class="grow label">Masses: use the real masses of the student, instructor and passengers (SOP).</span></div>
    </div>
  <div class="group-title"><span>Printed on the sheet</span></div>
  <div class="group"><div class="row wrap">
    <label class="field full"><span>Weather</span><input data-ff="weather" value="${esc(effWeather(f.weather))}" placeholder="METAR / TAF summary"></label>
    <label class="field full"><span>NOTAMs</span><input data-mb="notams" value="${esc(effNotams(mbs.notams))}" placeholder="Relevant NOTAMs"></label>
  </div></div>
  <button class="btn primary wide" data-act="mbpdf">Download M&amp;B sheet (PDF)</button>
  <p class="note">Arms, limits and envelope from the ${esc(ac.sheet)} (fleet M&amp;B overview, 19/07/2025). Fuel ${ac.unit === 'lb' ? '6 lb/US gal' : '0.72 kg/L'}. Masses are entered in kg${ac.unit === 'lb' ? ' and converted to lb (× 2.20462)' : ''}.</p>`;
  html += `<button class="btn primary wide next-step" data-goto="brief" style="--c: var(--c-brief)">Next · 4 Briefing →</button>`;
  panels.mb.innerHTML = html;
}
panels.mb.addEventListener('change', (e) => {
  const t = e.target;
  if (t.hasAttribute('data-ins-pick')) {
    const x = (state.settings.instructors || []).find((i) => i.name === t.value);
    if (x) { state.flight.copilot = +x.mass; state.flight.instructor = x.name; } else state.flight.instructor = '';
    return update({ rerenderPanels: true });
  }
  if (t.dataset.ff) {
    const k = t.dataset.ff;
    if (k === 'type') { state.flight.type = t.value; state.flight.reg = Object.keys(acOf(t.value).regs)[0] || ''; state.flight.fob = Math.min(+state.flight.fob || 0, acOf(t.value).fuelMaxL) || acOf(t.value).fuelMaxL; }
    else state.flight[k] = k === 'reg' || k === 'weather' ? (k === 'reg' ? t.value.toUpperCase().trim() : t.value) : numMin0(t.value);
  } else if (t.dataset.mb) {
    const mk = t.dataset.mb;
    state.mb[mk] = mk === 'studentCode' ? t.value.toUpperCase().trim() : /Manual$/.test(mk) ? num(t.value) : t.value;
  } else if (t.dataset.mbflag) {
    state.mb.tripSource = t.checked ? 'route' : 'manual';
  } else if (t.dataset.pc) {
    const [role, k] = t.dataset.pc.split('.');
    state.perfCond = state.perfCond || {};
    state.perfCond[role] = { ...(state.perfCond[role] || {}), [k]: k === 'surface' ? t.value : num(t.value) };
  } else return;
  update({ rerenderPanels: true });
});
panels.mb.addEventListener('click', (e) => { if (e.target.closest('[data-act=mbpdf]')) downloadMbPdf(); });

async function downloadMbPdf() {
  const m = result.mb, f = state.flight;
  if (!m) return toast('Choose a registration (or enter the empty mass) first.');
  try {
    const bytes = await buildMbPdf(m, {
      date: flightTime().toLocaleDateString('en-GB'), reg: f.reg, studentCode: state.mb.studentCode, signature: state.settings.signature,
      weather: effWeather(f.weather), notams: effNotams(state.mb.notams), perf: perfResults(),
    }, planData());
    saveBlob(bytes, `MB_${f.reg || f.type}_${flightTime().toISOString().slice(0, 10)}.pdf`);
    toast('M&B sheet ready');
  } catch (err) { console.error(err); toast('Could not build the PDF: ' + err.message); }
}

function renderMbSummary() {
  const m = result.mb;
  const set = (id, v, ok) => { const el = document.getElementById(id); el.textContent = v; el.className = 'v ' + (ok == null ? '' : ok ? 'ok' : 'bad'); };
  if (!m) { set('mTom', '—'); set('mCg', '—'); set('mLm', '—'); return; }
  const ac = m.ac;
  set('mTom', `${m.to.mass.toFixed(1)} ${ac.unit}`, m.to.massOk);
  set('mCg', `${m.to.arm.toFixed(ac.armDp)} ${ac.armUnit}`, m.to.cgOk);
  set('mLm', `${m.ldg.mass.toFixed(1)} ${ac.unit}`, m.ldg.massOk && m.ldg.cgOk);
}
document.getElementById('btnMbPdf').addEventListener('click', downloadMbPdf);

function renderPanels() {
  renderSheetView();
  { const sh = document.getElementById('sheet'); sh.dataset.tab = tab; sh.dataset.route = state.active; }
  document.querySelectorAll('#routeSel button').forEach((b) => b.classList.toggle('on', b.dataset.route === state.active));
  document.getElementById('routeSel').hidden = tab === 'fuel';
  if (state.mode === 'mb') return renderMB();
  if (state.mode === 'mission') return renderMission();
  if (state.mode === 'brief') return renderBriefing();
  if (state.mode === 'settings') return renderSettings();
  if (tab === 'route') renderRoute();
  if (tab === 'navlog') renderNavlog();
  if (tab === 'fuel') renderFuel();
  if (tab === 'profile') renderProfile();
}

function renderSummary() {
  const nl = result[state.active];
  document.getElementById('sDist').textContent = `${nl.totals.dist} NM`;
  document.getElementById('sTime').textContent = fmtHMS(nl.totals.timeSec);
  document.getElementById('sTrip').textContent = `${nl.totals.trip.toFixed(1)} L`;
  const req = document.getElementById('sReq');
  req.textContent = `${result.fuel.required} L`;
  req.className = 'v ' + (result.fuel.checks.every((c) => c.ok) ? 'ok' : 'bad');
  const chip = document.getElementById('modeChip');
  chip.classList.toggle('alt', state.active === 'alt');
  document.getElementById('modeText').textContent = state.active === 'alt' ? 'Alternate — tap the chart to add points' : 'Tap the chart to add waypoints';
  const dep = endpoint('main', 0), dest = endpoint('main', -1);
  document.getElementById('brandSub').textContent = [dep?.icao, dest?.icao].filter(Boolean).join(' → ') || 'LEBG';
}

/* ---------------- Go / no-go checks and briefing ---------------- */

function times() {
  const to = flightTime();
  const ldg = new Date(to.getTime() + result.main.totals.timeSec * 1000);
  const altArr = new Date(ldg.getTime() + result.alt.totals.timeSec * 1000);
  return { to, ldg, altArr };
}

function routeLegs(key) {
  const wps = state[key].waypoints;
  const legs = [];
  for (let i = 1; i < wps.length; i++) legs.push({ a: wps[i - 1], b: wps[i], alt: parseAlt(wps[i].alt), dist: distanceNm(wps[i - 1], wps[i]), name: `${wps[i - 1].name} → ${wps[i].name}` });
  return legs;
}

/** Everything that can be checked without the network. */
function planIssues() {
  const issues = [];
  const f = state.flight;
  const { to, ldg, altArr } = times();
  const dep = endpoint('main', 0), dest = endpoint('main', -1), alt = endpoint('alt', -1);
  if (!result.main.rows.length) return issues;
  // approved aerodromes / IFR only / unlocked
  for (const [ad, role] of [[dest, 'Destination'], [alt, 'Alternate']]) {
    if (!ad) continue;
    if (IFR_ONLY.includes(ad.icao)) issues.push({ level: 'bad', text: `${role} ${ad.icao} is IFR only for school flights` });
    else if (!APPROVED.includes(ad.icao)) issues.push({ level: 'warn', text: `${role} ${ad.icao} is not on the school's VFR aerodrome list` });
    if (f.solo && !state.unlocked.includes(ad.icao)) issues.push({ level: 'bad', text: `Solo: ${role.toLowerCase()} ${ad.icao} is not one of your unlocked aerodromes` });
  }
  if (!alt) issues.push({ level: 'warn', text: 'No alternate planned — each leg needs an alternate (school policy)' });
  for (const k of ['main', 'alt']) {
    const w = state[k].waypoints;
    for (let i = 1; i < w.length; i++) {
      const d = nmDist(w[i - 1], w[i]);
      if (d <= MAX_LEG_NM + 0.05) continue;
      const adOf = (x) => (x.ref && (POINTS.find((q) => q.key === x.ref) || {}).ad) || null;
      const published = (w[i].proc || w[i - 1].proc) && adOf(w[i]) && adOf(w[i]) === adOf(w[i - 1]);
      issues.push({ ...(published
        ? { level: 'info', text: `${w[i - 1].name} → ${w[i].name} is ${d.toFixed(1)} NM, longer than the school's ${MAX_LEG_NM} NM, but it is part of the published ${adOf(w[i])} procedure` }
        : { level: 'warn', text: `${k === 'alt' ? 'Alternate leg' : 'Leg'} ${w[i - 1].name} → ${w[i].name} is ${d.toFixed(1)} NM — school limit ${MAX_LEG_NM} NM per leg: add a turning point` }), go: { route: k, wid: w[i].id } });
    }
  }
  if (f.levelMode === 'alt') {
    const ta = dep?.ta || 6000;
    const hi = Math.max(0, ...['main', 'alt'].flatMap((k) => result[k].rows.map((r) => +r.alt || 0)));
    if (hi > ta) issues.push({ level: 'info', text: `Altitudes chosen instead of flight levels: ${hi} ft is above the transition altitude (${ta} ft), where levels are normally flown on 1013 — confirm with your instructor` });
  }
  // aerodrome hours
  for (const [ad, t, role] of [[dep, to, 'departure'], [dest, ldg, 'arrival'], [alt, altArr, 'alternate arrival']]) {
    if (!ad) continue;
    const h = aerodromeOpen(ad.icao, t);
    if (h.known && !h.open) issues.push({ level: 'bad', text: `${ad.icao} closed at your ${role} time (${hhmmZ(t)}) — ${h.text}` });
    else if (!h.known && role !== 'departure') issues.push({ level: 'info', text: `${ad.icao}: ${h.text}` });
  }
  // daylight / night
  const sun = sunTimes(to, (dep || LEBG).lat, (dep || LEBG).lon);
  if (sun.rise && to < sun.rise) issues.push({ level: 'warn', text: `Takeoff ${hhmmZ(to)} is before sunrise (${hhmmZ(sun.rise)})` });
  if (sun.set && ldg > sun.set) issues.push({ level: 'warn', text: `Landing ${hhmmZ(ldg)} is after sunset (${hhmmZ(sun.set)}) — night VFR: two alternates, alternates' closing times, NIGHT VFR FLIGHT in FPL item 18` });
  // fuel
  result.fuel.checks.forEach((c) => { if (!c.ok) issues.push({ level: 'bad', text: c.text + ' — not met' }); });
  if (f.taxi === '') issues.push({ level: 'info', text: 'Taxi fuel not entered (Fuel tab)' });
  if (dep && dest && dep.icao !== dest.icao && (+f.fob || 0) < acOf(f.type).fuelMaxL) issues.push({ level: 'warn', text: 'Cross-country: tanks should be full before the flight (within M&B limits)' });
  if (result.mb && !result.mb.ok) issues.push({ level: 'bad', text: `Mass & balance: ${result.mb.issues.join('; ')}` });
  // solo + aerodrome specifics
  const solo = soloEntryIssue(); if (solo) issues.push({ level: 'bad', text: solo });
  if (dest && FULL_STOP.includes(dest.icao)) issues.push({ level: 'info', text: `${dest.icao} requires a full-stop landing` });
  // AIP AD 2 notes (fuel, local regulations, school-flight restrictions)
  const seen = new Set();
  for (const [ad, role, t] of [[dep, 'dep', to], [dest, 'arr', ldg], [alt, 'alt', altArr]]) {
    if (!ad) continue;
    for (const n of aipNotes(ad.icao, role, t)) if (!seen.has(n.text)) { seen.add(n.text); issues.push(n); }
  }
  // cruising levels
  issues.push(...seraIssues('main'));
  // minimum altitude per leg (obstacles + terrain)
  for (const key of ['main', 'alt']) {
    const wps = state[key].waypoints;
    for (let i = 1; i < wps.length; i++) {
      const w = wps[i], alt = parseAlt(w.alt);
      if (alt == null || /^FL/i.test(String(w.alt))) continue;
      const lm = legMinimum(key, i);
      const procLeg = isProcPoint(wps, i); // VAC / SOP altitude: flown as published, the check is only a note
      if (lm && alt < lm.need) issues.push({ go: { route: key, wid: w.id }, level: procLeg ? 'info' : 'warn', text: `${key === 'alt' ? 'Alternate ' : ''}${wps[i - 1].name} → ${w.name}: ${alt} ft is below ${procLeg ? '1000 ft above the highest obstacle' : `the minimum ${lm.need} ft`} — ${lm.why}${procLeg ? ' (published VAC/SOP altitude — keep the obstacle in sight)' : `; SOP 1000 ft above the highest obstacle${lm.mountain ? ' (2000 ft over mountains)' : ''}`}` });
    }
  }
  // airspace along the route
  for (const key of ['main', 'alt']) {
    const ends = [endpoint(key, 0), endpoint(key, -1)].filter(Boolean);
    const legs = routeLegs(key);
    airspaceCrossings(legs, AIRSPACES)
      .filter((c) => !(['FIZ', 'CTR', 'ATZ', 'RMZ', 'TMZ'].includes(c.sp.type) && ends.some((ad) => c.leg.includes(ad.icao))))
      .forEach((c) => issues.push({ ...crossingIssue(c), go: { route: key, wid: legs.find((l) => l.name === c.leg)?.b.id } }));
  }
  return dedupe(issues);
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((i) => (seen.has(i.text) ? false : seen.add(i.text)));
}
const hhmmZ = zl;

async function loadWeather(force = false) {
  const ads = [endpoint('main', 0), endpoint('main', -1), endpoint('alt', -1)].filter(Boolean).map((a) => a.icao);
  const key = ads.join(',');
  if (!key || (!force && wxState.key === key && (wxState.data || wxState.loading || wxState.err))) return;
  wxState = { key, data: null, err: null, loading: true };
  if (state.mode === 'brief') renderBriefing();
  try { wxState.data = await fetchWeather(ads); } catch (e) { wxState.err = e.message; }
  wxState.loading = false;
  if (state.mode === 'brief') renderBriefing();
  // refresh the performance figures, but never re-render under the student's typing
  if (state.mode === 'mb' && !panels.mb.contains(document.activeElement)) renderMB();
}

function weatherIssues() {
  if (!wxState.data) return [];
  const f = state.flight;
  const ft = fleetType(f.type);
  const xwLimit = ft.xwind ? (f.solo ? ft.xwind.solo ?? ft.xwind.fi : ft.xwind.fi) : null;
  const { to, ldg, altArr } = times();
  const out = [];
  const list = [[endpoint('main', 0), to], [endpoint('main', -1), ldg], [endpoint('alt', -1), altArr]];
  for (const [ad, t] of list) {
    if (!ad) continue;
    out.push(...assess(ad.icao, wxState.data[ad.icao], t, t, { solo: f.solo, xwLimit, hwLimit: ft.headwind ? (f.solo ? ft.headwind.solo : ft.headwind.fi) : null }).issues);
  }
  return out;
}

function copyBtn(id) { return `<div class="copy-row"><button class="btn small" data-copy="${id}">Copy</button></div>`; }

/* ---------------- AEMET SIGWX and wind charts (ama.aemet.es, as linked by the school sites) ----------------
 * Static images, loaded by the student's own browser (AEMET's server only answers from Spain).
 *  SIGWX Spain low level: bbdd/imagenes/QGQE70LEMM{HHMM}________{YYYYMMDD}.png — issued 12 h before the
 *    time it is valid for (00/06/12/18 UTC).
 *  Wind/temperature: productos/atap/{run date}/HMAR/{00|12}/P3/{step}/VTPLOT_FL{020|050|100}__.1.png.
 */
const AMA = 'ama.aemet.es/o/estaticos';
const ymd = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
const hh = (d) => String(d.getUTCHours()).padStart(2, '0');
function aemetCharts(t, altFt) {
  const six = 6 * 3600e3;
  const valid = new Date(Math.round(t.getTime() / six) * six);
  const issue = new Date(valid.getTime() - 12 * 3600e3);
  const sigwx = { label: `SIGWX low level · valid ${hh(valid)}Z ${valid.getUTCDate()}/${valid.getUTCMonth() + 1}`, urls: [`${AMA}/bbdd/imagenes/QGQE70LEMM${hh(issue)}00________${ymd(issue)}.png`] };
  const fl = altFt >= 7500 ? '100' : altFt >= 3500 ? '050' : '020';
  // newest run first (00/12 UTC), forecast step to the nearest 6 h
  const urls = [];
  const day = 864e5, now = Date.now();
  for (let k = 0; k < 4; k++) {
    const runT = Math.floor(now / (day / 2)) * (day / 2) - k * (day / 2);
    if (runT > valid.getTime()) continue;
    const run = new Date(runT), step = Math.round((valid.getTime() - runT) / 3600e3);
    if (step > 48) continue;
    urls.push(`${AMA}/productos/atap/${ymd(run)}/HMAR/${hh(run)}/P3/${String(step).padStart(3, '0')}/VTPLOT_FL${fl}__.1.png`);
  }
  const wind = { label: `Wind & temperature FL${fl} · valid ${hh(valid)}Z ${valid.getUTCDate()}/${valid.getUTCMonth() + 1}`, urls };
  return { sigwx, wind };
}
const chartImg = (c) => c.urls.length ? `<figure class="wxchart"><img alt="${esc(c.label)}" loading="lazy" data-urls="${esc(JSON.stringify(c.urls))}" data-i="0" src="https://${c.urls[0]}" onload="navlogChartLoaded(this)" onerror="this.dataset.i=+this.dataset.i+1; const u=JSON.parse(this.dataset.urls); const i=+this.dataset.i; if (i < u.length * 2) this.src=(i % 2 ? 'http://' : 'https://') + u[Math.floor(i / 2)]; else this.closest('figure').classList.add('failed');"><figcaption>${esc(c.label)} · AEMET <a href="https://${c.urls[0]}" target="_blank" rel="noopener">open ↗</a></figcaption></figure>` : '';
// AEMET lets the browser show its chart images but may not let the app read them (no CORS header):
// then they cannot go into the PDF, and the student is told how to add the chart by hand.
const chartBytes = new Map();
window.navlogChartLoaded = async (img) => {
  const fig = img.closest('figure'); if (!fig || fig.dataset.checked) return;
  fig.dataset.checked = '1';
  try {
    const r = await fetch(img.src, { mode: 'cors' });
    if (!r.ok) throw new Error(String(r.status));
    chartBytes.set(img.src.replace(/^https?:\/\//, ''), new Uint8Array(await r.arrayBuffer()));
    fig.insertAdjacentHTML('beforeend', '<div class="chart-pdf ok">✓ Goes into the briefing PDF</div>');
  } catch {
    const kind = fig.closest('[data-wxkind]')?.dataset.wxkind;
    fig.insertAdjacentHTML('beforeend', `<div class="chart-pdf no"><b>Shown here, but AEMET does not let the app copy it into the PDF.</b> Tap and hold the chart → <b>Save to Photos</b>, then <b>Add ${kind === 'wind' ? 'Wind chart' : 'SIGWX'}</b> below and pick it from Photos.</div>`);
  }
};
async function fetchChartBytes(c) {
  for (const u of c.urls) if (chartBytes.has(u)) return chartBytes.get(u);
  for (const u of c.urls) for (const proto of ['https://', 'http://']) {
    try { const r = await fetch(proto + u, { mode: 'cors' }); if (r.ok) return new Uint8Array(await r.arrayBuffer()); } catch { /* blocked or missing */ }
  }
  return null;
}

/* Surface pressure chart (Briefing List 1A): AEMET OpenData analysis map, with the app's built-in
 * key (js/aemet-key.js, valid 3 months). Without a valid key: link to AEMET's surface charts page. */
try { localStorage.removeItem('navlog.aemetKey.v1'); } catch { /* old pasted key no longer used */ }
const aemetExpired = () => Date.now() > Date.parse(`${AEMET_KEY_EXPIRES}T23:59:59Z`);
const AEMET_FRONTS = 'https://www.aemet.es/en/eltiempo/prediccion/mapa_frentes';
let surface = null; // { at, url (object URL), png (bytes), label } | { at, error }
const aemetKey = () => (AEMET_API_KEY && !aemetExpired() ? AEMET_API_KEY : '');
async function loadSurface(force) {
  const key = aemetKey();
  if (!key) return null;
  if (!force && surface && Date.now() - surface.at < 30 * 60e3) return surface;
  try {
    const meta = await (await fetch(`https://opendata.aemet.es/opendata/api/mapasygraficos/analisis?api_key=${encodeURIComponent(key)}`)).json();
    if (!meta || !meta.datos) throw new Error(meta && meta.descripcion ? meta.descripcion : 'no data');
    const blob = await (await fetch(meta.datos)).blob();
    const bmp = await createImageBitmap(blob); // the map is a GIF: redraw it as PNG for the PDF
    // AEMET publishes the analysis lying on its side (portrait image, north to the right): turn it 90° clockwise
    const turn = bmp.height > bmp.width;
    const c = document.createElement('canvas'); c.width = turn ? bmp.height : bmp.width; c.height = turn ? bmp.width : bmp.height;
    const cg = c.getContext('2d');
    if (turn) { cg.translate(c.width, 0); cg.rotate(Math.PI / 2); }
    cg.drawImage(bmp, 0, 0);
    const png = await new Promise((res) => c.toBlob(res, 'image/png'));
    if (surface && surface.url) URL.revokeObjectURL(surface.url);
    surface = { at: Date.now(), url: URL.createObjectURL(png), png: new Uint8Array(await png.arrayBuffer()), label: `Surface pressure analysis · AEMET (fetched ${hhmmZ(new Date())})` };
  } catch (err) {
    surface = { at: Date.now(), error: String(err.message || err) };
  }
  return surface;
}
function surfaceHtml() {
  const key = aemetKey();
  const link = `<a href="${AEMET_FRONTS}" target="_blank" rel="noopener">AEMET surface pressure charts ↗</a>`;
  if (!key) return `<div class="label">${link} (analysis + forecasts)${aemetExpired() ? ' · the app\'s AEMET key has expired and needs renewing' : ''}.</div>`;
  if (!surface) { loadSurface().then(() => { const el = document.getElementById('surfaceBox'); if (el) el.innerHTML = surfaceHtml(); }); return `<div class="label">Loading… · ${link}</div>`; }
  if (surface.error) return `<div class="label">Could not load the AEMET analysis (${esc(surface.error)}) · ${link}</div>`;
  return `<figure class="wxchart"><img alt="Surface pressure analysis" src="${surface.url}"><figcaption>${esc(surface.label)} · ${link}</figcaption></figure>`;
}

/* ---------------- SIGWX / wind chart added by the student (Briefing List 1B, 1C) ----------------
 * AEMET's aviation site (ama.aemet.es) cannot always be read by the app, so the student can save the
 * chart (screenshot, image or PDF) and add it here. Kept on this device as a JPEG; goes into the
 * briefing PDF in place of the automatic chart. */
const WXUP_KEY = 'navlog.wxUploads.v1';
let wxUploads = (() => { try { return JSON.parse(localStorage.getItem(WXUP_KEY)) || {}; } catch { return {}; } })();
const WXUP_NAME = { sigwx: 'SIGWX', wind: 'Wind chart' };
async function addWxUpload(kind, file) {
  try {
    let src;
    if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) src = await pdfFirstPageCanvas(new Uint8Array(await file.arrayBuffer()));
    else src = await createImageBitmap(file);
    const k = Math.min(1, 2400 / Math.max(src.width, src.height));
    const c = document.createElement('canvas'); c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height);
    const jpg = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
    wxUploads[kind] = { name: file.name, added: Date.now(), b64: bytesToB64(new Uint8Array(await jpg.arrayBuffer())) };
    try { localStorage.setItem(WXUP_KEY, JSON.stringify(wxUploads)); } catch { toast(`${WXUP_NAME[kind]} added, but too big to keep after closing the app`); }
    toast(`${WXUP_NAME[kind]} added`);
    update({ rerenderPanels: true });
  } catch (err) { console.error(err); toast(`Could not read that file: ${err.message || err}`); }
}
function removeWxUpload(kind) {
  delete wxUploads[kind];
  try { localStorage.setItem(WXUP_KEY, JSON.stringify(wxUploads)); } catch { /* ignore */ }
  update({ rerenderPanels: true });
}
function wxUploadHtml(kind, auto) {
  const u = wxUploads[kind];
  const age = u ? Math.round((flightTime().getTime() - u.added) / 3600e3) : 0;
  const pick = (label, primary) => `<label class="btn small ${primary ? 'primary' : ''}">${label}<input type="file" accept="image/*,application/pdf,.pdf" data-act="wxUp" data-kind="${kind}" hidden></label>`;
  if (u) {
    return `<figure class="wxchart"><img alt="${WXUP_NAME[kind]}" src="data:image/jpeg;base64,${u.b64}"><figcaption>${WXUP_NAME[kind]} · added ${zl(new Date(u.added))}${age > 12 ? ` · <b class="warn-text">added ${age} h before departure — check its validity</b>` : ''}</figcaption>
      <div class="row" style="gap:6px;margin-top:4px">${pick('Replace')}<button class="btn small danger" data-act="wxUpRemove" data-kind="${kind}">Remove</button></div></figure>`;
  }
  return `<div data-wxkind="${kind}">${chartImg(auto)}<div class="row" style="gap:6px;margin-top:4px">${pick(`Add ${WXUP_NAME[kind]}`, true)}<span class="label">image, screenshot or PDF</span></div></div>`;
}

/* ---------------- ICARO NOTAM bulletin (saved PDF, added by the student) ---------------- */
const BULLETIN_KEY = 'navlog.bulletin.v1';
let bulletin = (() => { try { return JSON.parse(localStorage.getItem(BULLETIN_KEY)); } catch { return null; } })();
const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
function bytesToB64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }
async function addBulletin(file) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parseBulletin(await pdfLines(bytes));
    if (!parsed.id && !Object.keys(parsed.ads).length) return toast('That PDF does not look like an ICARO bulletin');
    bulletin = { name: file.name, added: Date.now(), b64: bytesToB64(bytes), parsed };
    try { localStorage.setItem(BULLETIN_KEY, JSON.stringify(bulletin)); } catch { toast('Bulletin read, but too big to keep after closing the app'); }
    // school practice: the bulletin identifier goes in the NOTAM box, and as the MET source when it includes METAR/TAF
    const id = parsed.id ? `ICARO ${parsed.id}` : 'ICARO bulletin';
    state.mb.notams = id;
    if (!state.flight.weather || /^ICARO/i.test(state.flight.weather)) state.flight.weather = id;
    toast(`Bulletin ${parsed.id || ''} added`);
    update({ rerenderPanels: true });
  } catch (err) { console.error(err); toast('Could not read the bulletin: ' + err.message); }
}
// The bulletin identifier goes on the navlog (weather box) and the M&B sheet (weather + NOTAM boxes),
// unless the student has typed something of their own there.
const bulId = () => (bulletin ? (bulletin.parsed && bulletin.parsed.id ? `ICARO ${bulletin.parsed.id}` : 'ICARO bulletin') : '');
const effWeather = (w) => (!w || /^ICARO/i.test(w) ? bulId() || w || '' : w);
const effNotams = (n) => (!n || /^ICARO/i.test(n) ? bulId() || n || '' : n);
function removeBulletin() { bulletin = null; try { localStorage.removeItem(BULLETIN_KEY); } catch { /* ignore */ } update({ rerenderPanels: true }); }
/** NOTAM flags for the flight currently loaded in the planner. */
function bulletinFlags() {
  if (!bulletin) return [];
  const { to, ldg, altArr } = times();
  const ads = [[endpoint('main', 0), to], [endpoint('main', -1), ldg], [endpoint('alt', -1), altArr]].filter(([a]) => a).map(([a, t]) => ({ icao: a.icao, t }));
  const legs = [...routeLegs('main'), ...routeLegs('alt')].map((l) => [l.a, l.b]);
  const crossings = airspaceCrossings(routeLegs('main'), AIRSPACES).map((c) => ({ code: c.sp.id, label: `${c.sp.type}${c.sp.id || ''} ${c.sp.name || ''}` }));
  const sun = (icao, t) => { const a = adByIcao(icao); return a ? sunTimes(t, a.lat, a.lon) : null; };
  const flags = notamFlags(bulletin.parsed, { ads, legs, crossings, sun });
  for (const a of ads) if (!bulletin.parsed.ads[a.icao]) flags.unshift({ level: 'warn', text: `${a.icao} is not in the ICARO bulletin ${bulletin.parsed.id || ''} — request a new bulletin with it` });
  const issued = bulletin.parsed.issued;
  if (issued && to.getTime() - issued > 6 * 3600e3) flags.unshift({ level: 'warn', text: `ICARO bulletin issued ${Math.round((to.getTime() - issued) / 3600e3)} h before departure — get a fresh one` });
  return flags;
}

// Everything on the briefing list (SOP briefing order), for the Briefing tab and the briefing PDF.
function briefingData() {
  const f = state.flight;
  const dep = endpoint('main', 0), dest = endpoint('main', -1), alt = endpoint('alt', -1);
  const { to, ldg, altArr } = times();
  const ft = fleetType(f.type);
  const nflags = bulletinFlags();
  const issues = dedupe([...weatherIssues(), ...planIssues(), ...nflags.filter((x) => x.level !== 'info').map((x) => ({ level: x.level, text: `NOTAM ${x.text}` }))]);
  const order = { bad: 0, warn: 1, info: 2 };
  issues.sort((x, y) => order[x.level] - order[y.level]);
  // 1. weather per aerodrome
  const wx = [], shown = new Set();
  for (const [ad, t, role] of [[dep, to, dep && dest && dep.icao === dest.icao ? 'Departure & return' : 'Departure'], [dest, ldg, 'Destination'], [alt, altArr, 'Alternate']]) {
    if (!ad || shown.has(ad.icao)) continue;
    shown.add(ad.icao);
    const w = (wxState.data && wxState.data[ad.icao]) || {};
    const a = assess(ad.icao, w, t, t, { solo: f.solo, xwLimit: ft.xwind ? (f.solo ? ft.xwind.solo ?? ft.xwind.fi : ft.xwind.fi) : null, hwLimit: ft.headwind ? (f.solo ? ft.headwind.solo : ft.headwind.fi) : null });
    const st = a.issues.some((i) => i.level === 'bad') ? ['bad', 'BELOW MINIMA'] : a.issues.some((i) => i.level === 'warn') ? ['warn', 'CHECK'] : (w.metar || w.taf) ? ['ok', 'OK'] : ['muted', 'NO DATA'];
    wx.push({ ad, t, role, w, a, st });
  }
  const limits = `Limits ${f.solo ? 'solo: visibility 7000 m, ceiling 2500 ft' : 'with FI: visibility 5000 m, ceiling 1500 ft'} BKN/OVC, ±1 h of your time there; crosswind ${ft.xwind ? `${f.solo ? ft.xwind.solo ?? ft.xwind.fi : ft.xwind.fi} kt` : 'per aircraft SOP'}${ft.headwind ? `, headwind ${f.solo ? ft.headwind.solo : ft.headwind.fi} kt` : ''}${ft.gustNote ? ` (${ft.gustNote})` : ''}.`;
  // 2. NOTAMs
  const notamAds = [dep, dest, alt].filter(Boolean).map((x) => x.icao).filter((x, i, arr) => arr.indexOf(x) === i);
  // 3. ATC flight plan
  const tas = result.main.rows.find((r) => r.phase === 'cruise')?.tas || 100;
  const night = (() => { const s2 = sunTimes(to, (dep || LEBG).lat, (dep || LEBG).lon); return s2.set && ldg > s2.set; })();
  const endMin = Math.floor(((+f.fob || 0) / planSop().ffCruise) * 60);
  const fpl = dep && dest ? buildFpl({
    callsign: f.callsign, reg: f.reg, acType: ft.icao, dep: dep.icao, dest: dest.icao,
    alts: [alt?.icao].filter(Boolean), eobt: new Date(to.getTime() - 10 * 60e3), tas,
    wps: state.main.waypoints.map((w) => ({ ...w, fplName: w.ref && POINTS.find((p) => p.key === w.ref)?.type === 'ad' ? w.ref : null })),
    eetMin: Math.round(result.main.totals.timeSec / 60), night,
    dof: `${String(to.getUTCFullYear()).slice(2)}${String(to.getUTCMonth() + 1).padStart(2, '0')}${String(to.getUTCDate()).padStart(2, '0')}`,
    endurance: `${String(Math.floor(endMin / 60)).padStart(2, '0')}${String(endMin % 60).padStart(2, '0')}`, pob: f.pob,
  }) : '';
  // 4. mission objective
  const wps = state.main.waypoints;
  const depPts = wps.filter((w) => w.proc === 'dep');
  const exitW = depPts[depPts.length - 1];
  const firstEnroute = result.main.rows.find((r) => r.phase === 'cruise' || r.phase === 'climb');
  const arrPts = wps.filter((w) => w.proc === 'arr');
  const entryIdx = wps.findIndex((w) => w.proc === 'arr') - 1;
  const entryW = entryIdx >= 0 ? wps[entryIdx] : wps[wps.length - 2];
  const depText = departureBriefing({ dep: dep?.icao, exitPoint: exitW?.name, procAlt: parseAlt(exitW?.alt), cruiseAlt: parseAlt(firstEnroute?.alt), firstMh: firstEnroute?.mh, next: firstEnroute?.to, procRoute: depPts.map((w) => w.name) });
  const arrText = arrivalBriefing({ dest: dest?.icao, entryPoint: entryW?.name, procAlt: parseAlt(arrPts[0]?.alt ?? entryW?.alt), procRoute: [entryW?.name, ...arrPts.map((w) => w.name)].filter(Boolean), pattern: dest?.icao === 'LEBG' ? 'joining the north circuit at 4000 ft' : dest?.icao === 'LERJ' ? 'circuit 3000 ft' : '' });
  const chartAds = [dep, dest, alt].filter(Boolean).filter((x, i, arr) => arr.findIndex((y) => y.icao === x.icao) === i);
  // 7. TEM
  const crossings = airspaceCrossings(routeLegs('main'), AIRSPACES);
  const threats = temThreats({ ads: [dep, dest, alt].filter(Boolean).map((x) => x.icao), crossings, solo: f.solo, night, mountains: (terrainData || []).some((t) => t.corridor > 4500), hot: wxState.data && dep && (wxState.data[dep.icao]?.metar?.temp ?? 0) > 30 });
  return { dep, dest, alt, to, ldg, issues, nflags, bulletin: bulletin && bulletin.parsed, wx, limits, notamAds, fpl, depText, arrText, chartAds, freq: headerFor('main').freq, mb: result.mb, perf: perfResults(), threats, fuel: result.fuel };
}

function renderBriefing() {
  loadWeather();
  const B = briefingData();
  const { dep, issues, wx, notamAds, fpl, depText, arrText, chartAds, threats } = B;
  const bad = issues.filter((i) => i.level === 'bad').length, warn = issues.filter((i) => i.level === 'warn').length;
  let html = `<div class="group step-card" style="--c: var(--c-brief)"><div class="row"><span class="grow"><b>ICARO NOTAM bulletin</b><br><span class="label">${bulletin
    ? `Bulletin <b>${esc(bulletin.parsed.id || '')}</b> added${bulletin.parsed.issued ? ` · issued ${zl(new Date(bulletin.parsed.issued))}` : ''} — its identifier goes on the M&amp;B sheet and in the NOTAM part.`
    : 'In ICARO (works from Spain) save the aerodromes bulletin as PDF, then add it here: the app picks out the NOTAMs that matter for your flight and puts the identifier on the M&amp;B sheet and the briefing.'}</span></span>
    <label class="btn ${bulletin ? '' : 'primary'}">${bulletin ? 'Replace' : 'Add bulletin'}<input type="file" accept="application/pdf,.pdf" data-act="bulFile" hidden></label></div>
    <div class="row"><a class="btn small" href="https://notampib.enaire.es/icaro" target="_blank" rel="noopener">Open ICARO ↗</a><span class="grow"></span>${bulletin ? '<button class="btn small danger" data-act="bulRemove">Remove</button>' : ''}</div></div>`;
  html += readyChecklist(B);
  html += `<button class="btn primary wide" data-act="briefPdf">Download briefing (PDF)${state.mission ? ' · whole mission' : ''}</button>`;
  html += `<button class="btn wide" data-act="sepPdf" style="margin-top:8px">Separate files · ${state.mission ? 'navlogs, alternates and M&amp;B' : 'navlog, alternate and M&amp;B'}</button>`;
  if (sepFiles && sepFiles.length) {
    html += `<div class="group" id="sepFiles" style="margin-top:8px"><div class="row"><span class="grow"><b>${sepFiles.length} separate PDFs</b><br><span class="label">Made ${esc(sepFiles.made || '')} — make them again after any change. “Save all” opens the share sheet: choose Save to Files.</span></span><button class="btn primary" data-act="sepSave">Save all</button></div>
      ${sepFiles.map((f, i) => `<div class="row"><span class="grow" style="font-size:13px;word-break:break-all">${esc(f.name)}</span><button class="btn small" data-act="sepOne" data-i="${i}">Download</button></div>`).join('')}</div>`;
  }
  html += `<div class="group-title"><span>Go / no-go · ${bad ? `<span class="badge bad">${bad} no-go</span>` : '<span class="badge ok">no blockers</span>'} ${warn ? `<span class="badge warn">${warn} to check</span>` : ''}</span></div>`;
  html += issues.length
    ? `<ul class="issues tappable">${issues.map((i) => `<li class="${i.level}" data-go="${esc(JSON.stringify(issueTarget(i)))}"><span class="ic">${i.level === 'bad' ? '✕' : i.level === 'warn' ? '!' : 'i'}</span><span>${esc(i.text)}</span><span class="go">›</span></li>`).join('')}</ul>`
    : `<div class="group"><div class="empty">${result.main.rows.length ? 'No issues found. The final decision stays with you and your instructor.' : 'Plan a route to see the checks.'}</div></div>`;

  // 1. Weather
  html += `<div class="group-title" id="bs-1"><span>1 · Weather</span><button class="btn small" data-act="wx">Refresh</button></div><div class="group">`;
  const cruise = parseAlt(result.main.rows.find((r) => r.phase === 'cruise')?.alt) || 5500;
  const ch = aemetCharts(flightTime(), cruise);
  // Briefing List order: A surface pressure chart, B SIGWX, C wind chart, D METAR, E TAF
  html += `<div class="wx"><div class="wx-head"><b>A · Surface pressure chart</b><span class="label">AEMET</span></div><div id="surfaceBox">${surfaceHtml()}</div></div>`;
  html += `<div class="wx"><div class="wx-head"><b>B · SIGWX</b><span class="label">AEMET low level · for your time</span></div><div class="wxcharts">${wxUploadHtml('sigwx', ch.sigwx)}</div></div>`;
  html += `<div class="wx"><div class="wx-head"><b>C · Wind chart</b><span class="label">AEMET · for your time and level</span></div><div class="wxcharts">${wxUploadHtml('wind', ch.wind)}</div>
    <div class="label" style="margin-top:6px">If a chart does not load, save it from <a href="https://ama.aemet.es" target="_blank" rel="noopener">AEMET aviation ↗</a> and add it here — it goes into the briefing PDF.</div></div>`;
  html += `<div class="wx"><div class="wx-head"><b>D · METAR &nbsp;·&nbsp; E · TAF</b><span class="label">aviationweather.gov</span></div></div>`;
  if (wxState.loading) html += '<div class="empty">Loading METAR and TAF…</div>';
  else if (wxState.err) html += `<div class="empty">Weather unavailable (${esc(wxState.err)}). Check <a href="https://ama.aemet.es/en" target="_blank" rel="noopener">AEMET</a>.</div>`;
  else if (!dep) html += '<div class="empty">Add aerodromes to the route.</div>';
  if (wxState.data) for (const { ad, t, role, w, a, st } of wx) {
    html += `<div class="wx"><div class="wx-head"><b>${ad.icao}</b><span class="label">${role} · ${hhmmZ(t)} ±1 h</span><span class="badge ${st[0]}">${st[1]}</span></div>
      ${w.metar ? `<div class="label" style="font-size:12px">${esc(metarSummary(w.metar))}${a.xw ? ` · best RWY ${a.xw.rwy}: crosswind ${a.xw.xw} kt` : ''}</div><div class="mono">${esc(w.metar.rawOb)}</div>` : '<div class="label">No METAR</div>'}
      ${w.taf ? `<div class="mono" style="margin-top:4px">${esc(w.taf.rawTAF)}</div>` : '<div class="label">No TAF</div>'}</div>`;
  }
  html += `</div><p class="note">${esc(B.limits)} Sources: aviationweather.gov, AEMET (charts load from Spain only; check the validity printed on each chart).</p>`;

  // 2. NOTAMs
  html += `<div class="group-title" id="bs-2"><span>2 · NOTAMs</span></div><div class="group">
    <div class="row"><span class="grow">Aerodromes: ${notamAds.join(', ') || '—'} — check every alternate individually</span><a class="btn small" href="https://notampib.enaire.es/icaro" target="_blank" rel="noopener">ICARO ↗</a></div>
    <div class="row"><span class="grow">En-route NOTAMs (Phase 3 manual)</span><a class="btn small" href="https://insigniavfr.enaire.es" target="_blank" rel="noopener">Insignia VFR ↗</a></div>
    ${bulletin ? '' : '<div class="row"><span class="grow label">No bulletin yet — add it at the top of this step.</span></div>'}
    ${B.nflags.length ? `<ul class="issues">${B.nflags.map((i) => `<li class="${i.level}"><span class="ic">${i.level === 'bad' ? '✕' : i.level === 'warn' ? '!' : 'i'}</span><span>${esc(i.text)}</span></li>`).join('')}</ul>` : bulletin ? '<div class="row"><span class="grow label">Nothing in the bulletin for your aerodromes, times or route.</span></div>' : ''}
    <div class="row wrap"><label class="field full"><span>NOTAM bulletin code / relevant NOTAMs (printed on the M&amp;B and the briefing)</span><input data-mb="notams" value="${esc(effNotams(state.mb.notams))}" placeholder="e.g. ICARO 3123651"></label></div>
  </div>`;

  // 3. ATC flight plan
  html += `<div class="group-title" id="bs-3"><span>3 · ATC flight plan (draft)</span></div><div class="group">${fpl ? `<div class="wx mono" id="fplText">${esc(fpl)}</div>${copyBtn('fplText')}` : '<div class="empty">Plan a route between two aerodromes.</div>'}</div>
    <p class="note">EOBT is set 10 min before takeoff. Check equipment, endurance and persons on board before filing.</p>`;

  // 4. Mission: departure / arrival briefing, alternate, charts
  html += `<div class="group-title" id="bs-4"><span>4 · Mission objective</span></div><div class="group">
    <div class="wx"><div class="wx-head"><b>Departure briefing</b></div><div id="depBrief">${esc(depText) || '—'}</div></div>${depText ? copyBtn('depBrief') : ''}
    <div class="wx"><div class="wx-head"><b>Arrival briefing</b><span class="label">Phase 1 format</span></div><div id="arrBrief">${esc(arrText) || '—'}</div></div>${arrText ? copyBtn('arrBrief') : ''}
    <div class="wx"><div class="wx-head"><b>Aerodromes (AIP AD 2)</b></div>${chartAds.map((x) => { const a = AIP_NOTES[x.icao]; const h = aerodromeOpen(x.icao, B.to); return `<div><b>${x.icao}</b> · fuel: ${a ? esc(a.fuel || 'no AVGAS') : 'check AD 2.4'} · ${esc(h.text)} · <a href="${x.ad2}" target="_blank" rel="noopener">AD 2 ↗</a></div>`; }).join('') || '—'}</div>
    <div class="wx"><div class="wx-head"><b>Charts to have in sight</b></div>${chartAds.map((x) => `<a href="${x.vac}" target="_blank" rel="noopener">${x.icao} VAC ↗</a>`).join(' · ') || '—'} · ENAIRE 1:500 000 chart</div>
    <div class="wx"><div class="wx-head"><b>Frequencies</b></div>${esc(B.freq)}</div>
  </div>`;

  // 5 & 6. Mass & balance and performance (details in the Mass & Balance view)
  const mbr = B.mb;
  html += `<div class="group-title"><span>5 · Mass &amp; balance · 6 · Performance</span><button class="btn small" data-act="toMb">Open</button></div><div class="group">
    <div class="row ${mbr ? (mbr.ok ? 'check-ok' : 'check-bad') : 'check-bad'}"><span class="grow">${mbr ? `T/O ${mbr.to.mass.toFixed(1)} ${mbr.ac.unit} · C.G. ${mbr.to.arm.toFixed(mbr.ac.armDp)} ${mbr.ac.armUnit}` : 'Mass &amp; balance not complete'}</span><span class="value">${mbr ? (mbr.ok ? 'IN LIMITS' : 'OUT') : '—'}</span></div>
    ${B.perf.map(({ c, r }) => { const ph = r && !r.manual ? (c.role === 'dep' ? r.to : r.ldg) : null; return `<div class="row"><span class="grow">${c.role === 'dep' ? 'Take-off' : 'Landing'} ${c.ad.icao}</span><span class="value">${ph && !ph.manual ? (ph.d50 != null ? `${ph.d50} ${r.unit} over 50 ft` : `ground roll ${ph.gr} ${r.unit}`) : 'read the chart'}</span></div>`; }).join('')}
  </div>`;

  // 7. TEM
  html += `<div class="group-title" id="bs-7"><span>7 · Threat &amp; error management</span></div><div class="group">${threats.map((t) => `<label class="tem-row"><input type="checkbox" data-tem="${esc(t)}" ${state.tem[t] ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div>`;

  html += `<p class="note">Briefing order (school briefing list): weather, NOTAMs, ATC flight plan, mission objective, mass &amp; balance, performance, TEM. Your unlocked aerodromes are in Settings (⚙︎).</p>`;
  panels.brief.innerHTML = html;
}

/* ---------------- Ready to present: the Briefing List (SOP) item by item ---------------- */
function readyChecklist(B) {
  const cruise = parseAlt(result.main.rows.find((r) => r.phase === 'cruise')?.alt) || 5500;
  const ch = aemetCharts(flightTime(), cruise);
  const chartOk = (kind) => wxUploads[kind] ? ['ok', 'your chart added'] : ch[kind].urls.some((u) => chartBytes.has(u)) ? ['ok', 'AEMET, for your time'] : ['warn', `not in the PDF yet — save it from AEMET and tap “Add ${WXUP_NAME[kind]}”`];
  const wx = B.wx || [];
  const noMetar = wx.filter((w) => !w.w.metar).map((w) => w.ad.icao), noTaf = wx.filter((w) => !w.w.taf).map((w) => w.ad.icao);
  const planBad = B.issues.filter((i) => i.level === 'bad').length;
  const temAll = B.threats.length, temDone = B.threats.filter((t) => state.tem[t]).length;
  const perfOk = B.perf.length && B.perf.every(({ r }) => r && !r.manual);
  state.ready = state.ready || {};
  const items = [
    ['1A', 'Surface pressure chart', surface && surface.png ? ['ok', surface.label.replace(/^Surface pressure analysis · /, '')] : aemetExpired() ? ['warn', 'AEMET key expired'] : ['info', 'loading from AEMET…'], { sec: 'bs-1' }],
    ['1B', 'SIGWX', chartOk('sigwx'), { sec: 'bs-1' }],
    ['1C', 'Wind chart', chartOk('wind'), { sec: 'bs-1' }],
    ['1D', 'METAR', !wx.length ? ['warn', 'plan the route first'] : wxState.err && !wxState.data ? ['warn', 'weather unavailable — check ICARO'] : wxState.data ? (noMetar.length ? ['warn', `none for ${noMetar.join(', ')} — check ICARO`] : ['ok', wx.map((w) => w.ad.icao).join(', ')]) : ['info', 'loading…'], { sec: 'bs-1' }],
    ['1E', 'TAF', !wx.length ? ['warn', 'plan the route first'] : wxState.err && !wxState.data ? ['warn', 'weather unavailable — check ICARO'] : wxState.data ? (noTaf.length ? ['info', `not issued for ${noTaf.join(', ')}`] : ['ok', wx.map((w) => w.ad.icao).join(', ')]) : ['info', 'loading…'], { sec: 'bs-1' }],
    ['2', 'NOTAMs', bulletin ? ['ok', `ICARO ${bulletin.parsed.id || 'bulletin'}`] : ['warn', 'add the ICARO bulletin (top of this step)'], { sec: 'bs-2' }],
    ['3', 'ATC flight plan', B.fpl ? ['ok', 'draft ready to copy'] : ['warn', 'plan a route between two aerodromes'], { sec: 'bs-3' }],
    ['4A', 'OFP (navlog)', !result.main.rows.length ? ['warn', 'no route yet'] : planBad ? ['warn', `${planBad} no-go item${planBad > 1 ? 's' : ''} — see Go / no-go below`] : ['ok', `${result.main.totals.dist} NM · ${fmtHMS(result.main.totals.timeSec)}`], { step: 'plan' }],
    ['4B', 'Map', result.main.rows.length ? ['ok', 'marked chart in the PDF'] : ['warn', 'no route yet'], { step: 'plan' }],
    ['4C', 'Alternate', result.alt.rows.length ? ['ok', `${endpoint('alt', -1)?.icao || ''} · ${result.alt.totals.dist} NM`] : ['warn', 'plan the alternate (Plan → Alternate)'], { route: 'alt' }],
    ['4D', 'Manoeuvres', state.ready.manoeuvres ? ['ok', 'prepared'] : ['manual', 'tap when you have prepared them'], { tick: 'manoeuvres' }],
    ['5', 'Mass & balance', result.mb && result.mb.ok && +stationMass(state.flight, 'pilot') > 0 ? ['ok', 'within limits'] : result.mb && !result.mb.ok ? ['warn', 'out of limits'] : ['warn', 'enter the masses'], { step: 'mb' }],
    ['6', 'Performance', perfOk ? ['ok', 'take-off and landing'] : B.perf.length ? ['info', 'read the chart for this type'] : ['warn', 'plan a route first'], { step: 'mb' }],
    ['7', 'TEM', !temAll ? ['info', 'nothing found for this flight'] : temDone === temAll ? ['ok', 'all threats reviewed'] : ['warn', `${temDone} of ${temAll} reviewed — tick them below`], { sec: 'bs-7' }],
  ];
  const done = items.filter((x) => x[2][0] === 'ok').length;
  const ic = { ok: '✓', warn: '!', info: 'i', manual: '○' };
  return `<div class="group-title"><span>Ready to present · Briefing List</span><span class="label">${done} / ${items.length}</span></div>
  <div class="group ready"><ul class="issues ready-list">${items.map(([n, name, [st, txt], go]) => `<li class="${st === 'manual' ? 'info' : st}" data-ready="${esc(JSON.stringify(go))}"><span class="ic">${ic[st]}</span><span><b>${n} · ${esc(name)}</b> — ${esc(txt)}</span><span class="go">›</span></li>`).join('')}</ul></div>`;
}
document.addEventListener('click', (e) => {
  const li = e.target.closest('ul.ready-list li[data-ready]'); if (!li) return;
  let g; try { g = JSON.parse(li.dataset.ready); } catch { return; }
  if (g.tick) { state.ready = state.ready || {}; state.ready[g.tick] = !state.ready[g.tick]; scheduleSave(); return renderBriefing(); }
  if (g.sec) { const el = document.getElementById(g.sec); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } return; }
  if (g.route) return goIssue({ route: g.route });
  if (g.step) return goStep(g.step);
});

/* ---------------- Tappable warnings: each one takes you to what it is about ---------------- */
function issueTarget(i) {
  if (i.go && i.go.wid) return i.go;
  const t = i.text || '';
  if (/alternate planned|two alternates/i.test(t)) return { route: 'alt' };
  if (/^NOTAM|bulletin/i.test(t)) return { mode: 'brief', focus: 'bulletin' };
  if (/mass ?& ?balance|C\.G\.|\bCG\b|overweight|MTOW/i.test(t)) return { mode: 'mb' };
  if (/fuel|tanks|FOB/i.test(t)) return { tab: 'fuel' };
  if (/METAR|TAF|visibility|ceiling|crosswind|headwind|gust|weather/i.test(t)) return { mode: 'brief', focus: 'wx' };
  if (/sunset|sunrise|closed at your|night VFR/i.test(t)) return { time: true };
  if (/unlocked/i.test(t)) return { mode: 'settings' };
  if (/Solo/i.test(t)) return { route: 'main' };
  return { route: 'main' };
}
function goIssue(g) {
  if (!g) return;
  if (g.mode) { goStep(g.mode); return; }
  if (g.time) { const el = document.querySelector('.timecard, #timeCard'); if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } toast('Change the take-off time with the slider at the top'); return; }
  goStep('plan');
  if (g.tab) { document.querySelector(`#tabs [data-tab=${g.tab}]`)?.click(); return; }
  if (g.route && g.route !== state.active) { state.active = g.route; update({ rerenderPanels: true }); }
  if (tab !== 'route') document.querySelector('#tabs [data-tab=route]')?.click();
  if (g.wid) {
    const r = state[g.route || state.active], i = r.waypoints.findIndex((w) => w.id === g.wid);
    if (i > 0) map.fitBounds(L.latLngBounds([[r.waypoints[i - 1].lat, r.waypoints[i - 1].lon], [r.waypoints[i].lat, r.waypoints[i].lon]]), { padding: [80, 80], maxZoom: 11, paddingTopLeft: [isWide() ? document.getElementById('sheet').getBoundingClientRect().right + 30 : 40, 120] });
    selectWaypoint(g.wid, true);
    setTimeout(() => { const el = panels.route.querySelector(`.wp[data-id="${g.wid}"]`); if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } }, 350);
  }
}
document.addEventListener('click', (e) => {
  const li = e.target.closest('ul.issues.tappable li[data-go]'); if (!li) return;
  try { goIssue(JSON.parse(li.dataset.go)); } catch { /* ignore */ }
});

/* ---------------- Ready offline? ----------------
 * What the app needs without signal: its own files, the AIP / obstacle / town data, and the chart
 * tiles around the route (saved with "Save chart for offline"). */
const OFFLINE_DATA = ['data/aip.json', 'data/obstacles.json', 'data/places.json'];
const SHELL_CACHE_NAME = () => offlineShellName || 'navlog-shell';
let offlineShellName = null;
async function offlineStatus() {
  const out = [];
  if (!('caches' in window) || !navigator.serviceWorker) return [{ ok: false, text: 'This browser cannot keep the app offline' }];
  const keys = await caches.keys();
  offlineShellName = keys.filter((k) => /^navlog-shell-v\d+$/.test(k)).sort((a, b) => +b.split('v').pop() - +a.split('v').pop())[0] || null;
  const shell = offlineShellName ? await caches.open(offlineShellName) : null;
  const has = async (u) => !!(shell && await shell.match(u, { ignoreSearch: true }));
  out.push({ ok: !!navigator.serviceWorker.controller && await has('js/app.js'), text: 'App saved on this device' });
  out.push({ ok: await has('data/aip.json'), text: 'Aerodromes, reporting points and airspaces (AIP)' });
  out.push({ ok: await has('data/obstacles.json'), text: 'Obstacles (minimum-altitude check)' });
  out.push({ ok: await has('data/places.json'), text: 'Town names' });
  // chart tiles along the route at the zooms used for planning
  const all = [...state.main.waypoints, ...state.alt.waypoints];
  const own = state.view.base !== 'vfr' && ownMeta;
  const cache = await caches.open(own ? 'navlog-ownchart-v1' : 'navlog-tiles-v1');
  if (all.length) {
    let need = 0, got = 0;
    for (const z of [9, 10]) for (const w of all) {
      const p = map.project([w.lat, w.lon], z).divideBy(256).floor();
      need++; if (await cache.match(`${own ? 'chart' : 'tiles'}/${z}/${p.x}/${p.y}.webp`, { ignoreSearch: true })) got++;
    }
    out.push({ ok: got === need, text: got === need ? 'Chart along your route' : `Chart along your route — ${Math.round((got / need) * 100)} % saved: use “Save chart for offline” in the layers menu` });
  } else out.push({ ok: null, text: 'Chart along your route — plan a route, then “Save chart for offline” in the layers menu' });
  return out;
}
async function renderOfflineBox() {
  const el = document.getElementById('offlineBox'); if (!el) return;
  try {
    const st = await offlineStatus();
    const all = st.every((x) => x.ok !== false);
    el.innerHTML = `<div class="row"><span class="grow"><b>${all ? 'Ready offline ✓' : 'Not fully ready offline'}</b></span><button class="btn small" data-act="offlineSave">Save chart for offline</button></div>
      <ul class="issues">${st.map((x) => `<li class="${x.ok ? 'ok' : x.ok === false ? 'warn' : 'info'}"><span class="ic">${x.ok ? '✓' : x.ok === false ? '!' : 'i'}</span><span>${esc(x.text)}</span></li>`).join('')}</ul>`;
  } catch (err) { el.textContent = 'Could not check the offline storage'; }
}

/* ---------------- Settings ---------------- */
function renderSettings() {
  const st = state.settings;
  let html = `<div class="group-title"><span>About you</span></div><div class="group pad">
    <div class="row wrap">
      <label class="field"><span>Name</span><input data-set="name" value="${esc(st.name)}" autocomplete="name"></label>
      <label class="field narrow"><span>Student code</span><input data-mb="studentCode" value="${esc(state.mb.studentCode)}" autocapitalize="characters"></label>
    </div></div>
  <div class="group-title"><span>Signature</span><button class="btn small" data-act="sigClear">Clear</button></div>
  <div class="group pad"><canvas id="sigPad" class="sig-pad" width="900" height="260"></canvas>
    <div class="label" style="padding:6px 2px 0">Sign with your finger or the Pencil. It is placed in the signature box of the M&amp;B sheets that have one (P2008, P-Mentor, C172RG, P2006 NG).</div></div>
  <div class="group-title"><span>Callsigns</span></div><div class="group pad">
    <div class="row wrap">
      <label class="field"><span>With instructor (outbound)</span><input data-set="callsign" value="${esc(st.callsign)}" placeholder="FBY12A" autocapitalize="characters" autocomplete="off" spellcheck="false"></label>
    </div>
    <div class="row wrap">
      <label class="field"><span>Solo outbound</span><input data-set="soloOut" value="${esc(st.soloOut)}" placeholder="assigned" autocapitalize="characters" autocomplete="off" spellcheck="false"></label>
      <label class="field"><span>Solo inbound</span><input data-set="soloIn" value="${esc(st.soloIn)}" placeholder="assigned" autocapitalize="characters" autocomplete="off" spellcheck="false"></label>
    </div>
    <div class="row"><span class="grow label">FBYxxY: xx is your instructor's number, Y the time-of-day letter. The inbound callsign is the next letter (FBY12A → FBY12B).</span></div></div>
  <div class="group-title"><span>My unlocked aerodromes</span></div><div class="group"><div class="chips">${EASY_FIRST.map((ad) => `<label><input type="checkbox" data-unlock="${ad}" ${state.unlocked.includes(ad) ? 'checked' : ''}>${ad}</label>`).join('')}</div></div>
  <p class="note">Solo flights only go to aerodromes already flown with an instructor (solo manual).</p>
  <div class="group-title"><span>Masses for the M&amp;B</span></div><div class="group pad">
    <div class="row wrap"><label class="field narrow"><span>My mass (kg)</span><input data-set="myMass" inputmode="decimal" value="${esc(st.myMass ?? '')}" placeholder="e.g. 73"></label>
      <span class="grow label" style="align-self:center">Filled in as the pilot on every new M&amp;B (you can still change it there).</span></div>
    <div class="label" style="margin:6px 0 4px">Instructors — pick them as copilot in the M&amp;B</div>
    ${(st.instructors || []).map((x, i) => `<div class="row wrap"><label class="field"><span>Name</span><input data-ins="name" data-i="${i}" value="${esc(x.name)}"></label><label class="field narrow"><span>Mass (kg)</span><input data-ins="mass" data-i="${i}" inputmode="decimal" value="${esc(x.mass ?? '')}"></label><button class="btn small danger" data-act="insDel" data-i="${i}" style="align-self:flex-end">Remove</button></div>`).join('')}
    <div class="row"><button class="btn small" data-act="insAdd">+ Add instructor</button></div></div>
  <div class="group-title"><span>Offline</span></div><div class="group pad" id="offlineBox"><div class="label">Checking…</div></div>
  <div class="group-title"><span>AEMET surface pressure chart</span></div><div class="group pad"><div class="label">${aemetExpired() ? `The AEMET OpenData key expired on ${AEMET_KEY_EXPIRES} — it needs renewing in the app.` : `Built into the app · AEMET OpenData key valid until ${AEMET_KEY_EXPIRES}.`}</div></div>
  <p class="note">Settings stay on this device.</p>`;
  panels.settings.innerHTML = html;
  sigInit();
  renderOfflineBox();
}
function sigInit() {
  const c = document.getElementById('sigPad'); if (!c) return;
  const g = c.getContext('2d');
  g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#0d2f8f';
  const shown = state.settings.signaturePad || state.settings.signature;
  if (shown) { const im = new Image(); im.onload = () => g.drawImage(im, 0, 0, c.width, c.height); im.src = shown; }
  let drawing = false, last = null;
  const pos = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)]; };
  c.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); c.setPointerCapture(e.pointerId); e.preventDefault(); });
  c.addEventListener('pointermove', (e) => { if (!drawing) return; const p = pos(e); g.beginPath(); g.moveTo(...last); g.lineTo(...p); g.stroke(); last = p; e.preventDefault(); });
  const end = () => {
    if (!drawing) return; drawing = false;
    // keep the pad as drawn, and a copy cropped to the ink for the sheets
    state.settings.signaturePad = c.toDataURL('image/png');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) if (d[(y * c.width + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) { state.settings.signature = ''; return scheduleSave(); }
    const pad = 6, w = Math.min(c.width, x1 + pad) - Math.max(0, x0 - pad), h = Math.min(c.height, y1 + pad) - Math.max(0, y0 - pad);
    const t = document.createElement('canvas'); t.width = w; t.height = h;
    t.getContext('2d').drawImage(c, Math.max(0, x0 - pad), Math.max(0, y0 - pad), w, h, 0, 0, w, h);
    state.settings.signature = t.toDataURL('image/png'); scheduleSave();
  };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
}
panels.settings.addEventListener('click', (e) => {
  if (e.target.closest('[data-act=insAdd]')) { (state.settings.instructors = state.settings.instructors || []).push({ name: '', mass: '' }); scheduleSave(); return renderSettings(); }
  const del = e.target.closest('[data-act=insDel]');
  if (del) { state.settings.instructors.splice(+del.dataset.i, 1); scheduleSave(); return renderSettings(); }
  if (e.target.closest('[data-act=offlineSave]')) return document.getElementById('btnOffline').click();
  if (e.target.closest('[data-act=sigClear]')) {
    const c = document.getElementById('sigPad'); c.getContext('2d').clearRect(0, 0, c.width, c.height);
    state.settings.signature = ''; state.settings.signaturePad = ''; scheduleSave();
  }
});
panels.settings.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.set === 'myMass') { state.settings.myMass = numMin0(t.value); update({ rerenderPanels: false }); scheduleSave(); return; }
  if (t.dataset.set) { const k = t.dataset.set; state.settings[k] = k === 'name' ? t.value.trim() : t.value.toUpperCase().trim(); scheduleSave(); }
  if (t.dataset.ins) { const l = state.settings.instructors || (state.settings.instructors = []); const x = l[+t.dataset.i]; if (x) { x[t.dataset.ins] = t.dataset.ins === 'mass' ? numMin0(t.value) : t.value.trim(); scheduleSave(); } }
  if (t.dataset.mb) { state.mb[t.dataset.mb] = t.value.toUpperCase().trim(); scheduleSave(); }
  if (t.dataset.unlock) {
    const ad = t.dataset.unlock;
    state.unlocked = t.checked ? [...new Set([...state.unlocked, ad])] : state.unlocked.filter((x) => x !== ad);
    update({ rerenderPanels: false }); scheduleSave();
  }
});

panels.brief.addEventListener('click', (e) => {
  const c = e.target.closest('[data-copy]');
  if (c) {
    const el = document.getElementById(c.dataset.copy);
    navigator.clipboard?.writeText(el.innerText).then(() => toast('Copied'), () => toast('Copy failed'));
    return;
  }
  if (e.target.closest('[data-act=wx]')) loadWeather(true);
  if (e.target.closest('[data-act=toMb]')) document.querySelector('#modes [data-mode=mb]').click();
  if (e.target.closest('[data-act=briefPdf]')) downloadBriefing();
  if (e.target.closest('[data-act=sepPdf]')) downloadBriefing(true);
  if (e.target.closest('[data-act=sepSave]')) saveAllSeparate();
  const one = e.target.closest('[data-act=sepOne]');
  if (one && sepFiles) { const f = sepFiles[+one.dataset.i]; if (f) saveBlob(f.blob, f.name); }
  if (e.target.closest('[data-act=bulRemove]')) removeBulletin();
  const wr = e.target.closest('[data-act=wxUpRemove]');
  if (wr) removeWxUpload(wr.dataset.kind);
});
panels.brief.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.tem) { state.tem[t.dataset.tem] = t.checked; scheduleSave(); }
  if (t.dataset.mb) { state.mb[t.dataset.mb] = t.value; scheduleSave(); }
  if (t.dataset.act === 'bulFile' && t.files && t.files[0]) addBulletin(t.files[0]);
  if (t.dataset.act === 'wxUp' && t.files && t.files[0]) addWxUpload(t.dataset.kind, t.files[0]);
  if (t.dataset.unlock) {
    const ad = t.dataset.unlock;
    state.unlocked = t.checked ? [...new Set([...state.unlocked, ad])] : state.unlocked.filter((x) => x !== ad);
    update({ rerenderPanels: true });
  }
});

/* ---------------- Winds aloft ---------------- */

let windTimer = null, windBusy = false;
function scheduleAutoWinds() { clearTimeout(windTimer); windTimer = setTimeout(() => updateWinds({ auto: true }), 1200); }

async function updateWinds({ auto = false } = {}) {
  if (windBusy || !navigator.onLine) return;
  const jobs = [];
  const t0 = flightTime();
  let offset = 0;
  for (const key of ['main', 'alt']) {
    const wps = state[key].waypoints, rows = result[key].rows;
    let cum = 0;
    for (let i = 1; i < wps.length; i++) {
      const w = wps[i];
      const legRows = rows.filter((r) => r.legIndex === i);
      const ete = legRows.reduce((t, r) => t + r.eteSec, 0);
      if (auto && (w.windSrc === 'manual' || (w.windSrc === 'auto' && w.windFor === state.time + '|' + w.alt))) { cum += ete; continue; }
      const m = midpoint(wps[i - 1], w);
      jobs.push({ w, key, lat: m.lat, lon: m.lon, altFt: parseAlt(w.alt) || 5500, time: new Date(t0.getTime() + (offset + cum + ete / 2) * 1000) });
      cum += ete;
    }
    offset += result[key].totals.timeSec;
  }
  if (!jobs.length) { if (!auto) toast('Winds are up to date'); return; }
  windBusy = true;
  if (!auto) toast('Fetching winds…');
  const before = snapshot();
  try {
    const res = await fetchWinds(jobs);
    jobs.forEach((j, i) => {
      const r = res[i]; if (!r) return;
      if (!auto && j.w.windSrc === 'manual') return; // keep winds typed in by hand
      j.w.wdir = r.dir; j.w.wspd = r.spd; j.w.windSrc = 'auto'; j.w.windFor = state.time + '|' + j.w.alt;
    });
    state.windSource = { at: new Date().toISOString(), model: 'Open-Meteo forecast' };
    update({ rerenderPanels: true });
    if (!auto) showWindChanges(before, snapshot());
  } catch (err) {
    if (!auto) toast('Could not fetch winds: ' + err.message);
  } finally { windBusy = false; }
}

function snapshot() {
  return ['main', 'alt'].flatMap((k) => result[k].rows.map((r) => ({ k, leg: `${r.from} → ${r.to}`, mh: r.mh, ete: r.eteSec, fuel: r.fuel })));
}
function showWindChanges(a, b) {
  const changes = [];
  b.forEach((r) => {
    const o = a.find((x) => x.k === r.k && x.leg === r.leg); if (!o) return;
    const dh = Math.abs(((r.mh - o.mh + 540) % 360) - 180), dt = Math.abs(r.ete - o.ete), df = Math.abs(r.fuel - o.fuel);
    if (dh >= 2 || dt >= 60 || df >= 0.5) changes.push(`${r.leg}: MH ${o.mh}→${r.mh}°, ETE ${fmtMMSS(o.ete)}→${fmtMMSS(r.ete)}, fuel ${o.fuel}→${r.fuel} L`);
  });
  windChanges = changes;
  toast(changes.length ? `Winds updated — ${changes.length} leg${changes.length > 1 ? 's' : ''} changed. Reprint the navlog.` : 'Winds updated — no significant changes');
  if (tab === 'route') renderRoute();
}
let windChanges = [];
document.getElementById('btnWinds').addEventListener('click', () => updateWinds({ auto: false }));

/* ---------------- Saved plans ---------------- */

function planData() {
  const { main, alt, active, time, flight, mb, unlocked, tem } = state;
  return { v: 1, main, alt, active, time, flight, mb, unlocked, tem };
}
function loadPlanData(d) {
  if (!d || !d.main) return toast('That file does not contain a plan');
  state = { ...state, ...d, flight: { ...state.flight, ...d.flight }, mb: { ...state.mb, ...d.mb } };
  syncSlider(); update({ rerenderPanels: true }); setTimeout(fitRoute, 50);
}
const plansPop = document.getElementById('plansPop');
function planName() {
  const dep = endpoint('main', 0)?.icao || state.main.waypoints[0]?.name || '?';
  const dest = endpoint('main', -1)?.icao || state.main.waypoints.at(-1)?.name || '?';
  return `${dep} → ${dest} · ${dFmt.format(flightTime())} ${zl(flightTime())}`;
}
function renderPlans() {
  const list = listPlans();
  document.getElementById('plansList').innerHTML = list.length ? list.map((p) => `<div class="plan-item" data-id="${p.id}"><div class="grow" data-open><b>${esc(p.name)}</b><small>saved ${new Date(p.saved).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</small></div><button class="icon-btn" data-del aria-label="Delete">${ICON.trash}</button></div>`).join('') : '<div class="pop-note">No saved plans yet.</div>';
}
document.getElementById('btnPlans').addEventListener('click', (e) => { e.stopPropagation(); renderPlans(); plansPop.hidden = !plansPop.hidden; layersPop.hidden = true; });
document.addEventListener('pointerdown', (e) => { if (!plansPop.hidden && !e.target.closest('#plansPop, #btnPlans')) plansPop.hidden = true; });
document.getElementById('plansList').addEventListener('click', (e) => {
  const item = e.target.closest('.plan-item'); if (!item) return;
  if (e.target.closest('[data-del]')) { if (confirm('Delete this saved plan?')) { deletePlan(item.dataset.id); renderPlans(); } return; }
  const p = getPlan(item.dataset.id);
  if (p) { state.planId = p.id; loadPlanData(p.data); planSavedSnap = routeSnap(); renderPlanStatus(); plansPop.hidden = true; toast(`Opened ${p.name}`); }
});
document.getElementById('btnSavePlan').addEventListener('click', () => {
  const name = prompt('Name for this plan', planName());
  if (!name) return;
  state.planId = savePlan(name, planData(), state.planId);
  planSavedSnap = routeSnap();
  renderPlanStatus();
  renderPlans(); toast('Plan saved'); scheduleSave();
});
// Backup: every saved plan plus Settings in one file (keep it in iCloud Drive / Files; open it on another device)
document.getElementById('btnExportPlans').addEventListener('click', async () => {
  const data = { kind: 'navlog-backup', version: 1, exported: new Date().toISOString(), plans: listPlans(), settings: state.settings, unlocked: state.unlocked, mbStudent: state.mb.studentCode };
  const name = `Navlog_backup_${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  plansPop.hidden = true;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
  }
  saveBlob(file, name);
  toast(`Exported ${data.plans.length} plans and your settings`);
});
document.getElementById('backupInput').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data || data.kind !== 'navlog-backup') return toast('That file is not a Navlog backup');
    const n = mergePlans(data.plans);
    if (data.settings && confirm('Also restore the settings from the backup (name, signature, callsigns, unlocked aerodromes)?')) {
      state.settings = { ...state.settings, ...data.settings };
      if (Array.isArray(data.unlocked)) state.unlocked = data.unlocked;
      if (data.mbStudent && !state.mb.studentCode) state.mb.studentCode = data.mbStudent;
    }
    renderPlans(); update({ rerenderPanels: true });
    toast(`Imported ${n} plan${n === 1 ? '' : 's'}`);
  } catch (err) { console.error(err); toast('Could not read the backup file'); }
});
document.getElementById('btnNewPlan').addEventListener('click', () => {
  if (!confirm('Start a new plan? Save the current one first if you need it.')) return;
  const keep = { flight: { ...state.flight }, unlocked: state.unlocked, view: state.view, settings: state.settings, mb: { ...defaultState().mb, studentCode: state.mb.studentCode } };
  state = { ...defaultState(), ...keep, planId: null };
  syncSlider(); update({ rerenderPanels: true }); plansPop.hidden = true;
});
document.getElementById('pdfInput').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    const d = await planFromPdf(await file.arrayBuffer());
    if (!d) return toast('This PDF was not made by the app, so it has no plan inside');
    state.planId = null; loadPlanData(d); plansPop.hidden = true;
    toast('Plan restored from the PDF — tap Update winds for the latest forecast');
  } catch (err) { toast('Could not read the PDF: ' + err.message); }
});

/* ---------------- Plan bar, panel ---------------- */

const callsignInput = document.getElementById('callsignInput');
callsignInput.addEventListener('change', () => {
  state.flight.callsign = callsignInput.value.toUpperCase().trim();
  const m = state.mission, leg = m && m.legs.find((l) => l.id === m.active);
  if (leg) { leg.callsign = state.flight.callsign; leg.callsignAuto = false; }
  update({ rerenderPanels: true });
});
function syncPlanBar() { if (document.activeElement !== callsignInput) callsignInput.value = state.flight.callsign || ''; }

function setPanel(open) {
  state.view.panel = open;
  document.documentElement.classList.toggle('panel-closed', !open);
  setTimeout(renderProfile, 400);
  scheduleSave();
}
document.getElementById('panelToggle').addEventListener('click', () => setPanel(!state.view.panel));

/* ---------------- Vertical profile ---------------- */

const dock = document.getElementById('profileDock');
let terrainKey = null, terrainData = null, terrainErr = false, terrainTimer = null;

function legDistances(key) {
  const rows = result[key].rows, n = state[key].waypoints.length;
  return Array.from({ length: Math.max(0, n - 1) }, (_, i) => rows.filter((r) => r.legIndex === i + 1).reduce((t, r) => t + r.dist, 0));
}
function scheduleTerrain() { clearTimeout(terrainTimer); terrainTimer = setTimeout(loadTerrain, 350); renderProfile(); }
async function loadTerrain() {
  const key = state.active, wps = state[key].waypoints;
  if (wps.length < 2) { terrainKey = null; terrainData = null; return renderProfile(); }
  const k = key + wps.map((w) => `${w.lat.toFixed(4)},${w.lon.toFixed(4)}`).join(';');
  if (k === terrainKey) return;
  terrainKey = k; terrainData = null; terrainErr = false; renderProfile();
  try {
    const t = await sampleTerrain(wps, legDistances(key));
    if (terrainKey === k) { terrainData = t; if (autoLevels(key, t)) update({ rerenderPanels: true }); else renderProfile(); }
  } catch (err) {
    console.warn('terrain', err);
    if (terrainKey === k) { terrainErr = true; terrainKey = null; renderProfile(); }
  }
}
// Minimum altitude for a leg (school SOP: 1000 ft above the highest obstacle within the corridor,
// 2000 ft over mountainous terrain): ENAIRE obstacles (≥ 100 m) within 2 NM of the track and the
// terrain within 2 NM (when loaded for this route). Obstacles within 3 NM of a departure or arrival
// aerodrome are left to the aerodrome procedures.
const CORRIDOR_NM = 2;
function nmToSeg(p, a, b) {
  const kx = 60 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180), ky = 60;
  const ax = a.lon * kx, ay = a.lat * ky, bx = b.lon * kx, by = b.lat * ky, px = p[1] * kx, py = p[0] * ky;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
  return { d: Math.hypot(px - ax - t * dx, py - ay - t * dy), t };
}
function legMinimum(key, i) {
  const wps = state[key].waypoints, a = wps[i - 1], b = wps[i];
  if (!a || !b) return null;
  const isAd = (w) => w && w.ref && adByIcao(w.ref);
  const lat0 = Math.min(a.lat, b.lat) - 0.04, lat1 = Math.max(a.lat, b.lat) + 0.04, lon0 = Math.min(a.lon, b.lon) - 0.05, lon1 = Math.max(a.lon, b.lon) + 0.05;
  let ob = null;
  for (const o of OBSTACLES) {
    if (o[0] < lat0 || o[0] > lat1 || o[1] < lon0 || o[1] > lon1) continue;
    const r = nmToSeg(o, a, b);
    if (r.d > CORRIDOR_NM) continue;
    if ((isAd(a) && distanceNm(a, { lat: o[0], lon: o[1] }) < 3) || (isAd(b) && distanceNm(b, { lat: o[0], lon: o[1] }) < 3)) continue;
    if (!ob || o[2] > ob.top) ob = { top: o[2], type: o[4], off: r.d };
  }
  let terr = null;
  if (key === state.active && terrainData && terrainData.length) {
    const dists = legDistances(key); let d0 = 0; for (let k = 0; k < i - 1; k++) d0 += dists[k] || 0;
    const d1 = d0 + (dists[i - 1] || 0);
    const seg = terrainData.filter((t) => t.d >= d0 + (isAd(a) ? 3 : 0) && t.d <= d1 - (isAd(b) ? 3 : 0));
    if (seg.length) terr = Math.round(Math.max(...seg.map((t) => t.corridor)));
  }
  if (!ob && terr == null) return null;
  const base = Math.max(ob ? ob.top : 0, terr || 0);
  const mountain = (terr || 0) >= 4000;
  const need = Math.ceil((base + (mountain ? 2000 : 1000)) / 100) * 100;
  const why = ob && ob.top >= (terr || 0) ? `obstacle ${ob.top} ft (${({ w: 'wind turbine', a: 'antenna', t: 'tower' })[ob.type] || 'obstacle'}, ${ob.off.toFixed(1)} NM from track)` : `terrain ${terr} ft within ${CORRIDOR_NM} NM`;
  return { need, why, mountain };
}

// Default cruising level for an en-route leg from the terrain: the lowest level of the Spanish
// north/south rule (southbound 3500/5500/7500, northbound 4500/6500/8500) that keeps 1000 ft above
// the highest terrain within 2 NM of the track (2000 ft over mountainous terrain, above 4000 ft).
// Only for levels the app chose (altAuto); a level typed or dragged by the student is kept.
// Obstacles are not in the terrain data — check the chart.
function autoLevels(key, terr) {
  if (!terr || !terr.length) return false;
  const wps = state[key].waypoints, dists = legDistances(key);
  let d0 = 0, changed = false;
  for (let i = 1; i < wps.length; i++) {
    const w = wps[i], d1 = d0 + (dists[i - 1] || 0);
    if (w.altAuto && !w.proc) {
      const seg = terr.filter((t) => t.d >= d0 - 0.01 && t.d <= d1 + 0.01);
      if (seg.length) {
        const top = Math.max(...seg.map((t) => t.corridor));
        const lm = legMinimum(key, i);
        const need = Math.max(top + (top >= 4000 ? 2000 : 1000), lm ? lm.need : 0);
        const mc = ((Math.round(trueCourse(wps[i - 1], w) - (wps[i - 1].var || 0)) % 360) + 360) % 360;
        const levels = southbound(mc) ? [3500, 5500, 7500, 9500] : [4500, 6500, 8500];
        const alt = levels.find((l) => l >= need) || levels[levels.length - 1];
        if (parseAlt(w.alt) !== alt) { w.alt = alt; changed = true; }
      }
    }
    d0 = d1;
  }
  return changed;
}
// obstacles within the corridor, as distance along the route (for the profile)
function profileObstacles(key) {
  const wps = state[key].waypoints, dists = legDistances(key), out = [];
  let d0 = 0;
  for (let i = 1; i < wps.length; i++) {
    const a = wps[i - 1], b = wps[i], L = dists[i - 1] || 0;
    const lat0 = Math.min(a.lat, b.lat) - 0.04, lat1 = Math.max(a.lat, b.lat) + 0.04, lon0 = Math.min(a.lon, b.lon) - 0.05, lon1 = Math.max(a.lon, b.lon) + 0.05;
    for (const o of OBSTACLES) {
      if (o[0] < lat0 || o[0] > lat1 || o[1] < lon0 || o[1] > lon1) continue;
      const r = nmToSeg(o, a, b);
      if (r.d <= CORRIDOR_NM) out.push({ d: d0 + r.t * L, top: o[2], h: o[3] || 0 });
    }
    d0 += L;
  }
  return out;
}
function renderProfile() {
  if (!result) return;
  const key = state.active;
  const nl = result[key];
  const startAd = endpoint(key, 0), endAd = endpoint(key, -1);
  const planned = nl.rows.length ? plannedProfile(nl.rows, startAd ? (key === 'alt' ? null : startAd.elev) : null, endAd && state[key].stdArr ? endAd.elev : null) : null;
  const color = key === 'alt' ? '#0a84ff' : '#d1009a';
  const targets = isWide()
    ? [[document.getElementById('profileCanvas'), document.getElementById('profileInfo')]]
    : (state.mode === 'plan' && tab === 'profile' ? [[document.getElementById('profileCanvasSheet'), document.getElementById('profileNoteSheet')]] : []);
  for (const [canvas, info] of targets) {
    const res = drawProfile(canvas, { planned, terrain: terrainData, color, obstacles: profileObstacles(key) });
    let txt = '';
    if (planned) {
      if (terrainErr) txt = 'Terrain unavailable (offline?)';
      else if (!terrainData) txt = 'Loading terrain…';
      else if (res) {
        txt = `Highest terrain ±2 NM: ${res.maxTerrain} ft`;
        if (res.minClearance != null) txt += ` · min clearance ${res.minClearance} ft${res.minClearance < 1000 ? ' ⚠︎ below 1000 ft' : ''}`;
      }
      txt += OBSTACLES.length ? ' · obstacles ≥ 100 m (ENAIRE) within 2 NM shown — smaller ones are not, check the chart' : ' · obstacles not loaded — check the chart';
    }
    info.textContent = txt;
    info.classList.toggle('warn', !!(res && res.minClearance != null && res.minClearance < 1000));
  }
}
document.getElementById('profileToggle').addEventListener('click', () => {
  state.view.profile = !state.view.profile;
  dock.classList.toggle('collapsed', !state.view.profile);
  document.documentElement.classList.toggle('profile-collapsed', !state.view.profile);
  save(); setTimeout(renderProfile, 300);
});
new ResizeObserver(() => renderProfile()).observe(dock);

// Drag the planned altitude in the profile: changes the level of the leg under the finger,
// snapped to 100 or 500 ft; TOC/TOD are recalculated from the new levels.
const altStep = () => state.view.altStep || 500;
const altStepBtn = document.getElementById('altStepBtn');
const syncStepBtn = () => { altStepBtn.textContent = `Drag · ${altStep()} ft`; };
altStepBtn.addEventListener('click', () => { state.view.altStep = altStep() === 500 ? 100 : 500; syncStepBtn(); save(); toast(`Profile drag snaps to ${altStep()} ft`); });
syncStepBtn();
function legAtDistance(d) {
  const nl = result && result[state.active];
  if (!nl || !nl.rows.length) return null;
  let acc = 0;
  for (const r of nl.rows) { acc += r.dist; if (d <= acc + 1e-6) return r.legIndex; }
  return nl.rows[nl.rows.length - 1].legIndex;
}
for (const id of ['profileCanvas', 'profileCanvasSheet']) {
  const cv = document.getElementById(id);
  if (!cv) continue;
  let drag = null, raf = 0;
  // Relative drag: the level moves with the finger from where it was (no jump on touch), at a
  // fixed scale taken when the drag starts (the profile rescales as levels change, which made the
  // old absolute drag overshoot), and a little slower than the finger for fine control.
  const apply = (e) => {
    if (!drag) return;
    const step = altStep();
    const raw = drag.alt0 + (drag.y0 - e.clientY) * drag.ftPerPx * 0.7;
    const alt = Math.max(1000, Math.min(14500, Math.round(raw / step) * step));
    const w = route().waypoints[drag.leg];
    if (!w || parseAlt(w.alt) === alt) return;
    w.alt = alt; w.altAuto = false;
    if (navigator.vibrate) navigator.vibrate(5);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      update({ rerenderPanels: false, winds: false });
      const info = id === 'profileCanvas' ? document.getElementById('profileInfo') : document.getElementById('profileNoteSheet');
      if (info) info.textContent = `${route().waypoints[drag.leg - 1]?.name || ''} → ${w.name}: ${alt} ft`;
    });
  };
  cv.addEventListener('pointerdown', (e) => {
    const at = profileAt(cv, e.clientX, e.clientY);
    const leg = at && legAtDistance(at.d);
    if (!leg) return;
    const w = route().waypoints[leg];
    const g = cv._geom;
    const plotH = g ? g.h - g.padT - g.padB : 100;
    drag = { leg, y0: e.clientY, alt0: parseAlt(w && w.alt) || Math.round(at.alt / 500) * 500, ftPerPx: Math.min(g ? g.top / Math.max(40, plotH) : 50, 50) };  // ≤ 50 ft/px × 0.7 → a 500 ft step every ~14 px
    cv.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  cv.addEventListener('pointermove', (e) => { if (drag) apply(e); });
  const end = () => { if (!drag) return; drag = null; update({ rerenderPanels: true }); };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
}

/* ---------------- Update loop ---------------- */

let saveTimer = null;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 300); }

/* Panel width on wide screens: drag the panel's right edge; remembered */
(function panelResize() {
  const h = document.getElementById('panelResize'); if (!h) return;
  const apply = (w) => { if (w) document.documentElement.style.setProperty('--side-w', `${w}px`); };
  apply(state.view.panelW);
  let start = null;
  h.addEventListener('pointerdown', (e) => { start = { x: e.clientX, w: document.getElementById('sheet').getBoundingClientRect().width }; h.setPointerCapture(e.pointerId); document.body.classList.add('resizing'); });
  h.addEventListener('pointermove', (e) => {
    if (!start) return;
    const w = Math.round(Math.max(360, Math.min(window.innerWidth * 0.7, start.w + e.clientX - start.x)));
    apply(w); state.view.panelW = w;
  });
  const end = () => { if (!start) return; start = null; document.body.classList.remove('resizing'); map.invalidateSize(); scheduleSave(); };
  h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
  h.addEventListener('dblclick', () => { delete state.view.panelW; document.documentElement.style.removeProperty('--side-w'); map.invalidateSize(); scheduleSave(); });
})();

/* ---------------- Undo / redo of route changes (taps, drags, deletes, library, sheet edits, clear) ----------------
 * After every change the routes are compared with the last snapshot; a difference is one undo step.
 * Winds filled in automatically are left out of the comparison (they are refreshed on their own).
 * Switching mission leg or opening another plan starts a fresh history. */
var undoStack = [], redoStack = [], lastSnap = null, lastCtx = null, restoring = false;
function routeSnap() { return JSON.stringify({ main: state.main, alt: state.alt }); }
function snapKey(snap) {
  const o = JSON.parse(snap);
  for (const k of ['main', 'alt']) for (const w of (o[k] && o[k].waypoints) || []) if (w.windSrc !== 'manual') { delete w.wdir; delete w.wspd; delete w.windSrc; }
  return JSON.stringify(o);
}
function trackHistory() {
  const ctx = `${state.mission ? state.mission.active : ''}|${state.planId || ''}`;
  const cur = routeSnap();
  if (ctx !== lastCtx) { undoStack = []; redoStack = []; lastCtx = ctx; lastSnap = cur; return syncUndoButtons(); }
  if (libQuiet) return; // a route being built point by point: one undo step for the whole build
  if (restoring || lastSnap == null) { lastSnap = cur; return syncUndoButtons(); }
  if (snapKey(cur) !== snapKey(lastSnap)) { undoStack.push(lastSnap); if (undoStack.length > 60) undoStack.shift(); redoStack = []; }
  lastSnap = cur;
  syncUndoButtons();
}
function syncUndoButtons() {
  const u = document.getElementById('btnUndo'), r = document.getElementById('btnRedo');
  if (u) u.disabled = !undoStack.length;
  if (r) r.disabled = !redoStack.length;
}
function restoreSnap(snap) {
  const o = JSON.parse(snap);
  restoring = true;
  try { state.main = o.main; state.alt = o.alt; update({ rerenderPanels: true, winds: false }); } finally { restoring = false; }
  lastSnap = snap; syncUndoButtons();
}
function undo() { if (!undoStack.length) return toast('Nothing to undo'); redoStack.push(routeSnap()); restoreSnap(undoStack.pop()); toast('Undone'); }
function redo() { if (!redoStack.length) return toast('Nothing to redo'); undoStack.push(routeSnap()); restoreSnap(redoStack.pop()); toast('Redone'); }
document.getElementById('btnUndo').addEventListener('click', undo);
document.getElementById('btnRedo').addEventListener('click', redo);
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || e.target.matches('input, textarea, select')) return;
  e.preventDefault(); if (e.shiftKey) redo(); else undo();
});

/* Plan status under the callsign: which plan is open and whether it is saved */
var planSavedSnap = null;
function renderPlanStatus() {
  const el = document.getElementById('planStatus'); if (!el) return;
  const dep = endpoint('main', 0)?.icao || state.main.waypoints[0]?.name || '', dest = endpoint('main', -1)?.icao || state.main.waypoints.at(-1)?.name || '';
  const p = state.planId && getPlan(state.planId);
  const ml = state.mission && state.mission.legs.find((l) => l.id === state.mission.active);
  const what = ml ? `Mission · ${esc(ml.label)}` : p ? `Plan “${esc(p.name)}”` : 'Unsaved plan';
  const edited = p && planSavedSnap && planSavedSnap !== routeSnap();
  const saved = p ? (edited ? '<span class="st warn">changed since saved — Plans → Save</span>' : `<span class="st ok">saved ${new Date(p.saved).toTimeString().slice(0, 5)}</span>`) : ml ? '<span class="st ok">kept with the mission</span>' : '<span class="st">kept on this device · Plans → Save to name it</span>';
  el.innerHTML = `${state.main.waypoints.length > 1 ? `<b>${esc(dep)} → ${esc(dest)}</b> · ` : ''}${what} · ${saved}`;
}

function update(opts = {}) {
  result = compute();
  trackHistory();
  renderPlanStatus();
  drawRoutes();
  renderSummary();
  renderMbSummary();
  scheduleTerrain();
  renderTime();
  syncPlanBar();
  stepStatus();
  if (opts.rerenderPanels !== false) renderPanels();
  if (opts.winds !== false) scheduleAutoWinds();
  scheduleSave();
}

/* ---------------- PDF ---------------- */

function saveBlob(bytes, name) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60e3);
}

async function downloadPdf() {
  if (result.main.rows.length === 0) return toast('Add at least two waypoints first.');
  try {
    toast('Building navlog…');
    const sheets = [{ header: headerFor('main'), rows: result.main.rows }];
    if (result.alt.rows.length) sheets.push({ header: headerFor('alt'), rows: result.alt.rows });
    const bytes = await buildNavlogPdf(sheets, planData());
    const h = sheets[0].header;
    const name = `Navlog_${h.dep}-${h.dest}_${flightTime().toISOString().slice(0, 10)}.pdf`;
    saveBlob(bytes, name);
    toast('Navlog PDF ready');
  } catch (err) {
    console.error(err);
    toast('Could not build the PDF: ' + err.message);
  }
}
document.getElementById('btnPdf').addEventListener('click', downloadPdf);

/* ---------------- Sheet (detents) ---------------- */

const sheet = document.getElementById('sheet');
let sheetDetent = 1;
const detents = () => [150, Math.round(window.innerHeight * 0.48), Math.round(window.innerHeight * 0.88)];
function sheetH() { return detents()[sheetDetent]; }
function setDetent(i, animate = true) {
  sheetDetent = Math.max(0, Math.min(2, i));
  if (isWide()) { document.documentElement.style.removeProperty('--sheet-h'); return; }
  sheet.classList.toggle('anim', animate);
  document.documentElement.style.setProperty('--sheet-h', `${sheetH()}px`);
  sheet.style.transform = '';
}
(function sheetDrag() {
  const handles = [document.getElementById('grabber'), document.getElementById('summary')];
  let startY = 0, startH = 0, hist = [], dragging = false, moved = false;
  handles.forEach((hd) => hd.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || isWide()) return;
    dragging = true; moved = false; startY = e.clientY; startH = sheetH(); hist = [[e.clientY, e.timeStamp]];
    hd.setPointerCapture(e.pointerId);
    sheet.classList.remove('anim');
  }));
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 6) moved = true;
    const [min, , max] = [detents()[0], 0, detents()[2]];
    let h = startH - dy;
    if (h > max) h = max + (h - max) * 0.2;
    if (h < min) h = min - (min - h) * 0.2;
    document.documentElement.style.setProperty('--sheet-h', `${h}px`);
    hist.push([e.clientY, e.timeStamp]); if (hist.length > 5) hist.shift();
  });
  window.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    if (!moved) { setDetent(sheetDetent === 0 ? 1 : sheetDetent); return; }
    const [y0, t0] = hist[0];
    const v = -(e.clientY - y0) / Math.max(1, e.timeStamp - t0) * 1000; // px/s upward
    const cur = startH - (e.clientY - startY);
    const d = 0.998;
    const projected = cur + (v / 1000) * d / (1 - d) * 0.35;
    const ds = detents();
    let best = 0; ds.forEach((h, i) => { if (Math.abs(h - projected) < Math.abs(ds[best] - projected)) best = i; });
    setDetent(best);
  });
  window.addEventListener('resize', () => setDetent(sheetDetent, false));
})();

/* ---------------- Misc UI ---------------- */

let toastTimer;
var msgLog = [];
function toast(msg) {
  if (libQuiet) return;
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false; t.classList.remove('ask'); t.onclick = null;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, Math.min(9000, Math.max(2600, String(msg).length * 55)));
  t.onclick = () => { t.hidden = true; clearTimeout(toastTimer); };
  msgLog.unshift({ at: new Date(), msg: String(msg) }); msgLog.length = Math.min(msgLog.length, 15);
  const dot = document.getElementById('btnLog'); if (dot) dot.classList.add('has-new');
}
// A short question in the toast with buttons, e.g. "Add E again" / "Select point 2"
function choice(msg, buttons) {
  const t = document.getElementById('toast');
  t.innerHTML = `<div>${esc(msg)}</div><div class="toast-actions">${buttons.map((b, i) => `<button class="btn small ${i === 0 ? 'primary' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>`;
  t.hidden = false; t.classList.add('ask');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; t.classList.remove('ask'); }, 7000);
  t.onclick = (e) => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    t.hidden = true; t.classList.remove('ask'); t.onclick = null; clearTimeout(toastTimer);
    buttons[+b.dataset.i].run();
  };
}
function haptic() { if (libQuiet) return; if (navigator.vibrate) navigator.vibrate(8); }

// Recent messages (the tips and confirmations that pop up at the top), so none is lost
document.getElementById('btnLog')?.addEventListener('click', () => {
  const pop = document.getElementById('logPop'); if (!pop) return;
  document.getElementById('btnLog').classList.remove('has-new');
  if (!pop.hidden) { pop.hidden = true; return; }
  pop.innerHTML = `<div class="pop-title">Recent messages</div>${msgLog.length ? msgLog.map((m) => `<div class="log-row"><span class="label">${m.at.toTimeString().slice(0, 5)}</span><span>${esc(m.msg)}</span></div>`).join('') : '<div class="pop-note">No messages yet.</div>'}`;
  pop.hidden = false;
});
document.addEventListener('click', (e) => { const pop = document.getElementById('logPop'); if (pop && !pop.hidden && !e.target.closest('#logPop, #btnLog')) pop.hidden = true; });

const layersPop = document.getElementById('layersPop');
document.getElementById('btnLayers').addEventListener('click', (e) => { e.stopPropagation(); layersPop.hidden = !layersPop.hidden; });
document.addEventListener('pointerdown', (e) => { if (!layersPop.hidden && !e.target.closest('#layersPop, #btnLayers')) layersPop.hidden = true; });
document.querySelectorAll('input[name=base]').forEach((r) => r.addEventListener('change', () => {
  if (r.value === 'vfr' && !chartMeta) toast('VFR chart tiles are not available yet.');
  state.view.base = r.value; setBase(r.value); save();
}));
const chkPoints = document.getElementById('chkPoints');
chkPoints.checked = state.view.points;
chkPoints.addEventListener('change', () => { state.view.points = chkPoints.checked; togglePoints(); save(); });
function togglePoints() { if (state.view.points) pointsLayer.addTo(map); else map.removeLayer(pointsLayer); }
const chkNames = document.getElementById('chkNames');
chkNames.checked = state.view.names;
chkNames.addEventListener('change', () => { state.view.names = chkNames.checked; togglePlaces(); save(); });
const chkWinds = document.getElementById('chkWinds');
chkWinds.checked = state.view.winds;
chkWinds.addEventListener('change', () => { state.view.winds = chkWinds.checked; drawRoutes(); save(); });
const chkMarks = document.getElementById('chkMarks');
chkMarks.checked = state.view.marks;
chkMarks.addEventListener('change', () => { state.view.marks = chkMarks.checked; drawRoutes(); save(); });

document.getElementById('btnHome').addEventListener('click', () => {
  if (state.main.waypoints.length > 1) fitRoute();
  else map.flyTo([LEBG.lat, LEBG.lon], 10, { duration: 0.6 });
});

// Save the VFR chart around the route (or Burgos area) for offline use.
document.getElementById('btnOffline').addEventListener('click', async () => {
  const own = state.view.base !== 'vfr' && ownMeta;
  if (!own && !chartMeta) return toast('VFR chart tiles are not available yet.');
  const all = [...state.main.waypoints, ...state.alt.waypoints];
  const ml = state.mission && state.mission.legs.find((l) => l.id === state.mission.active);
  const tgt = ml && ml.target && adByIcao(ml.target);
  if (tgt) all.push({ lat: tgt.lat, lon: tgt.lon });
  let b = all.length ? L.latLngBounds(all.map((w) => [w.lat, w.lon])) : L.latLngBounds([[LEBG.lat, LEBG.lon], [LEBG.lat, LEBG.lon]]);
  b = b.pad(0.3);
  const pad = 0.4; // ~25 NM margin
  b = L.latLngBounds([b.getSouth() - pad, b.getWest() - pad], [b.getNorth() + pad, b.getEast() + pad]);
  const urls = [];
  const z0 = own ? (ownMeta.zmin || 7) : 6, z1 = own ? Math.min(12, ownMeta.zmax || 12) : 12;
  for (let z = z0; z <= z1; z++) {
    const p1 = map.project(b.getNorthWest(), z).divideBy(256).floor();
    const p2 = map.project(b.getSouthEast(), z).divideBy(256).floor();
    for (let x = p1.x; x <= p2.x; x++) for (let y = p1.y; y <= p2.y; y++) urls.push(`${own ? 'chart' : 'tiles'}/${z}/${x}/${y}.webp`);
  }
  layersPop.hidden = true;
  let done = 0;
  // the data the planner needs offline too (obstacles, names, AIP)
  try { const c = await caches.open(SHELL_CACHE_NAME()); await Promise.all(OFFLINE_DATA.map(async (u) => { try { const r = await fetch(u, { cache: 'no-cache' }); if (r.ok) await c.put(u, r); } catch { /* offline */ } })); } catch { /* no cache storage */ }
  state.view.offlineBox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), own ? 'chart' : 'tiles']; scheduleSave();
  const cache = await caches.open(own ? 'navlog-ownchart-v1' : 'navlog-tiles-v1');
  const queue = [...urls];
  async function worker() {
    while (queue.length) {
      const u = queue.shift();
      try { if (!(await cache.match(u))) { const r = await fetch(u); if (r.ok) await cache.put(u, r); } } catch { /* missing tile at chart edge */ }
      done++; if (done % 50 === 0) toast(`Saving chart… ${Math.round((done / urls.length) * 100)} %`);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  toast(`Chart saved for offline (${urls.length} tiles)`);
  if (state.mode === 'settings') renderSettings();
});

/* ---------------- Mission (Phase 3 / solo manual) ----------------
 * Solo flights manual, mandatory documents:
 *   LOCAL NAVIGATION: 1 M&B · 2 NAV LOGS (one prepared + a reserve one), each with its alternate
 *   CROSS-COUNTRY: 2 M&B (1 for each flight) · 2 NAV LOGS (1 for each flight), 2 AIRPORTS PLANNED, TOTAL 4 NAV LOGS
 *   TRIANGULAR: 300 NM in total, two airports plus the base, two different trips prepared, destinations
 *               previously visited with an instructor, latest departure time (closure / sunset).
 * Company alternate policy (Phase 3): one FlyBy base is always one of the alternates (LEBG ↔ LERJ).
 * Cross-countries are flown without refuelling; triangular legs may refuel where AVGAS 100LL is available.
 */
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
let legSwap = false; // true while a leg other than the open one is being computed

function syncActiveLeg() {
  const m = state.mission;
  if (!m || !m.active || legSwap) return;
  const leg = m.legs.find((l) => l.id === m.active);
  if (!leg) return;
  leg.main = clone(state.main); leg.time = state.time; leg.callsign = state.flight.callsign;
  if (m.type === 'local') m.sharedAlt = clone(state.alt); else leg.alt = clone(state.alt);
  if (legChainIndex(leg) === 0) leg.fob = +state.flight.fob || 0;
}
const legsOfChain = (leg) => state.mission.legs.filter((l) => l.chain === leg.chain);
const legChainIndex = (leg) => legsOfChain(leg).indexOf(leg);

// Run fn with a leg loaded into the planner (state + result), then put everything back.
function withLeg(leg, fobL, fn) {
  const keep = { main: state.main, alt: state.alt, time: state.time, fob: state.flight.fob, result, active: state.active, callsign: state.flight.callsign };
  legSwap = true;
  try {
    state.main = clone(leg.main); state.alt = clone(state.mission.type === 'local' ? state.mission.sharedAlt : leg.alt) || { waypoints: [], stdDep: false, stdArr: false };
    state.time = leg.time; state.flight.fob = fobL; state.active = 'main'; state.flight.callsign = leg.callsign || keep.callsign; keep.carried = state.flight.carried; state.flight.carried = true;
    result = compute();
    return fn();
  } finally {
    Object.assign(state, { main: keep.main, alt: keep.alt, time: keep.time, active: keep.active }); state.flight.fob = keep.fob; state.flight.carried = keep.carried; state.flight.callsign = keep.callsign; result = keep.result;
    legSwap = false;
  }
}

/** Every leg's figures, with the fuel carried from leg to leg (refuel → full tanks). */
function missionFigures() {
  const m = state.mission, out = new Map();
  const cap = acOf(state.flight.type).fuelMaxL;
  for (const leg of m.legs) {
    const i = legChainIndex(leg);
    const prev = i > 0 ? out.get(legsOfChain(leg)[i - 1].id) : null;
    const depIcao = leg.main && leg.main.waypoints[0] && (leg.main.waypoints[0].ref || leg.main.waypoints[0].name);
    const canRefuel = leg.refuel && !NO_REFUEL.includes(depIcao); // no AVGAS there (AIP AD 2.4)
    const fob = i === 0 ? (+leg.fob || +state.flight.fob || 0) : canRefuel ? cap : prev ? Math.max(0, prev.remaining) : 0;
    const fig = withLeg(leg, fob, () => {
      const t = flightTime();
      const dep = endpoint('main', 0), dest = endpoint('main', -1), alt = endpoint('alt', -1);
      const ldg = new Date(t.getTime() + result.main.totals.timeSec * 1000);
      return {
        fob, dep, dest, alt, t, ldg, dist: result.main.totals.dist, timeSec: result.main.totals.timeSec, trip: result.main.totals.trip,
        required: result.fuel.required, fuelOk: result.fuel.checks.every((c) => c.ok), mbOk: result.mb ? result.mb.ok : null,
        remaining: fob - (+state.flight.taxi || 0) - result.main.totals.trip,
        issues: planIssues().filter((x) => x.level === 'bad').map((x) => x.text),
      };
    });
    out.set(leg.id, fig);
  }
  return out;
}

function newLeg(label, chain, dep, dest, time, extra = {}) {
  const A = adByIcao(dep), B = adByIcao(dest);
  const alt = B && (dest === 'LEBG' ? 'LERJ' : dest === 'LERJ' ? 'LEBG' : 'LEBG');
  const altAd = alt && adByIcao(alt);
  return {
    id: `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, label, chain, time,
    // only the departure: the destination is a target shown as a dotted guide until you plan the leg
    main: { waypoints: [A].filter(Boolean).map(adWaypoint), stdDep: true, stdArr: true },
    alt: { waypoints: [], stdDep: false, stdArr: true },
    target: dest, altTarget: altAd ? altAd.icao : null,
    refuel: false, ...extra,
  };
}

function createMission(type, d) {
  syncActiveLeg();
  const base = d.base || 'LEBG';
  const t0 = state.time || new Date().toISOString();
  const later = (min) => new Date(new Date(t0).getTime() + min * 60e3).toISOString();
  const m = { type, legs: [], active: null, created: new Date().toISOString() };
  if (type === 'local') {
    m.legs.push(newLeg('Nav 1 · local', 'n1', base, base, t0));
    m.legs.push(newLeg('Nav 2 · reserve local', 'n2', base, base, t0));
    m.sharedAlt = { waypoints: [], stdDep: false, stdArr: true };
  } else if (type === 'xc') {
    m.legs.push(newLeg(`Outbound · ${base} → ${d.dest}`, 'a', base, d.dest, t0));
    m.legs.push(newLeg(`Inbound · ${d.dest} → ${base}`, 'a', d.dest, base, later(120)));
    m.legs.push(newLeg(`Reserve outbound · ${base} → ${d.reserve}`, 'b', base, d.reserve, t0));
    m.legs.push(newLeg(`Reserve inbound · ${d.reserve} → ${base}`, 'b', d.reserve, base, later(120)));
    // plus a local nav with its own alternate, in case the cross-country cannot be flown
    m.legs.push(newLeg(`Local nav · ${base}`, 'l', base, base, t0));
  } else {
    const trip = (chain, a, b, name) => {
      m.legs.push(newLeg(`${name} leg 1 · ${base} → ${a}`, chain, base, a, t0));
      m.legs.push(newLeg(`${name} leg 2 · ${a} → ${b}`, chain, a, b, later(120)));
      m.legs.push(newLeg(`${name} leg 3 · ${b} → ${base}`, chain, b, base, later(240)));
    };
    trip('a', d.a1, d.a2, 'Trip A');
    trip('b', d.b1, d.b2, 'Trip B');
  }
  m.legs.forEach((l, i) => { if (i === 0 || legChainIndexIn(m, l) === 0) l.fob = +state.flight.fob || acOf(state.flight.type).fuelMaxL; });
  assignCallsigns(m, d.callsign);
  state.mission = m;
  openLeg(m.legs[0].id, true);
  state.mode = 'mission'; showPanels(); renderPanels();
}
// Callsigns: FBYxxY — xx instructor number, Y the time-of-day letter. Outbound and inbound differ
// only in the last letter (FBY12A out → FBY12B in). Solo flights use the assigned solo callsigns
// from Settings. Every leg stays editable.
const nextCallsign = (cs, n = 1) => {
  const m = /^(.*?)([A-Y])$/i.exec(cs || '');
  if (!m || n <= 0) return cs || '';
  const c = String.fromCharCode(Math.min(90, m[2].toUpperCase().charCodeAt(0) + n));
  return m[1] + c;
};
function assignCallsigns(m, typed) {
  const st = state.settings || {};
  const solo = state.flight.solo && st.soloOut && (!typed || typed === st.soloOut.toUpperCase());
  const out = (typed || (solo ? st.soloOut : st.callsign || state.flight.callsign || '')).toUpperCase();
  const inb = solo ? (st.soloIn || nextCallsign(st.soloOut)).toUpperCase() : null;
  for (const l of m.legs) {
    const i = legChainIndexIn(m, l);
    l.callsign = i === 0 ? out : inb && m.type !== 'tri' ? inb : nextCallsign(out, i);
    l.callsignAuto = i > 0;
  }
}
const legPlanned = (l) => (l.main.waypoints || []).length >= 2 && (!l.target || l.main.waypoints.at(-1).ref === l.target);
const legChainIndexIn = (m, leg) => m.legs.filter((l) => l.chain === leg.chain).indexOf(leg);

function openLeg(id, quiet) {
  syncActiveLeg();
  const m = state.mission, leg = m.legs.find((l) => l.id === id);
  if (!leg) return;
  const figs = legChainIndex(leg) > 0 ? missionFigures() : null;
  m.active = id;
  state.main = clone(leg.main);
  state.alt = clone(m.type === 'local' ? m.sharedAlt : leg.alt) || { waypoints: [], stdDep: false, stdArr: false };
  state.time = leg.time; state.active = 'main';
  state.flight.fob = figs ? Math.round(figs.get(id).fob * 10) / 10 : +leg.fob || state.flight.fob;
  if (leg.callsign) { state.flight.callsign = leg.callsign; }
  state.flight.carried = !!figs; // later legs carry the fuel left (no full tanks, e.g. LERJ → LEBG on a cross-country)
  syncSlider();
  if (!quiet) { state.mode = 'plan'; tab = 'route'; showPanels(); toast(`Editing ${leg.label}`); }
  update({ rerenderPanels: true });
  setTimeout(fitRoute, 50);
}

const MS_TYPES = [
  { v: 'single', t: 'Single flight', d: 'One navigation with its alternate — plan it straight away.' },
  { v: 'local', t: 'Local navigation', d: '2 navlogs (one + a reserve) sharing an alternate, 1 M&B.' },
  { v: 'xc', t: 'Cross-country', d: 'Outbound + inbound, the same for a reserve airport, plus a local nav — each with its alternate.' },
  { v: 'tri', t: 'Triangular', d: 'Two trips of three legs (two airports + base), 300 NM each.' },
];
let msTypeSel = 'local';
function missionFormHtml(replace) {
  const opts = (sel) => APPROVED.map((ad) => `<option ${ad === sel ? 'selected' : ''}>${ad}</option>`).join('');
  return `<div class="type-cards">${MS_TYPES.map((x) => `<button type="button" class="type-card${x.v === msTypeSel ? ' on' : ''}" data-mstype="${x.v}"><b>${x.t}</b><span>${x.d}</span></button>`).join('')}</div>
    <select id="msType" hidden>${MS_TYPES.filter((x) => x.v !== 'single').map((x) => `<option value="${x.v}" ${x.v === msTypeSel ? 'selected' : ''}>${x.t}</option>`).join('')}</select>
    <div id="msForm" ${msTypeSel === 'single' ? 'hidden' : ''}>
    <div class="row wrap">
      <label class="field narrow"><span>Base</span><select id="msBase">${['LEBG', 'LERJ'].map((x) => `<option>${x}</option>`).join('')}</select></label>
      <label class="field"><span>Callsign (outbound)</span><input id="msCallsign" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="FBY12A" value="${esc((state.flight.solo && state.settings.soloOut) || state.settings.callsign || state.flight.callsign || '')}"></label>
    </div>
    <div class="row wrap" id="msXc" hidden>
      <label class="field"><span>Destination</span><select id="msDest">${opts('LEVT')}</select></label>
      <label class="field"><span>Reserve</span><select id="msRes">${opts('LEVD')}</select></label>
    </div>
    <div class="row wrap" id="msTri" hidden>
      <label class="field"><span>Trip A · 1st</span><select id="msA1">${opts('LEVD')}</select></label>
      <label class="field"><span>Trip A · 2nd</span><select id="msA2">${opts('LELN')}</select></label>
      <label class="field"><span>Trip B · 1st</span><select id="msB1">${opts('LEVT')}</select></label>
      <label class="field"><span>Trip B · 2nd</span><select id="msB2">${opts('LEPP')}</select></label>
    </div>
    <div class="row"><span class="grow label">The inbound callsign is worked out from the outbound one (FBY12A → FBY12B); solo flights use your solo callsigns from Settings. Each leg can be changed afterwards.</span></div>
    <button class="btn primary wide" data-act="msCreate">${replace ? 'Replace the mission' : 'Create mission'}</button>
    </div>
    <div id="msSingle" ${msTypeSel === 'single' ? '' : 'hidden'}><button class="btn primary wide" data-act="msSingle">Plan a single flight →</button></div>`;
}

const HOWTO = `<div class="howto">
  <div><span class="n" style="--c: var(--c-mission)">1</span><b>Mission</b> choose what you are flying</div>
  <div><span class="n" style="--c: var(--c-plan)">2</span><b>Plan</b> tap your points on the chart — main route, then the alternate</div>
  <div><span class="n" style="--c: var(--c-mb)">3</span><b>M&amp;B</b> masses, fuel and performance on the school's sheet</div>
  <div><span class="n" style="--c: var(--c-brief)">4</span><b>Briefing</b> add the ICARO NOTAM bulletin, check the go/no-go, download the PDF</div>
</div>`;

function renderMission() {
  syncActiveLeg();
  const m = state.mission;
  if (!m) {
    panels.mission.innerHTML = `${result.main.rows.length ? '' : HOWTO}<div class="group-title"><span>What are you flying?</span></div><div class="group pad">${missionFormHtml(false)}</div>
      <p class="note">A mission keeps every navlog, alternate and M&amp;B of the flight together and downloads them as one PDF. Your name, signature, callsigns and unlocked aerodromes are in Settings (⚙︎).</p>`;
    return wireMissionForm();
  }
  const figs = missionFigures();
  const names = { local: 'Local navigation', xc: 'Cross-country', tri: 'Triangular' };
  let html = `<div class="group-title"><span>${names[m.type]} · ${m.legs.length} navlogs</span></div><div class="group">`;
  m.legs.forEach((leg, n) => {
    const f = figs.get(leg.id), i = legChainIndex(leg);
    const planned = legPlanned(leg);
    const ok = planned && f.fuelOk && f.mbOk !== false && !f.issues.length;
    html += `<div class="wx leg-card${leg.id === m.active ? ' active' : ''}"><div class="wx-head"><span class="leg-no">${n + 1}</span><b>${esc(leg.label)}</b><span class="grow"></span><span class="badge ${ok ? 'ok' : planned ? 'bad' : 'warn'}">${ok ? 'OK' : planned ? 'CHECK' : 'TO PLAN'}</span></div>
      ${planned ? `<div class="label">${f.dep?.icao || '?'} → ${f.dest?.icao || '?'}${f.alt ? ` · alt ${f.alt.icao}` : leg.altTarget ? ` · alt ${leg.altTarget} (to plan)` : ''} · ${f.dist} NM · ${fmtHMS(f.timeSec).slice(0, 5)} · T/O ${zl(f.t)} → LDG ${zl(f.ldg)}</div>
      <div class="label">FOB ${f.fob.toFixed(1)} L${i > 0 ? (leg.refuel ? ' (refuel: full tanks)' : ' (carried from the previous leg)') : ''} · trip ${f.trip.toFixed(1)} L · minimum ${f.required} L ${f.fuelOk ? '✓' : '✕'} · M&amp;B ${f.mbOk == null ? '—' : f.mbOk ? '✓' : '✕'}</div>`
    : `<div class="label">→ ${esc(leg.target || '')} · open it and tap your points; the dotted line on the chart is only a guide.</div>`}
      ${f.issues.length ? `<div class="label warn">${f.issues.map(esc).join('<br>')}</div>` : ''}
      <div class="row leg-actions"><label class="field cs"><span>Callsign</span><input data-lcs="${leg.id}" value="${esc(leg.callsign || '')}" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="FBY12A"></label>
      ${i > 0 && m.type === 'tri' ? `<label class="tem-row refuel"><input type="checkbox" data-refuel="${leg.id}" ${leg.refuel ? 'checked' : ''}><span>Refuel at ${f.dep?.icao || ''}${f.dep && NO_REFUEL.includes(f.dep.icao) ? ' — no AVGAS (AIP)' : ''}</span></label>` : '<span class="grow"></span>'}
      <button class="btn small ${leg.id === m.active ? '' : 'primary'}" data-open="${leg.id}">${leg.id === m.active ? 'Plan ›' : 'Open ›'}</button></div></div>`;
  });
  html += '</div>';
  html += `<div class="group-title"><span>Mission checks</span></div><div class="group">${missionChecks(figs).map((c) => `<div class="row ${c.ok ? 'check-ok' : 'check-bad'}"><span class="grow label">${esc(c.text)}</span><span class="value">${c.ok ? 'OK' : '✕'}</span></div>`).join('')}</div>
    <button class="btn primary wide next-step" data-goto="plan" style="--c: var(--c-plan)">Next · 2 Plan the open leg →</button>
    <p class="note">Open a leg to plan it on the chart — it is saved back into the mission automatically. ${m.type === 'local' ? 'Both local navlogs share one alternate. ' : 'Every navlog has its own alternate. '}Set each leg's time with the time slider while it is open. Later legs carry the fuel left from the previous one.</p>
    <details class="group options"><summary>Start a different mission</summary><div class="pad">${missionFormHtml(true)}</div></details>`;
  panels.mission.innerHTML = html;
  wireMissionForm();
}
function wireMissionForm() {
  const sel = panels.mission.querySelector('#msType');
  if (!sel) return;
  const sync = () => {
    panels.mission.querySelector('#msXc').hidden = msTypeSel !== 'xc';
    panels.mission.querySelector('#msTri').hidden = msTypeSel !== 'tri';
    panels.mission.querySelector('#msForm').hidden = msTypeSel === 'single';
    panels.mission.querySelector('#msSingle').hidden = msTypeSel !== 'single';
    panels.mission.querySelectorAll('[data-mstype]').forEach((b) => b.classList.toggle('on', b.dataset.mstype === msTypeSel));
    if (msTypeSel !== 'single') sel.value = msTypeSel;
  };
  sync();
  panels.mission.querySelectorAll('[data-mstype]').forEach((b) => b.addEventListener('click', () => { msTypeSel = b.dataset.mstype; sync(); }));
}

function missionChecks(figs) {
  const m = state.mission, out = [];
  const legs = m.legs.map((l) => ({ l, f: figs.get(l.id) }));
  const ads = (fs) => [...new Set(fs.flatMap(({ f }) => [f.dep?.icao, f.dest?.icao]).filter(Boolean))];
  if (m.type === 'local') {
    out.push({ ok: legs.length >= 2 && legs.every(({ l }) => legPlanned(l)), text: 'Local navigation: 2 nav logs (one prepared + a reserve one), both planned' });
    out.push({ ok: !!(m.sharedAlt && m.sharedAlt.waypoints.length > 1), text: 'Alternate planned for the local navigations (company alternate policy)' });
    out.push({ ok: true, text: 'M&B: 1 for the local navigation' });
  }
  if (m.type === 'xc') {
    out.push({ ok: legs.length >= 5 && legs.every(({ l }) => legPlanned(l)), text: 'Cross-country: 2 nav logs (1 per flight) + 2 for the reserve airport + 1 local nav = 5 nav logs, all planned' });
    out.push({ ok: legs.every(({ f }) => f.alt), text: 'Every navigation planned with its alternate (one FlyBy base among the alternates)' });
    out.push({ ok: true, text: 'M&B: 1 for each flight (included in the download)' });
  }
  if (m.type === 'tri') {
    for (const ch of ['a', 'b']) {
      const tl = legs.filter(({ l }) => l.chain === ch);
      const nm = Math.round(tl.reduce((t, { f }) => t + f.dist, 0));
      out.push({ ok: nm >= 300, text: `Trip ${ch.toUpperCase()}: ${nm} NM in total (must cover 300 NM)` });
      const visited = ads(tl).filter((x) => x !== 'LEBG' && x !== 'LERJ');
      out.push({ ok: visited.length >= 2, text: `Trip ${ch.toUpperCase()}: two airports plus the base (${visited.join(', ') || '—'})` });
    }
    const a = ads(legs.filter(({ l }) => l.chain === 'a')).sort().join(), b = ads(legs.filter(({ l }) => l.chain === 'b')).sort().join();
    out.push({ ok: a !== b, text: 'Two different trips prepared' });
  }
  const notVisited = ads(legs).filter((x) => !state.unlocked.includes(x));
  out.push({ ok: !notVisited.length, text: notVisited.length ? `Not yet visited with an instructor: ${notVisited.join(', ')} (solo: destinations must have been flown with an FI)` : 'All aerodromes already visited with an instructor (unlocked list)' });
  // latest departure: every leg lands before closure / sunset
  for (const { l, f } of legs) {
    if (!f.dest) continue;
    const open = aerodromeOpen(f.dest.icao, f.ldg);
    const sun = sunTimes(f.ldg, f.dest.lat, f.dest.lon);
    if ((open.known && !open.open) || (sun.set && f.ldg > sun.set)) out.push({ ok: false, text: `${l.label}: landing ${zl(f.ldg)} after ${open.known && !open.open ? 'closure' : 'sunset'} — depart earlier` });
  }
  return out;
}

panels.mission.addEventListener('click', async (e) => {
  const o = e.target.closest('[data-open]');
  if (o) return openLeg(o.dataset.open);
  if (e.target.closest('[data-act=msCreate]')) {
    const v = (id) => panels.mission.querySelector(id)?.value;
    if (state.mission && !confirm('Replace the current mission? Its legs will be lost (save it under Plans first if needed).')) return;
    return createMission(v('#msType'), { base: v('#msBase'), dest: v('#msDest'), reserve: v('#msRes'), a1: v('#msA1'), a2: v('#msA2'), b1: v('#msB1'), b2: v('#msB2'), callsign: (v('#msCallsign') || '').toUpperCase().trim() });
  }
  if (e.target.closest('[data-act=msSingle]')) {
    if (state.mission && !confirm('Leave the current mission and plan a single flight? (Save it under Plans first if needed.)')) return;
    syncActiveLeg(); state.mission = null; state.missionSkipped = true;
    if (!state.flight.callsign) state.flight.callsign = ((state.flight.solo && state.settings.soloOut) || state.settings.callsign || '').toUpperCase();
    return goStep('plan');
  }
  if (e.target.closest('[data-act=msPdf]')) return downloadBriefing();
});
panels.mission.addEventListener('change', (e) => {
  const lcs = e.target.dataset.lcs;
  if (lcs) {
    const m = state.mission, leg = m.legs.find((l) => l.id === lcs);
    leg.callsign = e.target.value.toUpperCase().trim(); leg.callsignAuto = false;
    // the first leg of a trip sets the later ones that were not changed by hand (FBY12A → FBY12B)
    if (legChainIndex(leg) === 0) legsOfChain(leg).slice(1).forEach((l, k) => { if (l.callsignAuto !== false) l.callsign = nextCallsign(leg.callsign, k + 1); });
    if (leg.id === m.active) { state.flight.callsign = leg.callsign; syncPlanBar(); }
    save(); return renderMission();
  }
  const r = e.target.dataset.refuel;
  if (!r) return;
  const leg = state.mission.legs.find((l) => l.id === r);
  leg.refuel = e.target.checked; save(); renderMission();
});

async function downloadMission() {
  const m = state.mission;
  if (!m) return;
  syncActiveLeg();
  const { PDFDocument } = window.PDFLib;
  toast('Building the mission PDF…');
  try {
    const out = await PDFDocument.create();
    const add = async (bytes) => { const d = await PDFDocument.load(bytes); (await out.copyPages(d, d.getPageIndices())).forEach((p) => out.addPage(p)); };
    const figs = missionFigures();
    const mbDone = new Set();
    for (const leg of m.legs) {
      const f = figs.get(leg.id);
      // navlog (+ its alternate)
      const navBytes = await withLeg(leg, f.fob, () => {
        const sheets = [{ header: headerFor('main'), rows: result.main.rows }];
        if (result.alt.rows.length) sheets.push({ header: headerFor('alt'), rows: result.alt.rows });
        return result.main.rows.length ? buildNavlogPdf(sheets) : null;
      });
      if (navBytes) await add(await navBytes);
      // M&B: 1 for a local navigation, 1 per flight otherwise (reserve flights included)
      const key = m.type === 'local' ? 'local' : leg.id;
      if (!mbDone.has(key)) {
        mbDone.add(key);
        const mbBytes = withLeg(leg, f.fob, () => (result.mb ? buildMbPdf(result.mb, {
          date: flightTime().toLocaleDateString('en-GB'), reg: state.flight.reg, studentCode: state.mb.studentCode, signature: state.settings.signature,
          weather: effWeather(state.flight.weather), notams: effNotams(state.mb.notams), perf: perfResults(),
        }) : null));
        if (mbBytes) await add(await mbBytes);
      }
    }
    if (!out.getPageCount()) return toast('Plan at least one leg first.');
    embedPlan(out, planData());
    const names = { local: 'Local', xc: 'XC', tri: 'Triangular' };
    saveBlob(await out.save(), `Mission_${names[m.type]}_${flightTime().toISOString().slice(0, 10)}.pdf`);
    toast('Mission PDF ready');
  } catch (err) { console.error(err); toast('Could not build the mission PDF: ' + err.message); }
}

/* ---------------- One download: briefing + navlogs + M&B (Briefing List) ---------------- */

function legPack(fob) {
  // Everything for the flight currently loaded in the planner (real or swapped-in leg).
  const B = briefingData();
  const f = state.flight, t = flightTime();
  const tot = result.main.totals;
  const meta = {
    title: `Briefing · ${B.dep?.icao || '?'} -> ${B.dest?.icao || '?'} · ${t.toLocaleDateString('en-GB')} · ${f.callsign || ''}`,
    flightLine: `${f.callsign || 'Callsign —'} · ${fleetType(f.type).name} ${f.reg || ''} · T/O ${zl(t)} · LDG ${zl(B.ldg)} · ${tot.dist} NM · ${fmtHMS(tot.timeSec)} · trip ${tot.trip} L · FOB ${fob ?? f.fob} L${f.solo ? ' · SOLO' : ''}`,
    notams: effNotams(state.mb.notams), rows: result.main.rows, tem: state.tem, zl, metarSummary, mmss: fmtMMSS,
    totals: `${tot.dist} NM · ${fmtHMS(tot.timeSec)} · ${tot.trip} L`,
  };
  const sheets = [{ header: headerFor('main'), rows: result.main.rows }];
  if (result.alt.rows.length) sheets.push({ header: headerFor('alt'), rows: result.alt.rows });
  const mbArgs = result.mb ? [result.mb, { date: t.toLocaleDateString('en-GB'), reg: f.reg, studentCode: state.mb.studentCode, signature: state.settings.signature, weather: effWeather(f.weather), notams: effNotams(state.mb.notams), perf: B.perf }] : null;
  const routes = [{ wps: clone(state.main.waypoints), rows: clone(result.main.rows), color: '#d1009a' }];
  if (state.alt.waypoints.length > 1) routes.push({ wps: clone(state.alt.waypoints), rows: clone(result.alt.rows), color: '#0a84ff', alt: true });
  const mapData = state.main.waypoints.length > 1 ? { routes, title: `${B.dep?.icao || ''} -> ${B.dest?.icao || ''}${B.alt ? ` (alternate ${B.alt.icao})` : ''}` } : null;
  const cruise = parseAlt(result.main.rows.find((r) => r.phase === 'cruise')?.alt) || 5500;
  return { B, meta, sheets: result.main.rows.length ? sheets : null, mbArgs, mapData, charts: aemetCharts(t, cruise) };
}

// Separate PDFs made by "Separate files": kept until the next build so they can be saved in one go
let sepFiles = null;
async function saveAllSeparate() {
  if (!sepFiles || !sepFiles.length) return;
  const files = sepFiles.map((f) => new File([f.blob], f.name, { type: 'application/pdf' }));
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
  }
  for (const f of sepFiles) { saveBlob(f.blob, f.name); await new Promise((r) => setTimeout(r, 700)); }
}
async function downloadBriefing(separate = false) {
  const { PDFDocument } = window.PDFLib;
  syncActiveLeg();
  const m = state.mission;
  toast(separate ? 'Building the separate files…' : m ? 'Building the mission briefing…' : 'Building the briefing…');
  // weather for every aerodrome of the flight(s), not only the open route
  const ads = new Set();
  const collect = () => [endpoint('main', 0), endpoint('main', -1), endpoint('alt', -1)].filter(Boolean).forEach((a) => ads.add(a.icao));
  if (m) { const figs0 = missionFigures(); m.legs.forEach((l) => withLeg(l, figs0.get(l.id).fob, collect)); } else collect();
  const keepWx = wxState;
  try {
    const extra = separate ? null : await fetchWeather([...ads]).catch(() => null);
    if (extra) wxState = { ...wxState, data: { ...(wxState.data || {}), ...extra } };
    const out = await PDFDocument.create();
    const F = await pdfFonts(out);
    const add = async (bytes) => { const d = await PDFDocument.load(bytes); (await out.copyPages(d, d.getPageIndices())).forEach((p) => out.addPage(p)); };
    const packs = [];
    if (m) {
      const figs = missionFigures();
      const names = { local: 'Local navigation', xc: 'Cross-country', tri: 'Triangular' };
      addMissionCover(out, F, {
        title: `Mission briefing · ${names[m.type]}`,
        lines: [`${names[m.type]} · ${state.flight.callsign || ''} · ${fleetType(state.flight.type).name} ${state.flight.reg || ''}`, `${flightTime().toLocaleDateString('en-GB')} · student ${state.mb.studentCode || '—'}`],
        legs: m.legs.map((l) => { const f = figs.get(l.id); const ok = f.fuelOk && f.mbOk !== false && !f.issues.length && legPlanned(l);
          return { label: l.label, ok, status: ok ? 'OK' : 'CHECK', detail: `${f.dep?.icao || '?'} -> ${f.dest?.icao || '?'}${f.alt ? ` (alt ${f.alt.icao})` : ''} · ${f.dist} NM · T/O ${zl(f.t)} · LDG ${zl(f.ldg)} · FOB ${f.fob.toFixed(1)} L · trip ${f.trip.toFixed(1)} L · minimum ${f.required} L${f.issues.length ? ' · ' + f.issues.join('; ') : ''}` }; }),
        checks: missionChecks(figs),
      });
      const mbDone = new Set();
      for (const l of m.legs) {
        const f = figs.get(l.id);
        const p = withLeg(l, f.fob, () => legPack(f.fob));
        p.label = l.label;
        p.withMb = !mbDone.has(m.type === 'local' ? 'local' : l.id);
        mbDone.add(m.type === 'local' ? 'local' : l.id);
        packs.push(p);
      }
    } else {
      const p = legPack(); p.withMb = true; packs.push(p);
    }
    if (separate) {
      // one PDF per document, as the school's platform wants them: navlog, alternate navlog, M&B
      const files = [];
      const safe = (t) => String(t || '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '');
      const d0 = flightTime().toISOString().slice(0, 10);
      for (const p of packs) {
        const pre = p.label ? `${safe(p.label)}_` : '';
        const dep = p.B.dep?.icao || '', dest = p.B.dest?.icao || '', alt = p.B.alt?.icao || '';
        if (p.sheets) {
          files.push({ name: `${pre}Navlog_${dep}-${dest}_${d0}.pdf`, bytes: await buildNavlogPdf([p.sheets[0]]) });
          if (p.sheets[1]) files.push({ name: `${pre}Alternate_${dest}-${alt}_${d0}.pdf`, bytes: await buildNavlogPdf([p.sheets[1]]) });
        }
        if (p.withMb && p.mbArgs) files.push({ name: `${m && m.type === 'local' ? '' : pre}MB_${state.flight.reg || ''}_${d0}.pdf`, bytes: await buildMbPdf(...p.mbArgs) });
      }
      if (!files.length) { toast('Nothing to export yet — plan the route first'); return; }
      sepFiles = files.map((f) => ({ name: f.name, blob: new Blob([f.bytes], { type: 'application/pdf' }) }));
      sepFiles.made = zl(new Date());
      update({ rerenderPanels: true });
      setTimeout(() => document.getElementById('sepFiles')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      toast(`${files.length} files ready — tap “Save all”`);
      return;
    }
    let bulletinAdded = false, chartsMissing = false;
    const once = new Set(); // the surface analysis and the student's own charts go in once per PDF
    const addBulletinPages = async () => { if (bulletin && !bulletinAdded) { bulletinAdded = true; await add(b64ToBytes(bulletin.b64)); } };
    const chartPage = async (c) => {
      try {
        const img = c.jpg ? await out.embedJpg(c.bytes) : await out.embedPng(c.bytes);
        const pg = out.addPage([841.89, 595.28]);
        const k = Math.min(801 / img.width, 540 / img.height);
        pg.drawImage(img, { x: (841.89 - img.width * k) / 2, y: 18, width: img.width * k, height: img.height * k });
        pg.drawText(pdfText(c.title), { x: 20, y: 570, size: 11, font: F.bold });
        return true;
      } catch { chartsMissing = true; return false; }
    };
    for (const p of packs) {
      // Briefing List 1A–1C: gather the charts first so the weather part can say what is attached
      const charts = [], att = {};
      const sf = await loadSurface();
      if (sf && sf.png) { att.A = `attached · ${sf.label.replace(/^Surface pressure analysis · /, '')}`; if (!once.has('surface')) charts.push({ key: 'surface', title: `1A · ${sf.label}`, bytes: sf.png }); }
      else { att.A = null; chartsMissing = true; }
      for (const [kind, key] of [['sigwx', 'B'], ['wind', 'C']]) {
        const u = wxUploads[kind], c = p.charts && p.charts[kind];
        if (u) {
          att[key] = `attached · your chart, added ${zl(new Date(u.added))}`;
          if (!once.has(kind)) charts.push({ key: kind, title: `1${key} · ${WXUP_NAME[kind]} · AEMET · added ${zl(new Date(u.added))}`, bytes: b64ToBytes(u.b64), jpg: true });
          continue;
        }
        const bytes = c ? await fetchChartBytes(c) : null;
        if (bytes) { att[key] = `attached · ${c.label}`; charts.push({ title: `1${key} · ${c.label} · AEMET`, bytes }); }
        else { att[key] = null; chartsMissing = true; }
      }
      p.meta.wxAttach = att;
      addBriefingPages(out, F, p.B, p.meta);
      for (const c of charts) if (await chartPage(c) && c.key) once.add(c.key);
      await addBulletinPages(); // 2 · NOTAMs
      if (p.mapData) {
        const img = await renderRouteMap(p.mapData.routes, { title: p.mapData.title, aviation: ownMeta && state.view.base !== 'vfr' ? { list: CHART_AS, labels: AS_LABELS, ama: AMA_CELLS, navaids: NAVAIDS, obstacles: OBSTACLES, places: state.view.names ? placesData : [], varAt: defaultVar } : null });
        if (img) await addMapPage(out, img, pdfText(`Marked chart · ${p.mapData.title} · 2-min marks at planned GS · HAT = heading, altitude, time`));
      }
      if (p.sheets) await add(await buildNavlogPdf(p.sheets));
      if (p.withMb && p.mbArgs) await add(await buildMbPdf(...p.mbArgs));
    }
    embedPlan(out, planData());
    out.setTitle(m ? 'Mission briefing' : 'Flight briefing');
    const d = flightTime().toISOString().slice(0, 10);
    saveBlob(await out.save(), m ? `Briefing_Mission_${d}.pdf` : `Briefing_${endpoint('main', 0)?.icao || ''}-${endpoint('main', -1)?.icao || ''}_${d}.pdf`);
    state.briefDone = true; stepStatus(); scheduleSave();
    toast(chartsMissing ? 'Briefing PDF ready — some weather charts are missing (add SIGWX / wind chart in step 4 · Briefing)' : 'Briefing PDF ready');
  } catch (err) { console.error(err); toast('Could not build the briefing: ' + err.message); }
  finally { wxState = keepWx; }
}

/* ---------------- Boot ---------------- */

syncSlider();
showPanels();
document.documentElement.classList.toggle('panel-closed', !state.view.panel);
dock.classList.toggle('collapsed', !state.view.profile);
document.documentElement.classList.toggle('profile-collapsed', !state.view.profile);
setDetent(1, false);
togglePoints();
initBase();

// Accuracy notice: shown on every load (static in index.html) and again when the Home Screen app
// comes back after 15 min or more in the background (iOS often resumes it without reloading).
(function startupNotice() {
  const el = document.getElementById('startupNotice');
  const ok = document.getElementById('snOk');
  if (!el || !ok) return;
  let hiddenAt = 0;
  const show = () => { el.hidden = false; ok.focus(); };
  ok.addEventListener('click', () => { el.hidden = true; });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt >= 15 * 60 * 1000) show();
  });
  ok.focus();
})();
update();
if (state.main.waypoints.length > 1) setTimeout(fitRoute, 50);
else setTimeout(() => {
  // keep Burgos in the visible part of the map, not under the panel / sheet
  if (isWide()) map.panBy([state.view.panel ? -200 : 0, 60], { animate: false });
  else map.panBy([0, sheetH() / 2], { animate: false });
}, 30);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Expose for debugging in the console
document.addEventListener('change', (e) => { if (e.target.dataset && e.target.dataset.ff === 'fob') state.flight.fobSet = e.target.value !== ''; }, true);
window.navlogApp = { map, get state() { return state; }, get result() { return result; } };
