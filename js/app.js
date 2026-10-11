import { AERODROMES, POINTS, FLEET_TYPES, fleetType, SOP, adByIcao, mergeAip, procedureFor, PROCEDURES } from './data.js';
import { computeNavlog, stdFlags, fuelPolicy, fmtMMSS, fmtHMS, fmtVar, fmtAlt, parseAlt, cruiseTas, distanceNm, midpoint } from './nav.js';
import { buildNavlogPdf, buildMbPdf } from './pdf.js';
import { addBriefingPages, addMissionCover, fonts as pdfFonts, pdfText } from './briefpdf.js';
import { renderRouteMap, addMapPage } from './mapprint.js';
import { sampleTerrain, plannedProfile, drawProfile, profileAt } from './profile.js';
import { PlacesLayer } from './places.js';
import { fetchWinds } from './winds.js';
import { fetchWeather, assess, metarSummary, crosswind } from './weather.js';
import { performance, pressureAlt, isaTemp, FT_PER_M } from './perf.js';
import { MB_TYPES, computeMb, fmtMoment, cgLimitsAt, KG_TO_LB } from './mb.js';
import { zl, utc, local } from './time.js';
import { APPROVED, IFR_ONLY, EASY_FIRST, FULL_STOP, CLOSING_LOCAL, NO_REFUEL, FREQS, aerodromeOpen, airspaceCrossings, crossingIssue, buildFpl, departureBriefing, arrivalBriefing, temThreats } from './rules.js';
import { listPlans, savePlan, deletePlan, getPlan, planFromPdf, embedPlan } from './plans.js';
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
  flight: { callsign: '', type: 'P2008', reg: 'EC-ODX', pilot: '', copilot: '', baggage: 0, baggage2: 0, pax: '', pax1: '', pax2: '', emptyMass: '', emptyMoment: '', fob: 120, taxi: '', extra: 0, weather: '', solo: false, pob: 2, lowCloud: false },
  view: { base: 'vfr', points: true, marks: true, names: true, profile: true, winds: true, panel: true },
  unlocked: ['LEBG', 'LERJ'],
  tem: {},
  windSource: null,
  planId: null,
  mb: { studentCode: '', notams: '', tripSource: 'route', tripManual: '', altManual: '' },
  mode: 'plan',
});

let uid = Date.now();
let state = load();
let result = null;

function adWaypoint(ad) {
  return { id: ++uid, name: ad.icao, lat: ad.lat, lon: ad.lon, ref: ad.icao, var: ad.var };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s && s.main) { const d = defaultState(); return { ...d, ...s, flight: { ...d.flight, ...s.flight }, view: { ...d.view, ...s.view }, mb: { ...d.mb, ...s.mb }, unlocked: s.unlocked || d.unlocked, tem: s.tem || {} }; }
  } catch { /* first run or storage blocked */ }
  return defaultState();
}
function save() {
  if (typeof syncActiveLeg === 'function') syncActiveLeg();
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* private mode */ }
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

async function initBase() {
  try {
    const r = await fetch('tiles/meta.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error();
    chartMeta = await r.json();
    if (chartMeta.bounds) vfrLayer.options.bounds = L.latLngBounds(chartMeta.bounds);
    document.getElementById('chartInfo').textContent = `AIP España · ENAIRE · ${chartMeta.charts.join(', ')}`;
  } catch {
    chartMeta = null;
    document.getElementById('chartInfo').textContent = 'VFR chart tiles are not built on this copy yet — showing terrain.';
  }
  setBase(state.view.base);
}
function setBase(b) {
  const useVfr = b === 'vfr' && chartMeta;
  map.removeLayer(vfrLayer); map.removeLayer(topoLayer);
  (useVfr ? vfrLayer : topoLayer).addTo(map);
  document.querySelector(`input[name=base][value=${b}]`).checked = true;
}

const panes = ['labels', 'points', 'routes', 'marks', 'wpts'];
panes.forEach((p, i) => { map.createPane(p).style.zIndex = 410 + i * 10; });

// Reference points (aerodromes + VRPs)
const pointsLayer = L.layerGroup();
function buildPoints() {
  pointsLayer.clearLayers();
  const z = map.getZoom();
  POINTS.forEach((p) => {
    if (p.type === 'vrp' && z < 9) return;
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
  if (aip && aip.airspaces) AIRSPACES = aip.airspaces;
  if (mergeAip(aip)) { buildPoints(); update({ rerenderPanels: true }); }
}).catch(() => {});

const routeLayer = L.layerGroup().addTo(map);

// Town and village names (GeoNames)
let placesLayer = null;
let placesData = [];
fetch('data/places.json').then((r) => (r.ok ? r.json() : [])).then((places) => {
  if (!places.length) return;
  placesData = places;
  placesLayer = new PlacesLayer(places);
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
    if (d < bestD) { bestD = d; best = p; }
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
  const curated = AERODROMES.filter((a) => a.freq && a.vrps && ['LEBG', 'LEVT', 'LERJ'].includes(a.icao));
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
    alt: lastCruiseAlt(r.waypoints),
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
        wp.proc = 'dep'; wp.procRoute = proc.route; if (proc.alt) wp.alt = proc.alt;
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
        for (let j = k; j < wps.length; j++) { if (proc.alt) wps[j].alt = proc.alt; if (j > k) wps[j].proc = 'arr'; }
        if (proc.alt) last.alt = proc.alt; // established at the procedure altitude over the entry point
        for (const id of proc.points.slice(1)) {
          const p = vrpRef(ad.icao, id); if (!p) continue;
          const wp = newWaypoint(p.lat, p.lon, p);
          wp.proc = 'arr'; if (proc.alt) wp.alt = proc.alt;
          wps.push(wp);
        }
        const wp = newWaypoint(ref.lat, ref.lon, ref);
        wp.proc = 'arr'; if (proc.alt) wp.alt = proc.alt;
        wps.push(wp);
        const entryId = (POINTS.find((x) => x.key === wps[k].ref) || lastRef).id;
        const solo = state.flight.solo && proc.solo && !proc.solo.includes(entryId);
        toast(solo ? `Solo flights may only enter via ${proc.solo.join(' or ')} (SOP)` : `Arrival ${proc.points.join(' → ')} → ${ad.icao}${proc.alt ? ` at ${proc.alt} ft` : ''} · ${proc.source}`);
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

function drawRoutes() {
  routeLayer.clearLayers();
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
      const mk = L.marker([w.lat, w.lon], { pane: 'wpts', draggable: true, icon: wpIcon(i + 1, isAlt, w.id === selectedId), keyboard: false }).addTo(routeLayer);
      mk.bindTooltip(w.name, { permanent: true, direction: 'right', className: 'wpt-tip', offset: [10, 0] });
      mk.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        // Tapping the departure aerodrome again closes the route (return to base).
        if (i === 0 && wps.length > 1 && w.ref && adByIcao(w.ref) && wps[wps.length - 1].ref !== w.ref) {
          const ref = POINTS.find((p) => p.key === w.ref);
          addPoint(ref);
          return;
        }
        selectWaypoint(w.id, true);
      });
      mk.on('drag', (e) => showSnapHint(nearestRef(e.target.getLatLng())));
      mk.on('dragend', (e) => {
        const ll = e.target.getLatLng();
        const ref = nearestRef(ll);
        showSnapHint(null);
        if (ref && ref.type === 'town') { w.lat = ref.lat; w.lon = ref.lon; w.ref = null; w.town = ref.label; w.name = ref.label; }
        else if (ref) { w.lat = ref.lat; w.lon = ref.lon; w.ref = ref.key; w.town = undefined; w.name = refName(ref); w.var = adByIcao(ref.ad).var; }
        else { w.lat = ll.lat; w.lon = ll.lng; if (w.ref || w.town) { w.ref = null; w.town = undefined; w.name = `WPT ${i}`; nameFromMap(w); } }
        update({ rerenderPanels: true });
      });
    });
  }
}

