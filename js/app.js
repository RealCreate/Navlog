import { AERODROMES, POINTS, FLEET, SOP, adByIcao } from './data.js';
import { computeNavlog, fuelPolicy, massBalance, fmtMMSS, fmtHMS, fmtVar, fmtAlt, parseAlt, cruiseTas, distanceNm, midpoint } from './nav.js';
import { buildNavlogPdf } from './pdf.js';
import { sunTimes } from './sun.js';

const L = window.L;
const LEBG = adByIcao('LEBG');
const STORE = 'navlog.v1';
const STEP_MIN = 15;
const AC = FLEET.P2008;

/* ---------------- State ---------------- */

const defaultState = () => ({
  main: { waypoints: [adWaypoint(LEBG)], stdDep: true, stdArr: true },
  alt: { waypoints: [], stdDep: false, stdArr: false },
  active: 'main',
  time: null,
  flight: { callsign: '', reg: 'EC-ODX', pilot: '', copilot: '', baggage: 0, fob: AC.fuelCapacity, taxi: '', extra: 0, weather: '' },
  view: { base: 'vfr', points: true, marks: true },
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
    if (s && s.main) return { ...defaultState(), ...s, flight: { ...defaultState().flight, ...s.flight }, view: { ...defaultState().view, ...s.view } };
  } catch { /* first run or storage blocked */ }
  return defaultState();
}
function save() {
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
  return state.time ? new Date(state.time) : defaultTime();
}
function syncSlider() {
  const t = flightTime();
  let v = Math.round((t - base) / (STEP_MIN * 60e3));
  v = Math.max(0, Math.min(+slider.max, v));
  slider.value = v;
  slider.style.setProperty('--p', `${(v / slider.max) * 100}%`);
}
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
  state.time = new Date(picker.value).toISOString();
  syncSlider();
  update();
});

const dFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const tFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const zFmt = (d) => `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}Z`;

function renderTime() {
  const t = flightTime();
  document.getElementById('timeMain').textContent = `${dFmt.format(t)} · ${tFmt.format(t)} LT`;
  document.getElementById('timeSub').textContent = `Takeoff ${zFmt(t)}`;
  const dep = state.main.waypoints[0] || { lat: LEBG.lat, lon: LEBG.lon };
  const { rise, set } = sunTimes(t, dep.lat, dep.lon);
  const total = result ? result.main.totals.timeSec : 0;
  const ldg = new Date(t.getTime() + total * 1000);
  const parts = [];
  if (rise) parts.push(`<span class="${t < rise ? 'warn' : ''}">SR ${zFmt(rise)}</span>`);
  if (set) parts.push(`<span class="${ldg > set ? 'warn' : ''}">SS ${zFmt(set)}</span>`);
  if (total) parts.push(`<span class="${set && ldg > set ? 'warn' : ''}">Ldg ≈ ${zFmt(ldg)}</span>`);
  if (set && ldg > set) parts.push('<span class="warn">Landing after sunset</span>');
  else if (rise && t < rise) parts.push('<span class="warn">Before sunrise</span>');
  document.getElementById('sunRow').innerHTML = parts.join('');
}

/* ---------------- Map ---------------- */

const map = L.map('map', {
  zoomControl: false, minZoom: 6, maxZoom: 14, worldCopyJump: false,
  center: [LEBG.lat, LEBG.lon], zoom: 10, tap: false, doubleClickZoom: false,
});
L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);

