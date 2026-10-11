// School rules taken from the SOPs, the LEBG/LERJ airport briefings and the Phase 2/3 manuals,
// plus helpers that turn a plan into the briefing items (FPL, departure/arrival briefing, TEM).

// Aerodromes students fly to under VFR (to be confirmed with the school). LEBB: IFR only.
import { hhmmZl } from './time.js';

export const APPROVED = ['LEBG', 'LERJ', 'LEVT', 'LEVD', 'LELN', 'LEPP', 'LESO', 'LEHC', 'LEXJ', 'LESA'];
export const IFR_ONLY = ['LEBB'];
export const EASY_FIRST = ['LEVD', 'LELN', 'LEVT', 'LERJ', 'LEBG', 'LESA', 'LEPP', 'LEXJ', 'LESO', 'LEHC'];
// Phase 3 / solo manual: airports that require a full-stop landing.
export const FULL_STOP = ['LELN', 'LEVD'];
// Phase 3 manual (night alternate policy): closing time, local.
export const CLOSING_LOCAL = {
  LERJ: { 1: '22:00', 2: '22:00', 3: '22:00', 4: '22:00', 5: '22:00', 6: '19:30', 0: '21:30' },
  LEBG: 'max 23:00 (depends on extension agreement)',
  LEVT: 'H24', LEVD: '21:15', LEZG: '23:00', LEXJ: '23:00', LEPP: '23:45', LELN: '21:00', LEBB: '23:30',
};
// AIP AD 2.4: no AVGAS 100LL (LELN military F-34 only, LEHC JET A-1 only).
export const NO_REFUEL = ['LELN', 'LEHC'];

/**
 * AIP AD 2 notes for the school's VFR aerodromes (AD 2.3 hours, AD 2.4 fuel, AD 2.20 local
 * regulations), checked on the AIRAC in force on 11 Oct 2026. `fuel`: AVGAS 100LL available.
 * Each note: { text, level ('bad'|'warn'|'info'), roles (dep/arr/alt; default all), when(t) }.
 */
const weekday = (t) => { const d = t.getUTCDay(); return d >= 1 && d <= 5; };
export const AIP_NOTES = {
  LEBG: { fuel: '100LL (fuelling hours AD 2.3; other hours PPR)', notes: [
    { text: 'Flight plan and radio mandatory in public and restricted-use hours (AD 2.20)' },
    { text: 'During AFIS hours no more than one aircraft doing touch-and-go at a time (AD 2.20)', roles: ['arr'] },
  ] },
  LERJ: { fuel: '100LL — PPR, TEL +34 649 462 986 (AD 2.4)', notes: [
    { text: 'Flight plan addressed to LERJZTZX and LELOZTZX (AD 2.20)', roles: ['dep', 'arr'] },
  ] },
  LEVT: { fuel: '100LL (SLCA +34 680 621 455)', notes: [
    { text: 'Request start-up clearance from TWR; backtrack not authorised (AD 2.20)', roles: ['dep'] },
  ] },
  LEVD: { fuel: '100LL (civil)', notes: [
    { text: 'Civil training flights: PPR at least 72 h before (PREPARACIÓN_VUELOS_LEVD@mde.es, ala37_ATC@mde.es) (AD 2.20)', level: 'warn', roles: ['arr', 'alt'] },
    { text: 'No practice approaches or touch-and-go; landing only with a flight plan to LEVD (AD 2.20)', roles: ['arr', 'alt'] },
  ] },
  LELN: { fuel: null, notes: [
    { text: 'No AVGAS (military F-34 only, AD 2.4)', roles: ['arr', 'alt'] },
    { text: 'Approaches / touch-and-go only with an accepted flight plan to LELN (AD 2.20)', roles: ['arr', 'alt'] },
  ] },
  LEPP: { fuel: '100LL (fuelling hours AD 2.3, Exolum +34 948 168 781)', notes: [
    { text: 'Hold over N, E or W if TWR says so before CTR entry (VAC)', roles: ['arr', 'alt'] },
  ] },
  LESO: { fuel: '100LL (Exolum +34 943 668 538)', notes: [
    { text: 'Training / general aviation: apron clearance from LESO Operations Office before the flight (OperacionesEAS@aena.es, +34 943 668 504) — flights without it are rejected (AD 2.20)', level: 'warn', roles: ['arr', 'alt'] },
    { text: 'Engines off at the GA engine shutdown area, aircraft towed to the stand; departures start up there (AD 2.20)' },
  ] },
  LEXJ: { fuel: '100LL (Exolum +34 942 253 414)', notes: [
    { text: 'Request start-up clearance from ATC, ready to start within 5 min (AD 2.20)', roles: ['dep'] },
    { text: 'Ground handling mandatory if anyone goes to the terminal; school operations only as commercial traffic allows, AENA training fees (AD 2.20)', roles: ['arr', 'alt'] },
  ] },
  LEHC: { fuel: null, notes: [
    { text: 'No AVGAS (JET A-1 only, AD 2.4)', roles: ['arr', 'alt'] },
    { text: 'Flight plan and radio mandatory; approaches / touch-and-go only with destination LEHC; school flights not on RWY 12L/30R (AD 2.20)', roles: ['arr', 'alt'] },
  ] },
  LESA: { fuel: 'AVGAS (civil)', notes: [
    { text: 'VFR and school flights not cleared Monday–Friday unless a public holiday (AD 2.20)', level: 'bad', when: weekday, roles: ['arr', 'alt'] },
    { text: 'Practice approaches / landings only on weekends and holidays, request 72 h before (AD 2.20)', roles: ['arr', 'alt'] },
  ] },
};