function lerp(a, b, f) { return [a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f]; }

// A short line across the route at position pos (pixels each side), as drawn on a paper chart.
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
          crossTick(a, b, lerp(a, b, f), 6, { color: '#fff', weight: 5, opacity: 0.9 }).addTo(routeLayer);
          crossTick(a, b, lerp(a, b, f), 6, { color, weight: 2.2 }).addTo(routeLayer);
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
    // HAT on the leg: Heading · Altitude · Time
    if (z < 10) continue;
    const ete = legRows.reduce((t, r) => t + r.eteSec, 0);
    L.marker(lerp(a, b, 0.5), {
      pane: 'marks', interactive: false,
      icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="hat ${isAlt ? 'alt' : ''}">${String(last.mh).padStart(3, '0')}° · ${last.altDisp || fmtAlt(last.alt, last.altLabel)} · ${fmtMMSS(ete)}</span>` }),
    }).addTo(routeLayer);
  }
}

function fitRoute() {
  const all = [...state.main.waypoints, ...state.alt.waypoints];
  if (all.length > 1) map.fitBounds(L.latLngBounds(all.map((w) => [w.lat, w.lon])), { paddingBottomRight: [40, isWide() ? 240 : sheetH() + 40], paddingTopLeft: [isWide() ? 440 : 40, 120], maxZoom: 11 });
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

function compute() {
  const f = state.flight;
  const ta = endpoint('main', 0)?.ta || 6000;
  const sop = planSop();
  const main = computeNavlog({ ...state.main, fob: +f.fob || 0, ta }, sop);
  const lastRem = main.rows.length ? main.rows[main.rows.length - 1].fuelRem : +f.fob || 0;
  const alt = computeNavlog({ ...state.alt, fob: lastRem, ta }, sop);
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
  const loads = Object.fromEntries(ac.stations.map((st) => [st.id, +f[st.id] || 0]));
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

function showPanels() {
  const key = state.mode === 'plan' ? tab : state.mode;
  Object.entries(panels).forEach(([k, p]) => { p.hidden = k !== key; });
  document.getElementById('summary').hidden = state.mode !== 'plan';
  document.getElementById('mbSummary').hidden = state.mode !== 'mb';
  document.getElementById('planTabs').hidden = state.mode !== 'plan';
  document.querySelectorAll('#modes button').forEach((x) => x.classList.toggle('on', x.dataset.mode === state.mode));
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
}

document.getElementById('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  tab = b.dataset.tab;
  showPanels();
  if (!isWide() && sheetDetent === 0) setDetent(1);
  renderPanels();
});
document.getElementById('modes').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.mode = b.dataset.mode;
  showPanels();
  if (!isWide() && sheetDetent === 0) setDetent(1);
  renderPanels(); scheduleSave();
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

// SERA.5005: above 3000 ft AGL, magnetic track 000–179° → odd thousands + 500 ft, 180–359° → even + 500 ft.
function semicircularHint(mc, alt) {
  if (alt == null || alt < 3000) return null;
  const odd = mc < 180;
  const ok = alt % 1000 === 500 && (Math.floor(alt / 1000) % 2 === 1) === odd;
  if (ok) return null;
  const base = Math.floor(alt / 1000);
  const cands = [base - 1, base, base + 1].filter((t) => (t % 2 === 1) === odd && t >= 2).map((t) => t * 1000 + 500);
  return `Cruising level for MC ${String(mc).padStart(3, '0')}°: ${cands.slice(0, 2).join(' / ')} ft (SERA, above 3000 ft AGL)`;
}

// Phase 2 manual, company alternate policy: LEBG ↔ LERJ.
function companyAlternate() {
  const d = endpoint('main', -1)?.icao;
  return d === 'LEBG' ? 'LERJ' : d === 'LERJ' ? 'LEBG' : null;
}

function seraIssues(key) {
  const out = [];
  const r = state[key], nl = result[key];
  nl.rows.forEach((row) => {
    if (row.phase !== 'cruise' || row.auto) return;
    const h = semicircularHint(row.mc, row.alt);
    if (h) out.push({ level: 'warn', text: `${row.from} → ${row.to}: ${h}` });
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

  html += `<div class="group">
    <div class="toggle-row"><span>Standard departure — ${SOP.stdDepMin} min <small class="label">(only when starting at an aerodrome)</small></span>
      <label class="switch"><input type="checkbox" data-flag="stdDep" ${r.stdDep ? 'checked' : ''}><span></span></label></div>
    <div class="toggle-row"><span>Standard arrival — ${SOP.stdArrMin} min <small class="label">(only when ending at an aerodrome)</small></span>
      <label class="switch"><input type="checkbox" data-flag="stdArr" ${r.stdArr ? 'checked' : ''}><span></span></label></div>
    <div class="toggle-row"><span>Solo flight <small class="label">(LEBG entry only via N or W)</small></span>
      <label class="switch"><input type="checkbox" data-solo ${state.flight.solo ? 'checked' : ''}><span></span></label></div>
    <div class="toggle-row"><span>LEBG low-cloud procedure <small class="label">(cloud base below 5000 ft · dual only)</small></span>
      <label class="switch"><input type="checkbox" data-lowcloud ${state.flight.lowCloud ? 'checked' : ''} ${state.flight.solo ? 'disabled' : ''}><span></span></label></div>
  </div>`;
  const soloIssue = soloEntryIssue();
  if (soloIssue) html = `<div class="warnings">${esc(soloIssue)}</div>` + html;
  const semi = seraIssues(key);
  if (semi.length) html = `<div class="warnings">${semi.map((x) => esc(x.text)).join('<br>')}</div>` + html;

  html += `<div class="group-title"><span>${isAlt ? 'Alternate route' : 'Route'} · ${wps.length} point${wps.length === 1 ? '' : 's'}</span>
    <span><button class="btn small" data-act="windall">Wind for all legs</button> <button class="btn small" data-act="reverse">Reverse</button> <button class="btn small danger" data-act="clear">Clear</button></span></div>`;

  const sugg = isAlt ? companyAlternate() : null;
  if (sugg && (wps.length <= 1)) {
    html += `<div class="group"><div class="row"><span class="grow">Company alternate policy: <b>${sugg}</b> is the ideal alternate for ${endpoint('main', -1)?.icao}. Check NOTAMs for every alternate.</span><button class="btn small primary" data-act="useAlt" data-ad="${sugg}">Use ${sugg}</button></div></div>`;
  }
  if (!wps.length) {
    html += `<div class="group"><div class="empty">${isAlt ? 'Tap the chart to plan the route to your alternate. It starts at your destination.' : 'Tap the chart to add your first waypoint.'}</div></div>`;
  } else {
    html += `<div class="group ${isAlt ? 'alt-mode' : ''}">`;
    const stdOn = stdFlags(r);
    wps.forEach((w, i) => {
      const legRows = nl.rows.filter((x) => x.legIndex === i);
      const sub = w.ref ? (POINTS.find((p) => p.key === w.ref)?.sub || '') : `${w.lat.toFixed(4)}, ${w.lon.toFixed(4)}`;
      html += `<div class="wp" data-id="${w.id}">
        <div class="wp-n">${i + 1}</div>
        <input class="wp-name" data-f="name" value="${esc(w.name)}" aria-label="Waypoint name">
        <div class="wp-actions">
          <button class="icon-btn" data-act="up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
          <button class="icon-btn" data-act="down" aria-label="Move down" ${i === wps.length - 1 ? 'disabled' : ''}>${ICON.down}</button>
          <button class="icon-btn" data-act="del" aria-label="Delete">${ICON.trash}</button>
        </div>
        <div class="wp-sub">${esc(sub)}${adByIcao(w.ref) ? ` · ${adByIcao(w.ref).elev} ft · <a href="${adByIcao(w.ref).vac}" target="_blank" rel="noopener">VAC ↗</a>` : ''}</div>`;
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
          const sera = !w.proc && !(i === 1 && stdOn.dep) && !(i === wps.length - 1 && stdOn.arr) ? semicircularHint(last.mc, parseAlt(w.alt)) : null;
          html += `<div class="leg-out">${w.proc ? `<span class="tag">${w.proc === 'dep' ? 'Departure route' : 'Arrival route'} · VAC</span>` : ''}<span>TC <b>${last.tc}°</b></span><span>MH <b>${last.mh}°</b></span><span>Dist <b>${dist} NM</b></span><span>GS <b>${last.gs} kt</b></span><span>ETE <b>${fmtMMSS(ete)}</b></span><span>Fuel <b>${fuel} L</b></span>${legRows.length > 1 ? `<span>incl. <b>${legRows.find((x) => x.auto)?.to || ''}</b></span>` : ''}${sera ? `<span class="hint">${sera}</span>` : ''}</div>`;
        }
      }
      html += '</div>';
    });
    html += '</div>';
  }
  html += `<p class="note">Winds marked “auto” are filled from the Open-Meteo forecast at each leg's altitude and time${state.windSource ? ` (fetched ${new Date(state.windSource.at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })})` : ''}. The SOP's approved sources are <a href="https://www.windy.com" target="_blank" rel="noopener">windy.com</a> and <a href="https://ama.aemet.es/en" target="_blank" rel="noopener">ama.aemet.es</a> — check them on Windy (link on each leg); a wind you type is kept. Winds are true direction. VAR is east-positive (Burgos 1°E): MC = TC − VAR E. Drag the small dot in the middle of a leg to insert a waypoint; drag a waypoint to move it.</p>`;
  const ml = state.mission && state.mission.legs.find((l) => l.id === state.mission.active);
  if (ml) html = `<div class="group"><div class="row"><span class="grow">Mission leg: <b>${esc(ml.label)}</b>${state.mission.type === 'local' ? ' <small class="label">(alternate shared by both navlogs)</small>' : ''}</span><button class="btn small" data-act="toMission">Mission</button></div></div>` + html;
  panels.route.innerHTML = html;
}

panels.route.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.flag) { route()[t.dataset.flag] = t.checked; return update({ rerenderPanels: true }); }
  if (t.hasAttribute('data-solo')) { state.flight.solo = t.checked; if (t.checked) state.flight.lowCloud = false; return update({ rerenderPanels: true }); }
  if (t.hasAttribute('data-lowcloud')) { state.flight.lowCloud = t.checked; toast(t.checked ? 'LEBG low-cloud procedure: depart via S, W or N at 4500 ft; arrive via N, W or S–E-1 at 4000 ft. E point not used.' : 'Normal LEBG procedures'); return update({ rerenderPanels: true }); }
  const row = t.closest('.wp'); if (!row || !t.dataset.f) return;
  const w = route().waypoints.find((x) => x.id === +row.dataset.id); if (!w) return;
  const f = t.dataset.f;
  let v = t.value.trim();
  if (f === 'wdir') v = v === '' ? '' : ((+v % 360) + 360) % 360;
  if (f === 'wspd' || f === 'tas') v = v === '' ? '' : Math.max(0, +v);
  if (f === 'var') v = v === '' ? '' : +v;
  if (f === 'alt') v = /^fl/i.test(v) ? v.toUpperCase().replace(/\s+/g, '') : (v === '' ? '' : parseAlt(v));
  w[f] = v;
  if (f === 'wdir' || f === 'wspd') w.windSrc = v === '' ? undefined : 'manual';
  update({ rerenderPanels: true });
});
panels.route.addEventListener('click', (e) => {
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
  selectedId = id;
  drawRoutes();
  if (scroll) {
    if (state.mode !== 'plan') { state.mode = 'plan'; showPanels(); }
    if (tab !== 'route') document.querySelector('#tabs [data-tab=route]').click();
    if (!isWide() && sheetDetent === 0) setDetent(1);
    const el = panels.route.querySelector(`.wp[data-id="${id}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function headerFor(key) {
  const f = state.flight;
  const t = flightTime();
  const date = `${t.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })} T/O ${zl(t)}`;
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
      date, callsign: f.callsign, reg: f.reg, weather: f.weather, freq,
      dep: mainDep?.icao || state.main.waypoints[0]?.name || '', dest: mainDest?.icao || state.main.waypoints.at(-1)?.name || '',
      alt: altDest?.icao || '',
      elevDep: mainDep?.elev ?? '', elevDest: mainDest?.elev ?? '', elevAlt: altDest?.elev ?? '',
      tom: mb?.tom, lmDest: mb?.lm, lmAlt: altDest ? mb?.lmAlt : '',
      trip: fp.trip, altFuel: altDest ? fp.alternate : '', contingency: fp.contingency, finalReserve: fp.finalReserve,
    };
  }
  const trip = result.alt.totals.trip;
  return {
    date, callsign: f.callsign, reg: f.reg, weather: f.weather, freq,
    dep: mainDest?.icao || '', dest: altDest?.icao || state.alt.waypoints.at(-1)?.name || '', alt: '',
    elevDep: mainDest?.elev ?? '', elevDest: altDest?.elev ?? '', elevAlt: '',
    tom: mb?.lm, lmDest: mb?.lmAlt, lmAlt: '',
    trip, altFuel: '', contingency: Math.round(trip * SOP.contingencyPct) / 100, finalReserve: fp.finalReserve,
  };
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
    <label class="field" style="grid-column: 1 / -1"><span>Weather info</span><input data-ff="weather" value="${esc(f.weather)}" placeholder="METAR / TAF summary"></label>
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
  panels.navlog.innerHTML = html;
}
panels.navlog.addEventListener('change', (e) => {
  const k = e.target.dataset.ff; if (!k) return;
  state.flight[k] = k === 'callsign' ? e.target.value.toUpperCase().trim() : e.target.value;
  update({ rerenderPanels: true });
});
panels.navlog.addEventListener('click', (e) => { if (e.target.closest('[data-act=pdf]')) downloadPdf(); });

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
    <label class="field"><span>FOB (L) — from FISUP</span><input data-ff="fob" inputmode="decimal" value="${esc(f.fob)}"></label>
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
    own[pk] = e.target.value === '' ? '' : Math.max(0, +e.target.value);
    return update({ rerenderPanels: true });
  }
  const k = e.target.dataset.ff; if (!k) return;
  state.flight[k] = e.target.value === '' ? '' : Math.max(0, +e.target.value);
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
      <div class="row"><span class="grow"><b>${c.role === 'dep' ? 'Take-off distance over 50 ft' : 'Landing distance from 50 ft'}</b></span><span class="value"><b>${dist(ph.d50, r.unit)}</b></span></div>
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
    html += `<label class="field"><span>${esc(st.label)} (kg)</span><input data-ff="${st.id}" inputmode="decimal" value="${esc(f[st.id] ?? '')}" placeholder="${ph}">${hint ? `<small class="label">${hint}</small>` : ''}</label>`;
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
    <label class="field full"><span>Weather</span><input data-ff="weather" value="${esc(f.weather)}" placeholder="METAR / TAF summary"></label>
    <label class="field full"><span>NOTAMs</span><input data-mb="notams" value="${esc(mbs.notams)}" placeholder="Relevant NOTAMs"></label>
  </div></div>
  <button class="btn primary wide" data-act="mbpdf">Download M&amp;B sheet (PDF)</button>
  <p class="note">Arms, limits and envelope from the ${esc(ac.sheet)} (fleet M&amp;B overview, 19/07/2025). Fuel ${ac.unit === 'lb' ? '6 lb/US gal' : '0.72 kg/L'}. Masses are entered in kg${ac.unit === 'lb' ? ' and converted to lb (× 2.20462)' : ''}.</p>`;
  panels.mb.innerHTML = html;
}
panels.mb.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.ff) {
    const k = t.dataset.ff;
    if (k === 'type') { state.flight.type = t.value; state.flight.reg = Object.keys(acOf(t.value).regs)[0] || ''; state.flight.fob = Math.min(+state.flight.fob || 0, acOf(t.value).fuelMaxL) || acOf(t.value).fuelMaxL; }
    else state.flight[k] = k === 'reg' || k === 'weather' ? (k === 'reg' ? t.value.toUpperCase().trim() : t.value) : (t.value === '' ? '' : Math.max(0, +t.value));
  } else if (t.dataset.mb) {
    state.mb[t.dataset.mb] = t.dataset.mb === 'studentCode' ? t.value.toUpperCase().trim() : t.value;
  } else if (t.dataset.mbflag) {
    state.mb.tripSource = t.checked ? 'route' : 'manual';
  } else if (t.dataset.pc) {
    const [role, k] = t.dataset.pc.split('.');
    state.perfCond = state.perfCond || {};
    state.perfCond[role] = { ...(state.perfCond[role] || {}), [k]: k === 'surface' ? t.value : t.value === '' ? '' : +t.value };
  } else return;
  update({ rerenderPanels: true });
});
panels.mb.addEventListener('click', (e) => { if (e.target.closest('[data-act=mbpdf]')) downloadMbPdf(); });

async function downloadMbPdf() {
  const m = result.mb, f = state.flight;
  if (!m) return toast('Choose a registration (or enter the empty mass) first.');
  try {
    const bytes = await buildMbPdf(m, {
      date: flightTime().toLocaleDateString('en-GB'), reg: f.reg, studentCode: state.mb.studentCode,
      weather: f.weather, notams: state.mb.notams, perf: perfResults(),
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
  document.querySelectorAll('#routeSel button').forEach((b) => b.classList.toggle('on', b.dataset.route === state.active));
  document.getElementById('routeSel').hidden = tab === 'fuel' || tab === 'brief';
  if (state.mode === 'mb') return renderMB();
  if (state.mode === 'mission') return renderMission();
  if (tab === 'route') renderRoute();
  if (tab === 'navlog') renderNavlog();
  if (tab === 'fuel') renderFuel();
  if (tab === 'brief') renderBriefing();
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
  if (dest && NO_REFUEL.includes(dest.icao)) issues.push({ level: 'info', text: `${dest.icao}: no refuelling available` });
  // cruising levels
  issues.push(...seraIssues('main'));
  // airspace along the route
  for (const key of ['main', 'alt']) {
    const ends = [endpoint(key, 0), endpoint(key, -1)].filter(Boolean);
    airspaceCrossings(routeLegs(key), AIRSPACES)
      .filter((c) => !(['FIZ', 'CTR', 'ATZ', 'RMZ', 'TMZ'].includes(c.sp.type) && ends.some((ad) => c.leg.includes(ad.icao))))
      .forEach((c) => issues.push(crossingIssue(c)));
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
  if (tab === 'brief') renderBriefing();
  try { wxState.data = await fetchWeather(ads); } catch (e) { wxState.err = e.message; }
  wxState.loading = false;
  if (tab === 'brief') renderBriefing();
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

// Everything on the briefing list (SOP briefing order), for the Briefing tab and the briefing PDF.
function briefingData() {
  const f = state.flight;
  const dep = endpoint('main', 0), dest = endpoint('main', -1), alt = endpoint('alt', -1);
  const { to, ldg, altArr } = times();
  const ft = fleetType(f.type);
  const issues = dedupe([...weatherIssues(), ...planIssues()]);
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
  return { dep, dest, alt, to, ldg, issues, wx, limits, notamAds, fpl, depText, arrText, chartAds, freq: headerFor('main').freq, mb: result.mb, perf: perfResults(), threats, fuel: result.fuel };
}

function renderBriefing() {
  loadWeather();
  const B = briefingData();
  const { dep, issues, wx, notamAds, fpl, depText, arrText, chartAds, threats } = B;
  const bad = issues.filter((i) => i.level === 'bad').length, warn = issues.filter((i) => i.level === 'warn').length;
  let html = `<button class="btn primary wide" data-act="briefPdf">Download briefing (PDF)${state.mission ? ' · whole mission' : ''}</button>`;
  html += `<div class="group-title"><span>Go / no-go · ${bad ? `<span class="badge bad">${bad} no-go</span>` : '<span class="badge ok">no blockers</span>'} ${warn ? `<span class="badge warn">${warn} to check</span>` : ''}</span></div>`;
  html += issues.length
    ? `<ul class="issues">${issues.map((i) => `<li class="${i.level}"><span class="ic">${i.level === 'bad' ? '✕' : i.level === 'warn' ? '!' : 'i'}</span><span>${esc(i.text)}</span></li>`).join('')}</ul>`
    : `<div class="group"><div class="empty">${result.main.rows.length ? 'No issues found. The final decision stays with you and your instructor.' : 'Plan a route to see the checks.'}</div></div>`;

  // 1. Weather
  html += `<div class="group-title"><span>1 · Weather (METAR / TAF)</span><button class="btn small" data-act="wx">Refresh</button></div><div class="group">`;
  if (wxState.loading) html += '<div class="empty">Loading METAR and TAF…</div>';
  else if (wxState.err) html += `<div class="empty">Weather unavailable (${esc(wxState.err)}). Check <a href="https://ama.aemet.es/en" target="_blank" rel="noopener">AEMET</a>.</div>`;
  else if (!dep) html += '<div class="empty">Add aerodromes to the route.</div>';
  if (wxState.data) for (const { ad, t, role, w, a, st } of wx) {
    html += `<div class="wx"><div class="wx-head"><b>${ad.icao}</b><span class="label">${role} · ${hhmmZ(t)} ±1 h</span><span class="badge ${st[0]}">${st[1]}</span></div>
      ${w.metar ? `<div class="label" style="font-size:12px">${esc(metarSummary(w.metar))}${a.xw ? ` · best RWY ${a.xw.rwy}: crosswind ${a.xw.xw} kt` : ''}</div><div class="mono">${esc(w.metar.rawOb)}</div>` : '<div class="label">No METAR</div>'}
      ${w.taf ? `<div class="mono" style="margin-top:4px">${esc(w.taf.rawTAF)}</div>` : ''}</div>`;
  }
  html += `</div><p class="note">${esc(B.limits)} Also brief surface pressure charts, SIGWX and wind charts (SOP briefing order). Source: aviationweather.gov.</p>`;

  // 2. NOTAMs
  html += `<div class="group-title"><span>2 · NOTAMs</span></div><div class="group">
    <div class="row"><span class="grow">Aerodromes: ${notamAds.join(', ') || '—'} — check every alternate individually</span><a class="btn small" href="https://notampib.enaire.es/icaro" target="_blank" rel="noopener">ICARO ↗</a></div>
    <div class="row"><span class="grow">En-route NOTAMs (Phase 3 manual)</span><a class="btn small" href="https://insigniavfr.enaire.es" target="_blank" rel="noopener">Insignia VFR ↗</a></div>
    <div class="row wrap"><label class="field full"><span>NOTAM bulletin code / relevant NOTAMs (printed on the M&amp;B and the briefing)</span><input data-mb="notams" value="${esc(state.mb.notams)}" placeholder="e.g. bulletin code, RWY works…"></label></div>
  </div>`;

  // 3. ATC flight plan
  html += `<div class="group-title"><span>3 · ATC flight plan (draft)</span></div><div class="group">${fpl ? `<div class="wx mono" id="fplText">${esc(fpl)}</div>${copyBtn('fplText')}` : '<div class="empty">Plan a route between two aerodromes.</div>'}</div>
    <p class="note">EOBT is set 10 min before takeoff. Check equipment, endurance and persons on board before filing.</p>`;

  // 4. Mission: departure / arrival briefing, alternate, charts
  html += `<div class="group-title"><span>4 · Mission objective</span></div><div class="group">
    <div class="wx"><div class="wx-head"><b>Departure briefing</b></div><div id="depBrief">${esc(depText) || '—'}</div></div>${depText ? copyBtn('depBrief') : ''}
    <div class="wx"><div class="wx-head"><b>Arrival briefing</b><span class="label">Phase 1 format</span></div><div id="arrBrief">${esc(arrText) || '—'}</div></div>${arrText ? copyBtn('arrBrief') : ''}
    <div class="wx"><div class="wx-head"><b>Charts to have in sight</b></div>${chartAds.map((x) => `<a href="${x.vac}" target="_blank" rel="noopener">${x.icao} VAC ↗</a>`).join(' · ') || '—'} · ENAIRE 1:500 000 chart</div>
    <div class="wx"><div class="wx-head"><b>Frequencies</b></div>${esc(B.freq)}</div>
  </div>`;

  // 5 & 6. Mass & balance and performance (details in the Mass & Balance view)
  const mbr = B.mb;
  html += `<div class="group-title"><span>5 · Mass &amp; balance · 6 · Performance</span><button class="btn small" data-act="toMb">Open</button></div><div class="group">
    <div class="row ${mbr ? (mbr.ok ? 'check-ok' : 'check-bad') : 'check-bad'}"><span class="grow">${mbr ? `T/O ${mbr.to.mass.toFixed(1)} ${mbr.ac.unit} · C.G. ${mbr.to.arm.toFixed(mbr.ac.armDp)} ${mbr.ac.armUnit}` : 'Mass &amp; balance not complete'}</span><span class="value">${mbr ? (mbr.ok ? 'IN LIMITS' : 'OUT') : '—'}</span></div>
    ${B.perf.map(({ c, r }) => { const ph = r && !r.manual ? (c.role === 'dep' ? r.to : r.ldg) : null; return `<div class="row"><span class="grow">${c.role === 'dep' ? 'Take-off' : 'Landing'} ${c.ad.icao}</span><span class="value">${ph && !ph.manual ? `${ph.d50} ${r.unit} over 50 ft` : 'read the chart'}</span></div>`; }).join('')}
  </div>`;

  // 7. TEM
  html += `<div class="group-title"><span>7 · Threat &amp; error management</span></div><div class="group">${threats.map((t) => `<label class="tem-row"><input type="checkbox" data-tem="${esc(t)}" ${state.tem[t] ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div>`;

  // Unlocked aerodromes
  html += `<div class="group-title"><span>My unlocked aerodromes</span></div><div class="group"><div class="chips">${EASY_FIRST.map((ad) => `<label><input type="checkbox" data-unlock="${ad}" ${state.unlocked.includes(ad) ? 'checked' : ''}>${ad}</label>`).join('')}</div></div>
  <p class="note">Solo flights only go to aerodromes already flown with an instructor (solo manual). Briefing order: weather, NOTAMs, ATC flight plan, mission objective, mass &amp; balance, performance, TEM.</p>`;
  panels.brief.innerHTML = html;
}

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
});
panels.brief.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.tem) { state.tem[t.dataset.tem] = t.checked; scheduleSave(); }
  if (t.dataset.mb) { state.mb[t.dataset.mb] = t.value; scheduleSave(); }
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
  if (p) { state.planId = p.id; loadPlanData(p.data); plansPop.hidden = true; toast(`Opened ${p.name}`); }
});
document.getElementById('btnSavePlan').addEventListener('click', () => {
  const name = prompt('Name for this plan', planName());
  if (!name) return;
  state.planId = savePlan(name, planData(), state.planId);
  renderPlans(); toast('Plan saved'); scheduleSave();
});
document.getElementById('btnNewPlan').addEventListener('click', () => {
  if (!confirm('Start a new plan? Save the current one first if you need it.')) return;
  const keep = { flight: { ...state.flight }, unlocked: state.unlocked, view: state.view };
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
callsignInput.addEventListener('change', () => { state.flight.callsign = callsignInput.value.toUpperCase().trim(); update({ rerenderPanels: true }); });
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
    if (terrainKey === k) { terrainData = t; renderProfile(); }
  } catch (err) {
    console.warn('terrain', err);
    if (terrainKey === k) { terrainErr = true; terrainKey = null; renderProfile(); }
  }
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
    const res = drawProfile(canvas, { planned, terrain: terrainData, color });
    let txt = '';
    if (planned) {
      if (terrainErr) txt = 'Terrain unavailable (offline?)';
      else if (!terrainData) txt = 'Loading terrain…';
      else if (res) {
        txt = `Highest terrain ±2 NM: ${res.maxTerrain} ft`;
        if (res.minClearance != null) txt += ` · min clearance ${res.minClearance} ft${res.minClearance < 1000 ? ' ⚠︎ below 1000 ft' : ''}`;
      }
      txt += ' · obstacles not included — check the chart';
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
  const apply = (e) => {
    const at = profileAt(cv, e.clientX, e.clientY);
    if (!at || !drag) return;
    const step = altStep();
    const alt = Math.max(1000, Math.min(14500, Math.round(at.alt / step) * step));
    const w = route().waypoints[drag.leg];
    if (!w || parseAlt(w.alt) === alt) return;
    w.alt = alt;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      update();
      const info = id === 'profileCanvas' ? document.getElementById('profileInfo') : document.getElementById('profileNoteSheet');
      if (info) info.textContent = `${route().waypoints[drag.leg - 1]?.name || ''} → ${w.name}: ${alt} ft`;
    });
  };
  cv.addEventListener('pointerdown', (e) => {
    const at = profileAt(cv, e.clientX, e.clientY);
    const leg = at && legAtDistance(at.d);
    if (!leg) return;
    drag = { leg };
    cv.setPointerCapture(e.pointerId);
    e.preventDefault();
    apply(e);
  });
  cv.addEventListener('pointermove', (e) => { if (drag) apply(e); });
  const end = () => { if (!drag) return; drag = null; update({ rerenderPanels: true }); };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
}