const vfrLayer = L.tileLayer('tiles/{z}/{x}/{y}.webp', {
  minZoom: 6, maxZoom: 14, maxNativeZoom: 12, minNativeZoom: 6, keepBuffer: 4,
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

const panes = ['points', 'routes', 'marks', 'wpts'];
panes.forEach((p, i) => { map.createPane(p).style.zIndex = 410 + i * 10; });

// Reference points (aerodromes + VRPs)
const pointsLayer = L.layerGroup();
POINTS.forEach((p) => {
  const icon = L.divIcon({
    className: '', iconSize: [14, 14], iconAnchor: [7, 7],
    html: `<div class="${p.type === 'ad' ? 'pt-ad' : 'pt-vrp'}"></div><span class="pt-label">${p.type === 'ad' ? p.label : p.label.split(' ')[0]}</span>`,
  });
  const m = L.marker([p.lat, p.lon], { icon, pane: 'points', keyboard: false });
  // SkyDemon-style: tapping a reporting point or aerodrome adds it to the route.
  m.on('click', (e) => { L.DomEvent.stopPropagation(e); addPoint(p); toast(`Added ${refName(p)} · ${p.sub}`); });
  pointsLayer.addLayer(m);
});

const routeLayer = L.layerGroup().addTo(map);
let selectedId = null;

function nearestRef(latlng) {
  const pt = map.latLngToContainerPoint(latlng);
  let best = null, bestD = 22;
  for (const p of POINTS) {
    const d = pt.distanceTo(map.latLngToContainerPoint([p.lat, p.lon]));
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function refName(p) {
  return p.type === 'ad' ? p.label : p.label.split(' ')[0] + (p.ad === 'LEBG' ? '' : ` (${p.ad})`);
}

function defaultVar(lat, lon) {
  let best = AERODROMES[0], bd = Infinity;
  for (const a of AERODROMES) { const d = distanceNm(a, { lat, lon }); if (d < bd) { bd = d; best = a; } }
  return best.var;
}

function newWaypoint(lat, lon, ref) {
  const r = route();
  const prev = r.waypoints[r.waypoints.length - 1];
  const wp = {
    id: ++uid, lat, lon,
    name: ref ? refName(ref) : `WPT ${r.waypoints.length}`,
    ref: ref ? ref.key : null,
    alt: prev && prev.alt ? prev.alt : 5500,
    wdir: prev ? prev.wdir || '' : '', wspd: prev ? prev.wspd || '' : '',
    var: ref ? adByIcao(ref.ad).var : defaultVar(lat, lon),
  };
  return wp;
}

function addPoint(ref) {
  const r = route();
  if (!r.waypoints.length && state.active === 'alt') seedAlternate();
  const wp = newWaypoint(ref.lat, ref.lon, ref);
  r.waypoints.push(wp);
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
      h.on('drag', (e) => { ghost.setLatLngs([[wps[i - 1].lat, wps[i - 1].lon], e.target.getLatLng(), [wps[i].lat, wps[i].lon]]); });
      h.on('dragend', (e) => {
        const ll = e.target.getLatLng();
        const ref = nearestRef(ll);
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
          addPoint(ref); toast(`Return to ${w.ref} added`);
          return;
        }
        selectWaypoint(w.id, true);
      });
      mk.on('dragend', (e) => {
        const ll = e.target.getLatLng();
        const ref = nearestRef(ll);
        if (ref) { w.lat = ref.lat; w.lon = ref.lon; w.ref = ref.key; w.name = refName(ref); w.var = adByIcao(ref.ad).var; }
        else { w.lat = ll.lat; w.lon = ll.lng; if (w.ref) { w.ref = null; w.name = `WPT ${i}`; nameFromMap(w); } }
        update({ rerenderPanels: true });
      });
    });
  }
}

function lerp(a, b, f) { return [a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f]; }