/** AIP notes that apply to an aerodrome in a role ('dep' | 'arr' | 'alt') at time t. */
export function aipNotes(icao, role, t) {
  const a = AIP_NOTES[icao];
  if (!a) return [];
  return a.notes.filter((n) => (!n.roles || n.roles.includes(role)) && (!n.when || n.when(t))).map((n) => ({ level: n.level || 'info', text: `${icao}: ${n.text}` }));
}

// LEBG / LERJ airport briefings (SOP2507 rev 2.2, SOP2509 rev 2.3): aerodrome hours in UTC.
// Index 0 = Monday … 6 = Sunday. Arrays hold [open, close] pairs.
const H = (s) => s.split(' ');
export const HOURS_UTC = {
  LEBG: {
    summer: { open: H('06:00 07:30 07:30 06:00 07:30 07:30 07:30'), close: H('18:00 17:00 17:00 18:00 17:00 16:30 17:00'),
      afis: [H('08:30 08:30 08:30 08:30 08:30 - -'), H('16:00 16:00 16:00 16:00 16:00 - -')] },
    winter: { open: H('07:00 08:30 08:30 07:00 08:30 08:30 08:30'), close: H('19:00 18:00 18:00 19:00 18:00 17:30 18:00'),
      afis: [H('09:30 09:30 09:30 09:30 09:30 - -'), H('17:00 17:00 17:00 17:00 17:00 - -')] },
  },
  // AIP AD 2.3 (AIRAC in force 11 Oct 2026), civil hours; same every day unless noted.
  LEVD: { summer: { open: H('06:00 06:00 06:00 06:00 06:00 06:30 06:30'), close: H('19:15 19:15 19:15 19:15 19:15 18:30 18:30') },
    winter: { open: H('07:00 07:00 07:00 07:00 07:00 07:30 07:30'), close: H('20:15 20:15 20:15 20:15 20:15 19:30 19:30') } },
  LELN: { summer: { open: H('07:30 07:30 07:30 07:30 07:30 07:30 07:30'), close: H('19:00 19:00 19:00 19:00 19:00 19:00 19:00') },
    winter: { open: H('08:30 08:30 08:30 08:30 08:30 08:30 08:30'), close: H('20:00 20:00 20:00 20:00 20:00 20:00 20:00') } },
  LEPP: { summer: { open: H('04:30 04:30 04:30 04:30 04:30 04:30 04:30'), close: H('21:45 21:45 21:45 21:45 21:45 21:45 21:45') },
    winter: { open: H('05:30 05:30 05:30 05:30 05:30 05:30 05:30'), close: H('22:45 22:45 22:45 22:45 22:45 22:45 22:45') } },
  LESO: { summer: { open: H('05:30 05:30 05:30 05:30 05:30 05:30 05:30'), close: H('19:45 19:45 19:45 19:45 19:45 19:45 19:45') },
    winter: { open: H('06:30 06:30 06:30 06:30 06:30 06:30 06:30'), close: H('20:45 20:45 20:45 20:45 20:45 20:45 20:45') } },
  LEXJ: { summer: { open: H('04:30 04:30 04:30 04:30 04:30 04:30 04:30'), close: H('21:00 21:00 21:00 21:00 21:00 21:00 21:00') },
    winter: { open: H('05:30 05:30 05:30 05:30 05:30 05:30 05:30'), close: H('22:00 22:00 22:00 22:00 22:00 22:00 22:00') } },
  LEHC: { summer: { open: H('07:00 07:00 07:00 07:00 07:00 07:00 07:00'), close: H('17:00 17:00 17:00 17:00 17:00 17:00 17:00') },
    winter: { open: H('08:00 08:00 08:00 08:00 08:00 08:00 08:00'), close: H('16:00 16:00 16:00 16:00 16:00 16:00 16:00') } },
  LESA: { summer: { open: H('08:00 08:00 08:00 08:00 08:00 08:00 08:00'), close: H('19:00 19:00 19:00 19:00 19:00 19:00 19:00') },
    winter: { open: H('07:30 07:30 07:30 07:30 07:30 07:30 07:30'), close: H('16:30 16:30 16:30 16:30 16:30 16:30 16:30') } },
  LERJ: {
    // Sunday has a midday closure: 13:15–14:15 (summer) / 14:15–15:15 (winter)
    summer: { open: H('05:25 05:25 05:25 05:25 05:25 06:30 08:30'), close: H('20:00 20:00 20:00 20:00 20:00 17:30 19:30'), gapSun: ['13:15', '14:15'] },
    winter: { open: H('06:25 06:25 06:25 06:25 06:25 07:30 09:30'), close: H('21:00 21:00 21:00 21:00 21:00 18:30 20:30'), gapSun: ['14:15', '15:15'] },
  },
};