/* ---------------- Update loop ---------------- */

let saveTimer = null;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 300); }

function update(opts = {}) {
  result = compute();
  drawRoutes();
  renderSummary();
  renderMbSummary();
  scheduleTerrain();
  renderTime();
  syncPlanBar();
  if (opts.rerenderPanels !== false) renderPanels();
  if (opts.winds !== false) scheduleAutoWinds();
  scheduleSave();
}

/* ---------------- PDF ---------------- */

function saveBlob(bytes, name) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
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
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}
function haptic() { if (navigator.vibrate) navigator.vibrate(8); }

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
  if (!chartMeta) return toast('VFR chart tiles are not available yet.');
  const all = [...state.main.waypoints, ...state.alt.waypoints];
  let b = all.length ? L.latLngBounds(all.map((w) => [w.lat, w.lon])) : L.latLngBounds([[LEBG.lat, LEBG.lon], [LEBG.lat, LEBG.lon]]);
  b = b.pad(0.3);
  const pad = 0.4; // ~25 NM margin
  b = L.latLngBounds([b.getSouth() - pad, b.getWest() - pad], [b.getNorth() + pad, b.getEast() + pad]);
  const urls = [];
  for (let z = 6; z <= 12; z++) {
    const p1 = map.project(b.getNorthWest(), z).divideBy(256).floor();
    const p2 = map.project(b.getSouthEast(), z).divideBy(256).floor();
    for (let x = p1.x; x <= p2.x; x++) for (let y = p1.y; y <= p2.y; y++) urls.push(`tiles/${z}/${x}/${y}.webp`);
  }
  layersPop.hidden = true;
  let done = 0;
  const cache = await caches.open('navlog-tiles-v1');
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
  leg.main = clone(state.main); leg.time = state.time;
  if (m.type === 'local') m.sharedAlt = clone(state.alt); else leg.alt = clone(state.alt);
  if (legChainIndex(leg) === 0) leg.fob = +state.flight.fob || 0;
}
const legsOfChain = (leg) => state.mission.legs.filter((l) => l.chain === leg.chain);
const legChainIndex = (leg) => legsOfChain(leg).indexOf(leg);