function drawLegAnnotations(key, rows, wps, isAlt) {
  // Re-walk legs: each original leg may contain TOC/TOD sub-rows.
  for (let i = 1; i < wps.length; i++) {
    const a = wps[i - 1], b = wps[i];
    const legRows = rows.filter((r) => r.legIndex === i);
    const legDist = legRows.reduce((t, r) => t + r.dist, 0) || 1;
    let done = 0;
    legRows.forEach((r) => {
      const f0 = done / legDist, f1 = (done + r.dist) / legDist;
      // 2-min marks: every (GS/60*2) NM along the segment (SOP: 2 minute markings)
      if (r.gs > 0 && !r.fixedMin) {
        const step = (r.gs / 60) * 2;
        for (let d = step; d < r.dist - 0.2; d += step) {
          const f = f0 + (d / r.dist) * (f1 - f0);
          L.circleMarker(lerp(a, b, f), { pane: 'marks', radius: 3.5, color: '#fff', weight: 1.5, fillColor: isAlt ? '#0a84ff' : '#d1009a', fillOpacity: 1, interactive: false }).addTo(routeLayer);
        }
      }
      if (r.auto) {
        const pos = lerp(a, b, f1);
        L.marker(pos, { pane: 'marks', interactive: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="hat ${isAlt ? 'alt' : ''}">${r.to}</span>` }) }).addTo(routeLayer);
      }
      done += r.dist;
    });
    // HAT label on the main cruise segment: Heading · Altitude · Time
    const main = legRows[legRows.length - 1];
    if (!main || map.getZoom() < 10) continue;
    const ete = legRows.reduce((t, r) => t + r.eteSec, 0);
    const mid = lerp(a, b, 0.5);
    L.marker(mid, {
      pane: 'marks', interactive: false,
      icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="hat ${isAlt ? 'alt' : ''}">${String(main.mh).padStart(3, '0')}° · ${fmtAlt(main.alt, main.altLabel)} · ${fmtMMSS(ete)}</span>` }),
    }).addTo(routeLayer);
  }
}

function fitRoute() {
  const all = [...state.main.waypoints, ...state.alt.waypoints];
  if (all.length > 1) map.fitBounds(L.latLngBounds(all.map((w) => [w.lat, w.lon])), { paddingTopLeft: [40, 120], paddingBottomRight: [40, sheetH() + 40], maxZoom: 11 });
}

map.on('zoomend', () => drawRoutes());

/* ---------------- Compute ---------------- */

function compute() {
  const f = state.flight;
  const main = computeNavlog({ ...state.main, fob: +f.fob || 0 });
  const lastRem = main.rows.length ? main.rows[main.rows.length - 1].fuelRem : +f.fob || 0;
  const alt = computeNavlog({ ...state.alt, fob: lastRem });
  const dep = endpoint('main', 0), dest = endpoint('main', -1);
  const local = !!dep && !!dest && dep.icao === dest.icao;
  const fuel = fuelPolicy({
    taxi: +f.taxi || 0, trip: main.totals.trip, alternate: alt.totals.trip, extra: +f.extra || 0,
    fob: +f.fob || 0, localFlight: local, flightMin: main.totals.timeSec / 60,
  });
  const mb = massBalance({ ac: AC, reg: f.reg, pilot: +f.pilot || 0, copilot: +f.copilot || 0, baggage: +f.baggage || 0, fobL: +f.fob || 0, tripL: main.totals.trip, altL: alt.totals.trip });
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

document.getElementById('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  tab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  Object.entries(panels).forEach(([k, p]) => { p.hidden = k !== tab; });
  if (sheetDetent === 0) setDetent(1);
  renderPanels();
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

function renderRoute() {
  const key = state.active;
  const r = route();
  const isAlt = key === 'alt';
  const nl = result[key];
  const wps = r.waypoints;
  let html = '';
  if (nl.warnings.length) html += `<div class="warnings">${nl.warnings.map(esc).join('<br>')}</div>`;

  html += `<div class="group">
    <div class="toggle-row"><span>Standard departure — ${SOP.stdDepMin} min <small class="label">(first leg)</small></span>
      <label class="switch"><input type="checkbox" data-flag="stdDep" ${r.stdDep ? 'checked' : ''}><span></span></label></div>
    <div class="toggle-row"><span>Standard arrival — ${SOP.stdArrMin} min <small class="label">(last leg)</small></span>
      <label class="switch"><input type="checkbox" data-flag="stdArr" ${r.stdArr ? 'checked' : ''}><span></span></label></div>
  </div>`;

  html += `<div class="group-title"><span>${isAlt ? 'Alternate route' : 'Route'} · ${wps.length} point${wps.length === 1 ? '' : 's'}</span>
    <span><button class="btn small" data-act="windall">Wind for all legs</button> <button class="btn small" data-act="reverse">Reverse</button> <button class="btn small danger" data-act="clear">Clear</button></span></div>`;

  if (!wps.length) {
    html += `<div class="group"><div class="empty">${isAlt ? 'Tap the chart to plan the route to your alternate. It starts at your destination.' : 'Tap the chart to add your first waypoint.'}</div></div>`;
  } else {
    html += `<div class="group ${isAlt ? 'alt-mode' : ''}">`;
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
        const tasPh = (i === 1 && r.stdDep) || (i === wps.length - 1 && r.stdArr) ? SOP.tasBase : cruiseTas(altFt);
        const m = midpoint(wps[i - 1], w);
        const windy = `https://www.windy.com/?wind,${windyLevel(altFt)},${m.lat.toFixed(3)},${m.lon.toFixed(3)},9`;
        html += `<div class="leg">
          <label class="field"><span>Alt / FL</span><input data-f="alt" inputmode="text" value="${esc(w.alt ?? '')}" placeholder="5500"></label>
          <label class="field narrow"><span>Wind °T</span><input data-f="wdir" inputmode="numeric" value="${esc(w.wdir ?? '')}" placeholder="000"></label>
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
          html += `<div class="leg-out"><span>TC <b>${last.tc}°</b></span><span>MH <b>${last.mh}°</b></span><span>Dist <b>${dist} NM</b></span><span>GS <b>${last.gs} kt</b></span><span>ETE <b>${fmtMMSS(ete)}</b></span><span>Fuel <b>${fuel} L</b></span>${legRows.length > 1 ? `<span>incl. <b>${legRows[0].to}</b></span>` : ''}</div>`;
        }
      }
      html += '</div>';
    });
    html += '</div>';
  }
  html += `<p class="note">Winds must come from an approved source (SOP 2511): <a href="https://www.windy.com" target="_blank" rel="noopener">windy.com</a> or <a href="https://ama.aemet.es/en" target="_blank" rel="noopener">ama.aemet.es</a>. Enter true wind direction. VAR is east-positive (Burgos 1°E): MC = TC − VAR E. Drag the small dot in the middle of a leg to insert a waypoint; drag a waypoint to move it.</p>`;
  panels.route.innerHTML = html;
}

panels.route.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.flag) { route()[t.dataset.flag] = t.checked; return update({ rerenderPanels: true }); }
  const row = t.closest('.wp'); if (!row || !t.dataset.f) return;
  const w = route().waypoints.find((x) => x.id === +row.dataset.id); if (!w) return;
  const f = t.dataset.f;
  let v = t.value.trim();
  if (f === 'wdir') v = v === '' ? '' : ((+v % 360) + 360) % 360;
  if (f === 'wspd' || f === 'tas') v = v === '' ? '' : Math.max(0, +v);
  if (f === 'var') v = v === '' ? '' : +v;
  if (f === 'alt') v = /^fl/i.test(v) ? v.toUpperCase().replace(/\s+/g, '') : (v === '' ? '' : parseAlt(v));
  w[f] = v;
  update({ rerenderPanels: true });
});
panels.route.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const r = route();
  const act = b.dataset.act;
  if (act === 'clear') {
    if (!confirm(`Clear the ${state.active === 'alt' ? 'alternate' : 'main'} route?`)) return;
    r.waypoints = state.active === 'main' ? [adWaypoint(LEBG)] : [];
  } else if (act === 'reverse') {
    r.waypoints.reverse();
  } else if (act === 'windall') {
    const s = prompt('Wind for all legs (true direction/speed), e.g. 240/12');
    const m = s && s.match(/(\d{1,3})\D+(\d{1,3})/);
    if (!m) return;
    r.waypoints.forEach((w, i) => { if (i > 0) { w.wdir = +m[1] % 360; w.wspd = +m[2]; } });
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
    if (tab !== 'route') document.querySelector('#tabs [data-tab=route]').click();
    if (sheetDetent === 0) setDetent(1);
    const el = panels.route.querySelector(`.wp[data-id="${id}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function headerFor(key) {
  const f = state.flight;
  const t = flightTime();
  const date = t.toLocaleDateString('en-GB');
  const mainDep = endpoint('main', 0), mainDest = endpoint('main', -1), altDest = endpoint('alt', -1);
  const fp = result.fuel;
  const mb = result.mb;
  const ads = [mainDep, mainDest, altDest].filter(Boolean).filter((a, i, arr) => arr.findIndex((b) => b.icao === a.icao) === i);
  const freq = ads.map((a) => a.freq).join(' | ');
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
    <label class="field"><span>Callsign</span><input data-ff="callsign" value="${esc(f.callsign)}" placeholder="FBY…" autocapitalize="characters"></label>
    <label class="field"><span>Reg</span><select data-ff="reg">${Object.keys(AC.regs).map((r) => `<option ${r === f.reg ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
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
    html += `<tr class="top ${cls}"><td class="wpt"></td><td rowspan="2">${r.tc}</td><td>${fmtVar(r.var)}</td><td rowspan="2">${fmtAlt(r.alt, r.altLabel)}</td><td rowspan="2">${r.tas}</td>
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
  <p class="note">Blue ETEs are SOP standard times (departure ${SOP.stdDepMin} min, arrival ${SOP.stdArrMin} min). TOC/TOD at ${SOP.roc} ft/min using GS; climb ${SOP.tasClimb} kt / ${SOP.ffClimb} L/h, descent ${SOP.tasDescent} kt / ${SOP.ffDescent} L/h, cruise ${SOP.ffCruise} L/h (SOP 2511 general rule). ETA, ATE, ATA are filled in flight.</p>
  <button class="btn primary wide" data-act="pdf">Download navlog PDF (FlyBy form)</button>`;
  panels.navlog.innerHTML = html;
}
panels.navlog.addEventListener('change', (e) => {
  const k = e.target.dataset.ff; if (!k) return;
  state.flight[k] = k === 'callsign' ? e.target.value.toUpperCase().trim() : e.target.value;
  update({ rerenderPanels: true });
});
panels.navlog.addEventListener('click', (e) => { if (e.target.closest('[data-act=pdf]')) downloadPdf(); });

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
  ${f.taxi === '' ? row('Taxi fuel', 'Enter from POH', 'check-bad') : ''}</div>
  <p class="note">Fuel in litres, mass in kg (SOP 2511). Planning rates are the Flight Planning Manual general rule; the P2008 SOP asks for the most restrictive values of the AFM cruise chart (e.g. 19.2 L/h at 4000 ft / 2100 RPM) — check the POH for your aircraft and RPM. Cross-country flights depart with full tanks within M&amp;B limits.</p>`;
  panels.fuel.innerHTML = html;
}
panels.fuel.addEventListener('change', (e) => {
  const k = e.target.dataset.ff; if (!k) return;
  state.flight[k] = e.target.value === '' ? '' : Math.max(0, +e.target.value);
  update({ rerenderPanels: true });
});

function renderMB() {
  const f = state.flight;
  const m = result.mb;
  const reg = AC.regs[f.reg];
  const row = (l, v, cls = '') => `<div class="row ${cls}"><span class="grow label">${l}</span><span class="value">${v}</span></div>`;
  const cgOk = (cg) => cg >= AC.cg[0] && cg <= AC.cg[1];
  let html = `<div class="group-title"><span>${AC.type} · MTOW ${AC.mtow} kg</span></div>
  <div class="group"><div class="row" style="gap:6px;flex-wrap:wrap">
    <label class="field"><span>Registration</span><select data-ff="reg">${Object.keys(AC.regs).map((r) => `<option ${r === f.reg ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
    <label class="field"><span>Pilot (kg)</span><input data-ff="pilot" inputmode="decimal" value="${esc(f.pilot)}" placeholder="real mass"></label>
    <label class="field"><span>Copilot / FI (kg)</span><input data-ff="copilot" inputmode="decimal" value="${esc(f.copilot)}" placeholder="0 if solo"></label>
    <label class="field"><span>Baggage (kg)</span><input data-ff="baggage" inputmode="decimal" value="${esc(f.baggage)}"></label>
  </div></div>`;
  if (m) {
    html += `<div class="group">
      ${row('Empty mass', `${reg[0]} kg · ${reg[1]} kg·m`)}
      ${row(`Fuel on board (${f.fob} L × ${AC.fuelDensity})`, `${(f.fob * AC.fuelDensity).toFixed(1)} kg`)}
      ${row('Takeoff mass', `${m.tom.toFixed(1)} kg`, m.tom <= AC.mtow ? 'check-ok' : 'check-bad')}
      ${row(`Takeoff CG (${AC.cg[0]} – ${AC.cg[1]} m)`, `${m.toCg.toFixed(3)} m`, cgOk(m.toCg) ? 'check-ok' : 'check-bad')}
      ${row('Landing mass (destination)', `${m.lm.toFixed(1)} kg`)}
      ${row('Landing CG', `${m.ldgCg.toFixed(3)} m`, cgOk(m.ldgCg) ? 'check-ok' : 'check-bad')}
      ${row('Landing mass (alternate)', `${m.lmAlt.toFixed(1)} kg`)}
    </div>`;
  }
  html += `<p class="note">Arms from the FlyBy P2008 JC M&amp;B sheet: pilot/copilot 1.800 m, baggage 2.417 m, fuel 2.209 m. Use the real fuel quantity from FISUP and real masses (SOP). The full M&amp;B sheet will be added to the briefing PDF.</p>`;
  panels.mb.innerHTML = html;
}
panels.mb.addEventListener('change', (e) => {
  const k = e.target.dataset.ff; if (!k) return;
  state.flight[k] = k === 'reg' ? e.target.value : (e.target.value === '' ? '' : Math.max(0, +e.target.value));
  update({ rerenderPanels: true });
});

function renderPanels() {
  document.querySelectorAll('#routeSel button').forEach((b) => b.classList.toggle('on', b.dataset.route === state.active));
  document.getElementById('routeSel').hidden = tab === 'fuel' || tab === 'mb';
  if (tab === 'route') renderRoute();
  if (tab === 'navlog') renderNavlog();
  if (tab === 'fuel') renderFuel();
  if (tab === 'mb') renderMB();
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

/* ---------------- Update loop ---------------- */

let saveTimer = null;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 300); }

function update(opts = {}) {
  result = compute();
  drawRoutes();
  renderSummary();
  renderTime();
  if (opts.rerenderPanels !== false) renderPanels();
  scheduleSave();
}

/* ---------------- PDF ---------------- */

async function downloadPdf() {
  if (result.main.rows.length === 0) return toast('Add at least two waypoints first.');
  try {
    toast('Building navlog…');
    const sheets = [{ header: headerFor('main'), rows: result.main.rows }];
    if (result.alt.rows.length) sheets.push({ header: headerFor('alt'), rows: result.alt.rows });
    const bytes = await buildNavlogPdf(sheets);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const h = sheets[0].header;
    const name = `Navlog_${h.dep}-${h.dest}_${flightTime().toISOString().slice(0, 10)}.pdf`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60e3);
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
  sheet.classList.toggle('anim', animate);
  document.documentElement.style.setProperty('--sheet-h', `${sheetH()}px`);
  sheet.style.transform = '';
}
(function sheetDrag() {
  const handles = [document.getElementById('grabber'), document.getElementById('summary')];
  let startY = 0, startH = 0, hist = [], dragging = false, moved = false;
  handles.forEach((hd) => hd.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
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

/* ---------------- Boot ---------------- */

syncSlider();
setDetent(1, false);
togglePoints();
initBase();
update();
if (state.main.waypoints.length > 1) setTimeout(fitRoute, 50);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Expose for debugging in the console
window.navlogApp = { map, get state() { return state; }, get result() { return result; } };