export const FREQS = {
  LEBG: 'LEBG AFIS 125.430', LEVT: 'LEVT TWR 118.450', LERJ: 'LERJ TWR 118.580', OPS: 'OPS 130.705',
};

function lastSunday(year, month) { // month 0-based
  const d = new Date(Date.UTC(year, month + 1, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}
export function isEuSummer(t) {
  const y = t.getUTCFullYear();
  const start = lastSunday(y, 2); start.setUTCHours(1);
  const end = lastSunday(y, 9); end.setUTCHours(1);
  return t >= start && t < end;
}
const minutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** Is the aerodrome open at time t (Date)? Returns { known, open, text } */
export function aerodromeOpen(icao, t) {
  const tbl = HOURS_UTC[icao];
  if (!tbl) {
    const c = CLOSING_LOCAL[icao];
    const lt = typeof c === 'string' ? c : c && c[t.getDay()];
    let txt = lt;
    if (/^\d{1,2}:\d{2}$/.test(lt || '')) {
      const [h, m] = lt.split(':').map(Number);
      const u = (h * 60 + m - (isEuSummer(t) ? 120 : 60) + 1440) % 1440;
      txt = `${String(Math.floor(u / 60)).padStart(2, '0')}:${String(u % 60).padStart(2, '0')}Z (${lt})`;
    }
    if (c === 'H24') return { known: true, open: true, text: 'open H24 (AIP AD 2.3)' };
    return { known: false, text: c ? `closes ${txt} (Phase 3 manual)` : 'check AD 2.3 for hours' };
  }
  const season = isEuSummer(t) ? 'summer' : 'winter';
  const s = tbl[season];
  const day = (t.getUTCDay() + 6) % 7;
  const now = t.getUTCHours() * 60 + t.getUTCMinutes();
  const o = minutes(s.open[day]), c = minutes(s.close[day]);
  let open = now >= o && now <= c;
  if (open && s.gapSun && day === 6 && now > minutes(s.gapSun[0]) && now < minutes(s.gapSun[1])) open = false;
  const z = (h) => hhmmZl(h, t);
  let text = `${season} hours today ${z(s.open[day])}–${z(s.close[day])}`;
  if (s.gapSun && day === 6) text += ` (closed ${z(s.gapSun[0])}–${z(s.gapSun[1])})`;
  if (s.afis) {
    const a0 = s.afis[0][day], a1 = s.afis[1][day];
    text += a0 === '-' ? ' · no AFIS today' : ` · AFIS ${z(a0)}–${z(a1)}`;
  }
  return { known: true, open, text };
}

/* ---------------- Airspace crossing ---------------- */

function pointInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if (((yi > lat) !== (yj > lat)) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inside(lat, lon, rings) {
  let n = 0;
  for (const r of rings) if (pointInRing(lat, lon, r)) n++;
  return n % 2 === 1; // outer ring + holes
}
const bbox = (rings) => {
  let s = 90, w = 180, n = -90, e = -180;
  for (const r of rings) for (const [la, lo] of r) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
  return { s, w, n, e };
};

/**
 * legs: [{ a:{lat,lon}, b:{lat,lon}, alt (ft), name }]. Returns airspaces the route enters at its altitude.
 */
export function airspaceCrossings(legs, airspaces) {
  const hits = new Map();
  if (!airspaces || !airspaces.length) return [];
  for (const sp of airspaces) { if (!sp._bb) sp._bb = bbox(sp.rings); }
  for (const leg of legs) {
    const n = Math.max(2, Math.ceil(leg.dist / 0.5));
    for (let k = 0; k <= n; k++) {
      const lat = leg.a.lat + (leg.b.lat - leg.a.lat) * (k / n);
      const lon = leg.a.lon + (leg.b.lon - leg.a.lon) * (k / n);
      for (const sp of airspaces) {
        const bb = sp._bb;
        if (lat < bb.s || lat > bb.n || lon < bb.w || lon > bb.e) continue;
        // AGL limits: lower treated as surface, upper with ~3000 ft of terrain (conservative)
        const lo = sp.agl || sp.lowerFt == null ? 0 : sp.lowerFt;
        const hi = sp.upperFt == null ? 99999 : sp.upperFt + (sp.upperAgl ? 3000 : 0);
        if (leg.alt != null && (leg.alt < lo - 100 || leg.alt > hi + 100)) continue;
        if (!inside(lat, lon, sp.rings)) continue;
        const key = sp.type + sp.id + sp.name;
        if (!hits.has(key)) hits.set(key, { sp, leg: leg.name });
      }
    }
  }
  return [...hits.values()];
}

export function crossingIssue({ sp, leg }) {
  const label = [sp.id, sp.name].filter(Boolean).join(' ') || sp.type;
  const varies = sp.lowerFt == null && sp.lower && sp.lower.length > 12;
  const limits = varies ? `lower limit varies by sector — check the chart, upper ${sp.upper || '?'}` : `${sp.lower || 'SFC'}–${sp.upper || '?'}`;
  const freq = sp.freq ? ` · ${sp.freq}` : '';
  switch (sp.type) {
    case 'P': case 'Prohibido_Sobrevuelo': case 'PROHIBIDO VFR':
      return { level: 'bad', text: `${leg}: crosses prohibited area ${label} (${limits}) — reroute` };
    case 'R': case 'TSA': case 'TRA':
      return { level: 'bad', text: `${leg}: crosses restricted area ${label} (${limits}) — reroute or check activation by NOTAM` };
    case 'D':
      return { level: 'warn', text: `${leg}: crosses danger area ${label} (${limits}) — check activity (NOTAM)` };
    case 'CTR': case 'CTA': case 'TMA':
      return { level: 'info', text: `${leg}: ${varies ? 'may enter' : 'enters'} ${sp.type} ${label}${sp.class ? ' class ' + sp.class : ''} (${limits}) — clearance required${freq}` };
    case 'FIZ': case 'ATZ': case 'RMZ': case 'TMZ':
      return { level: 'info', text: `${leg}: enters ${sp.type} ${label} (${limits}) — call before entering${freq}` };
    default:
      return { level: 'info', text: `${leg}: enters ${sp.type} ${label} (${limits})` };
  }
}

/* ---------------- Briefing texts ---------------- */

const pad = (n, w = 2) => String(n).padStart(w, '0');
function coordFpl(lat, lon) {
  const la = Math.abs(lat), lo = Math.abs(lon);
  return `${pad(Math.floor(la))}${pad(Math.round((la % 1) * 60))}${lat >= 0 ? 'N' : 'S'}${pad(Math.floor(lo), 3)}${pad(Math.round((lo % 1) * 60))}${lon >= 0 ? 'E' : 'W'}`;
}

/** ICAO flight plan (VFR) draft — to be checked and filed by the student. */
export function buildFpl({ callsign, reg, acType = 'P208', wake = 'L', equip = 'S/C', dep, dest, alts = [], eobt, tas, wps, eetMin, night, dof, endurance, pob }) {
  const route = wps.slice(1, -1).map((w) => (w.fplName ? w.fplName : coordFpl(w.lat, w.lon))).join(' DCT ');
  const hhmm = (d) => `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  const eet = `${pad(Math.floor(eetMin / 60))}${pad(eetMin % 60)}`;
  const item18 = [`DOF/${dof}`, reg ? `REG/${reg.replace('-', '')}` : null, `OPR/FLYBY`, night ? 'RMK/NIGHT VFR FLIGHT' : null].filter(Boolean).join(' ');
  const lines = [
    `(FPL-${(callsign || 'XXXXX').toUpperCase()}-VG`,
    `-1/${acType}/${wake}-${equip}`,
    `-${dep}${hhmm(eobt)}`,
    `-N${pad(Math.round(tas), 4)}VFR ${route ? 'DCT ' + route + ' DCT' : 'DCT'}`,
    `-${dest}${eet}${alts.length ? ' ' + alts.join(' ') : ''}`,
    `-${item18}`,
    `-E/${endurance || '????'} P/${pob || '?'})`,
  ];
  return lines.join('\n');
}

export function departureBriefing({ dep, exitPoint, procAlt, cruiseAlt, firstMh, next, procRoute }) {
  if (!dep) return '';
  const via = procRoute && procRoute.length > 1 ? ` via ${procRoute.slice(0, -1).join(', ')}` : '';
  return `After departure we will proceed to ${exitPoint || 'the exit point'}${via} at ${procAlt || '—'} ft following the VAC. `
    + `Over ${exitPoint || 'the point'} we will ${cruiseAlt && procAlt && cruiseAlt > procAlt ? `climb to ${cruiseAlt} ft` : `maintain ${cruiseAlt || procAlt || '—'} ft`}`
    + `${firstMh ? ` on heading ${pad(firstMh, 3)}°` : ''}${next ? ` towards ${next}` : ''}.`;
}

export function arrivalBriefing({ dest, entryPoint, procAlt, procRoute, rwy, pattern, threats }) {
  if (!dest) return '';
  const via = procRoute && procRoute.length > 1 ? `, routing ${procRoute.slice(1).join(' → ')}` : '';
  return `We are on ${entryPoint || 'the entry point'}${via}, ${procAlt ? `at ${procAlt} ft` : 'at the VAC altitude'}, `
    + `runway in use ${rwy || '__'}${pattern ? `, ${pattern}` : ''}. Standard landing. `
    + `The threat is ${threats || '__'}.`;
}

/** Threat & error management: pre-listed threats relevant to the aerodromes and route. */
export function temThreats({ ads, crossings = [], solo = false, night = false, mountains = false, hot = false }) {
  const t = [];
  if (ads.includes('LEBG')) {
    t.push('LEBG: solo traffic and touch-and-goes in the pattern — coordinate on 130.705');
    t.push('LEBG: VFR must stay outside 15 NM of BUR when IFR code B/C/D traffic is expected (SOP2507)');
    t.push('LEBG: FlyBy traffic at 5000 ft over BUR simulating IFR — coordinate');
    t.push('LEBG: noise abatement — avoid the Cartuja de Miraflores, especially 15:00–16:00 LT');
    t.push('LEBG: runway inspections by fire service around 13:00 and 16:30 LT');
    if (hot) t.push('LEBG: OAT above 30 °C — use the full runway length');
  }
  if (ads.includes('LERJ')) {
    t.push('LERJ: do not overfly the military base or the runway south of the civil aerodrome');
    t.push('LERJ: possible vultures in the South corridor between S, S-1 and the field');
    t.push('LERJ: medical helicopters near the ATZ north of the W route');
    t.push('LERJ: be at 3000 ft or higher before entering the W corridor');
  }
  if (ads.includes('LEVT') || ads.includes('LEBG')) t.push('LEVT CTA: request entry ~2 NM before, report leaving on 118.450');
  for (const c of crossings) {
    if (['R', 'D', 'P', 'TSA', 'TRA'].includes(c.sp.type)) t.push(`${c.sp.type} area ${c.sp.id || c.sp.name} near/along the route (${c.sp.lower || 'SFC'}–${c.sp.upper || '?'})`);
  }
  t.push('Wind turbines and masts along the route — check obstacle heights on the chart');
  if (mountains) t.push('Mountainous terrain — 2000 ft above terrain, 1000 ft below cloud base (SOP)');
  if (solo) t.push('Solo flight — LEBG entry only via N or W; stay within your unlocked aerodromes');
  if (night) t.push('Night flight — two alternates, closing times of alternates, NIGHT VFR FLIGHT in FPL item 18');
  return [...new Set(t)];
}