// Run fn with a leg loaded into the planner (state + result), then put everything back.
function withLeg(leg, fobL, fn) {
  const keep = { main: state.main, alt: state.alt, time: state.time, fob: state.flight.fob, result, active: state.active };
  legSwap = true;
  try {
    state.main = clone(leg.main); state.alt = clone(state.mission.type === 'local' ? state.mission.sharedAlt : leg.alt) || { waypoints: [], stdDep: false, stdArr: false };
    state.time = leg.time; state.flight.fob = fobL; state.active = 'main';
    result = compute();
    return fn();
  } finally {
    Object.assign(state, { main: keep.main, alt: keep.alt, time: keep.time, active: keep.active }); state.flight.fob = keep.fob; result = keep.result;
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
    const fob = i === 0 ? (+leg.fob || +state.flight.fob || 0) : leg.refuel ? cap : prev ? Math.max(0, prev.remaining) : 0;
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
    main: { waypoints: [A, B].filter(Boolean).map(adWaypoint), stdDep: true, stdArr: true },
    alt: altAd && B ? { waypoints: [adWaypoint(B), adWaypoint(altAd)], stdDep: false, stdArr: true } : { waypoints: [], stdDep: false, stdArr: false },
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
    const altAd = adByIcao(base === 'LEBG' ? 'LERJ' : 'LEBG');
    m.sharedAlt = { waypoints: [adWaypoint(adByIcao(base)), adWaypoint(altAd)], stdDep: false, stdArr: true };
  } else if (type === 'xc') {
    m.legs.push(newLeg(`Outbound · ${base} → ${d.dest}`, 'a', base, d.dest, t0));
    m.legs.push(newLeg(`Inbound · ${d.dest} → ${base}`, 'a', d.dest, base, later(120)));
    m.legs.push(newLeg(`Reserve outbound · ${base} → ${d.reserve}`, 'b', base, d.reserve, t0));
    m.legs.push(newLeg(`Reserve inbound · ${d.reserve} → ${base}`, 'b', d.reserve, base, later(120)));
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
  state.mission = m;
  openLeg(m.legs[0].id, true);
  state.mode = 'mission'; showPanels(); renderPanels();
}
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
  syncSlider();
  if (!quiet) { state.mode = 'plan'; tab = 'route'; showPanels(); toast(`Editing ${leg.label}`); }
  update({ rerenderPanels: true });
  setTimeout(fitRoute, 50);
}

function missionFormHtml(replace) {
  const opts = (sel) => APPROVED.map((ad) => `<option ${ad === sel ? 'selected' : ''}>${ad}</option>`).join('');
  return `<div class="row wrap">
      <label class="field"><span>Type</span><select id="msType">
        <option value="local">Local navigation</option><option value="xc">Cross-country</option><option value="tri">Triangular</option></select></label>
      <label class="field narrow"><span>Base</span><select id="msBase">${['LEBG', 'LERJ'].map((x) => `<option>${x}</option>`).join('')}</select></label>
    </div>
    <div class="row wrap" id="msXc" hidden>
      <label class="field narrow"><span>Destination</span><select id="msDest">${opts('LEVT')}</select></label>
      <label class="field narrow"><span>Reserve airport</span><select id="msRes">${opts('LEVD')}</select></label>
    </div>
    <div class="row wrap" id="msTri" hidden>
      <label class="field narrow"><span>Trip A · 1st</span><select id="msA1">${opts('LEVD')}</select></label>
      <label class="field narrow"><span>Trip A · 2nd</span><select id="msA2">${opts('LELN')}</select></label>
      <label class="field narrow"><span>Trip B · 1st</span><select id="msB1">${opts('LEVT')}</select></label>
      <label class="field narrow"><span>Trip B · 2nd</span><select id="msB2">${opts('LEPP')}</select></label>
    </div>
    <div class="row"><span class="grow label">Local: 2 navlogs + a shared alternate, 1 M&amp;B. Cross-country: 2 flights + 2 for the reserve airport = 4 navlogs, 1 M&amp;B per flight, no refuel. Triangular: two different trips, two airports + base, 300 NM each (solo manual).</span></div>
    <button class="btn primary wide" data-act="msCreate">${replace ? 'Replace the mission' : 'Create mission'}</button>`;
}

function renderMission() {
  syncActiveLeg();
  const m = state.mission;
  if (!m) {
    panels.mission.innerHTML = `<div class="group-title"><span>New mission</span></div><div class="group">${missionFormHtml(false)}</div>
      <p class="note">A mission keeps every navlog, alternate and M&amp;B of the flight together and downloads them as one PDF.</p>`;
    return wireMissionForm();
  }
  const figs = missionFigures();
  const names = { local: 'Local navigation', xc: 'Cross-country', tri: 'Triangular' };
  let html = `<div class="group-title"><span>${names[m.type]}</span><button class="btn small primary" data-act="msPdf">Download all (briefing + navlogs + M&amp;B)</button></div><div class="group">`;
  for (const leg of m.legs) {
    const f = figs.get(leg.id), i = legChainIndex(leg);
    const planned = (leg.main.waypoints || []).length >= 3;
    const ok = planned && f.fuelOk && f.mbOk !== false && !f.issues.length;
    html += `<div class="wx${leg.id === m.active ? ' active' : ''}"><div class="wx-head"><b>${esc(leg.label)}</b>${leg.id === m.active ? '<span class="label">open</span>' : ''}<span class="badge ${ok ? 'ok' : planned ? 'bad' : 'warn'}">${ok ? 'OK' : planned ? 'CHECK' : 'TO PLAN'}</span></div>
      ${planned ? '' : '<div class="label warn">Not planned yet — open it and add the departure/arrival reporting points and turning points.</div>'}
      <div class="label">${f.dep?.icao || '?'} → ${f.dest?.icao || '?'}${f.alt ? ` · alt ${f.alt.icao}` : ''} · ${f.dist} NM · ${fmtHMS(f.timeSec).slice(0, 5)} · T/O ${zl(f.t)} → LDG ${zl(f.ldg)}</div>
      <div class="label">FOB ${f.fob.toFixed(1)} L${i > 0 ? (leg.refuel ? ' (refuel: full tanks)' : ' (carried from the previous leg)') : ''} · trip ${f.trip.toFixed(1)} L · minimum ${f.required} L ${f.fuelOk ? '✓' : '✕'} · M&amp;B ${f.mbOk == null ? '—' : f.mbOk ? '✓' : '✕'}</div>
      ${f.issues.length ? `<div class="label warn">${f.issues.map(esc).join('<br>')}</div>` : ''}
      <div class="row" style="padding:6px 0 0">${i > 0 && m.type === 'tri' ? `<label class="tem-row" style="flex:1"><input type="checkbox" data-refuel="${leg.id}" ${leg.refuel ? 'checked' : ''}><span>Refuel at ${f.dep?.icao || ''}${f.dep && NO_REFUEL.includes(f.dep.icao) ? ' — no refuelling there (AIP)' : ' (only where AVGAS 100LL is available)'}</span></label>` : '<span class="grow"></span>'}
      <button class="btn small" data-open="${leg.id}">${leg.id === m.active ? 'Edit' : 'Open'}</button></div></div>`;
  }
  html += '</div>';
  html += `<div class="group-title"><span>Mission checks</span></div><div class="group">${missionChecks(figs).map((c) => `<div class="row ${c.ok ? 'check-ok' : 'check-bad'}"><span class="grow label">${esc(c.text)}</span><span class="value">${c.ok ? 'OK' : '✕'}</span></div>`).join('')}</div>
    <p class="note">Open a leg to plan it on the chart — it is saved back into the mission automatically. Both local navlogs share one alternate. Set each leg's time with the time slider while it is open. Cross-countries carry the fuel from the outbound flight (no refuel).</p>
    <details class="group" style="padding:10px 12px"><summary class="label">New mission</summary>${missionFormHtml(true)}</details>`;
  panels.mission.innerHTML = html;
  wireMissionForm();
}
function wireMissionForm() {
  const sel = panels.mission.querySelector('#msType');
  if (!sel) return;
  const sync = () => { panels.mission.querySelector('#msXc').hidden = sel.value !== 'xc'; panels.mission.querySelector('#msTri').hidden = sel.value !== 'tri'; };
  sel.addEventListener('change', sync); sync();
}

function missionChecks(figs) {
  const m = state.mission, out = [];
  const legs = m.legs.map((l) => ({ l, f: figs.get(l.id) }));
  const ads = (fs) => [...new Set(fs.flatMap(({ f }) => [f.dep?.icao, f.dest?.icao]).filter(Boolean))];
  if (m.type === 'local') {
    out.push({ ok: legs.length >= 2 && legs.every(({ l }) => l.main.waypoints.length >= 3), text: 'Local navigation: 2 nav logs (one prepared + a reserve one), both planned' });
    out.push({ ok: !!(m.sharedAlt && m.sharedAlt.waypoints.length > 1), text: 'Alternate planned for the local navigations (company alternate policy)' });
    out.push({ ok: true, text: 'M&B: 1 for the local navigation' });
  }
  if (m.type === 'xc') {
    out.push({ ok: legs.length >= 4 && legs.every(({ l }) => l.main.waypoints.length >= 3), text: 'Cross-country: 2 nav logs (1 per flight) + 2 for the reserve airport = 4 nav logs, all planned' });
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
    return createMission(v('#msType'), { base: v('#msBase'), dest: v('#msDest'), reserve: v('#msRes'), a1: v('#msA1'), a2: v('#msA2'), b1: v('#msB1'), b2: v('#msB2') });
  }
  if (e.target.closest('[data-act=msPdf]')) return downloadBriefing();
});
panels.mission.addEventListener('change', (e) => {
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
          date: flightTime().toLocaleDateString('en-GB'), reg: state.flight.reg, studentCode: state.mb.studentCode,
          weather: state.flight.weather, notams: state.mb.notams, perf: perfResults(),
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
    notams: state.mb.notams, rows: result.main.rows, tem: state.tem, zl, metarSummary, mmss: fmtMMSS,
    totals: `${tot.dist} NM · ${fmtHMS(tot.timeSec)} · ${tot.trip} L`,
  };
  const sheets = [{ header: headerFor('main'), rows: result.main.rows }];
  if (result.alt.rows.length) sheets.push({ header: headerFor('alt'), rows: result.alt.rows });
  const mbArgs = result.mb ? [result.mb, { date: t.toLocaleDateString('en-GB'), reg: f.reg, studentCode: state.mb.studentCode, weather: f.weather, notams: state.mb.notams, perf: B.perf }] : null;
  const routes = [{ wps: clone(state.main.waypoints), rows: clone(result.main.rows), color: '#d1009a' }];
  if (state.alt.waypoints.length > 1) routes.push({ wps: clone(state.alt.waypoints), rows: clone(result.alt.rows), color: '#0a84ff', alt: true });
  const mapData = state.main.waypoints.length > 1 ? { routes, title: `${B.dep?.icao || ''} -> ${B.dest?.icao || ''}${B.alt ? ` (alternate ${B.alt.icao})` : ''}` } : null;
  return { B, meta, sheets: result.main.rows.length ? sheets : null, mbArgs, mapData };
}

async function downloadBriefing() {
  const { PDFDocument } = window.PDFLib;
  syncActiveLeg();
  const m = state.mission;
  toast(m ? 'Building the mission briefing…' : 'Building the briefing…');
  // weather for every aerodrome of the flight(s), not only the open route
  const ads = new Set();
  const collect = () => [endpoint('main', 0), endpoint('main', -1), endpoint('alt', -1)].filter(Boolean).forEach((a) => ads.add(a.icao));
  if (m) { const figs0 = missionFigures(); m.legs.forEach((l) => withLeg(l, figs0.get(l.id).fob, collect)); } else collect();
  const keepWx = wxState;
  try {
    const extra = await fetchWeather([...ads]).catch(() => null);
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
        legs: m.legs.map((l) => { const f = figs.get(l.id); const ok = f.fuelOk && f.mbOk !== false && !f.issues.length && l.main.waypoints.length >= 3;
          return { label: l.label, ok, status: ok ? 'OK' : 'CHECK', detail: `${f.dep?.icao || '?'} -> ${f.dest?.icao || '?'}${f.alt ? ` (alt ${f.alt.icao})` : ''} · ${f.dist} NM · T/O ${zl(f.t)} · LDG ${zl(f.ldg)} · FOB ${f.fob.toFixed(1)} L · trip ${f.trip.toFixed(1)} L · minimum ${f.required} L${f.issues.length ? ' · ' + f.issues.join('; ') : ''}` }; }),
        checks: missionChecks(figs),
      });
      const mbDone = new Set();
      for (const l of m.legs) {
        const f = figs.get(l.id);
        const p = withLeg(l, f.fob, () => legPack(f.fob));
        p.withMb = !mbDone.has(m.type === 'local' ? 'local' : l.id);
        mbDone.add(m.type === 'local' ? 'local' : l.id);
        packs.push(p);
      }
    } else {
      const p = legPack(); p.withMb = true; packs.push(p);
    }
    for (const p of packs) {
      addBriefingPages(out, F, p.B, p.meta);
      if (p.mapData) {
        const img = await renderRouteMap(p.mapData.routes, { title: p.mapData.title });
        if (img) await addMapPage(out, img, pdfText(`Marked chart · ${p.mapData.title} · 2-min marks at planned GS · HAT = heading, altitude, time`));
      }
      if (p.sheets) await add(await buildNavlogPdf(p.sheets));
      if (p.withMb && p.mbArgs) await add(await buildMbPdf(...p.mbArgs));
    }
    embedPlan(out, planData());
    out.setTitle(m ? 'Mission briefing' : 'Flight briefing');
    const d = flightTime().toISOString().slice(0, 10);
    saveBlob(await out.save(), m ? `Briefing_Mission_${d}.pdf` : `Briefing_${endpoint('main', 0)?.icao || ''}-${endpoint('main', -1)?.icao || ''}_${d}.pdf`);
    toast('Briefing PDF ready');
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
window.navlogApp = { map, get state() { return state; }, get result() { return result; } };
