// Reference data. Every value here is copied from an official source:
//  - Aerodromes and VFR reporting points: AIP España AD 2 (ENAIRE), VAC charts.
//  - P2008 fleet empty masses / moments: FlyBy LNAV - P2008 workbook (M&B sheet).
//  - Planning figures: FlyBy SOP 2511 Phase 2 Training Manual, Flight Planning Manual.
// Check against the current AIRAC before flight. Coordinates are DDMMSS as printed.

export function dms(s) {
  // "422127N" or "0033649W" -> decimal degrees
  const m = s.match(/^(\d{2,3})(\d{2})(\d{2}(?:\.\d+)?)([NSEW])$/);
  if (!m) throw new Error('Bad coordinate ' + s);
  const v = +m[1] + +m[2] / 60 + +m[3] / 3600;
  return m[4] === 'S' || m[4] === 'W' ? -v : v;
}

const pt = (lat, lon) => ({ lat: dms(lat), lon: dms(lon) });

export const AERODROMES = [
  {
    icao: 'LEBG', name: 'Burgos/Villafría', ...pt('422127N', '0033649W'),
    elev: 2962, var: 1, freq: 'LEBG:125.430',
    freqNote: 'AFIS Burgos Información 125.430 (pilot-to-pilot outside ATS hours)',
    vac: 'https://aip.enaire.es/AIP/contenido_AIP/AD/AD2/LEBG/LE_AD_2_LEBG_VAC_1_en.pdf',
    ad2: 'https://aip.enaire.es/AIP/contenido_AIP/AD/AD2/LEBG/LE_AD_2_LEBG_en.pdf',
    vrps: [
      { id: 'N', name: 'San Martín de Ubierna', ...pt('423040N', '0034230W') },
      { id: 'W', name: 'Las Quintanillas', ...pt('422220N', '0035035W') },
      { id: 'S', name: 'Cogollos', ...pt('421200N', '0034200W') },
      { id: 'E', name: 'Villasur de Herreros', ...pt('421830N', '0032330W') },
      { id: 'E-1', name: 'Gravera de Espinosa de Juarros', ...pt('421710N', '0033300W') },
    ],
  },
  {
    icao: 'LEVT', name: 'Vitoria', ...pt('425258N', '0024328W'),
    elev: 1682, var: 1, freq: 'LEVT:118.450',
    freqNote: 'Vitoria TWR 118.450',
    vac: 'https://aip.enaire.es/AIP/contenido_AIP/AD/AD2/LEVT/LE_AD_2_LEVT_VAC_1_en.pdf',
    ad2: 'https://aip.enaire.es/AIP/contenido_AIP/AD/AD2/LEVT/LE_AD_2_LEVT_en.pdf',
    vrps: [
      { id: 'N', name: 'Amezaga', ...pt('425820N', '0025008W') },
      { id: 'E', name: 'Salvatierra', ...pt('425125N', '0021940W') },
      { id: 'S', name: 'Peñacerrada', ...pt('423930N', '0024250W') },
      { id: 'W', name: 'Morillas', ...pt('425015N', '0025400W') },
    ],
  },
  {
    icao: 'LEVD', name: 'Valladolid/Villanubla', lat: 41.706, lon: -4.851861,
    elev: 2775, var: -1, freq: 'LEVD:122.205',
    freqNote: 'Valladolid TWR / APP 122.205',
    vac: 'https://aip.enaire.es/AIP/contenido_AIP/AD/AD2/LEVD/LE_AD_2_LEVD_VAC_1_en.pdf',
    ad2: 'https://aip.enaire.es/AIP/contenido_AIP/AD/AD2/LEVD/LE_AD_2_LEVD_en.pdf',
    vrps: [
      { id: 'N', name: 'Becilla', ...pt('420551N', '0051229W') },
      { id: 'NE', name: 'Quintana del Puente', ...pt('420500N', '0041236W') },
      { id: 'E', name: 'Peñafiel', ...pt('413605N', '0040706W') },
      { id: 'S', name: 'Olmedo', ...pt('411824N', '0044150W') },
      { id: 'W', name: 'San Cebrián de Mazote', ...pt('414051N', '0050849W') },
      { id: 'N-1', name: 'La Mudarra', ...pt('414725N', '0045641W') },
      { id: 'S-1', name: 'Zaratán', ...pt('413947N', '0044711W') },
    ],
  },
  {
    icao: 'LELN', name: 'León', lat: 42.588594, lon: -5.656179,
    elev: 3006, var: -1, freq: 'LELN:122.105',
    freqNote: 'León TWR 122.105 · APP 121.280',
    vac: 'https://aip.enaire.es/AIP/contenido_AIP/AD/AD2/LELN/LE_AD_2_LELN_VAC_1_en.pdf',
    ad2: 'https://aip.enaire.es/AIP/contenido_AIP/AD/AD2/LELN/LE_AD_2_LELN_en.pdf',
    vrps: [
      { id: 'N', name: 'La Robla', ...pt('424809N', '0053743W') },
      { id: 'SE', name: 'Santas Martas', ...pt('422740N', '0052305W') },
      { id: 'S', name: 'Palazuelo', ...pt('420911N', '0053845W') },
      { id: 'S-1', name: 'Onzonilla', ...pt('423134N', '0053432W') },
    ],
  },
  {
    icao: 'LERJ', name: 'Logroño/Agoncillo', ...pt('422738N', '0021914W'),
    elev: 1156, var: 0, freq: 'LERJ:118.580',
    freqNote: 'Rioja TWR 118.580 · GMC 121.705',
    vac: 'https://aip.enaire.es/AIP/contenido_AIP/AD/AD2/LERJ/LE_AD_2_LERJ_VAC_1_en.pdf',
    ad2: 'https://aip.enaire.es/AIP/contenido_AIP/AD/AD2/LERJ/LE_AD_2_LERJ_en.pdf',
    vrps: [
      { id: 'N', name: 'Irache', ...pt('423825N', '0020337W') },
      { id: 'N-1', name: 'Circuito de los Arcos', ...pt('423335N', '0021004W') },
      { id: 'N-2', name: 'Lazagurría', ...pt('422959N', '0021504W') },
      { id: 'E', name: 'Puente LR-115 Río Ebro', ...pt('421459N', '0015016W') },
      { id: 'E-1', name: 'El Villar de Arnedo', ...pt('421907N', '0020507W') },
      { id: 'E-2', name: 'Nudo N-232/AP-68', ...pt('422354N', '0021443W') },
      { id: 'S', name: 'Jalón de Cameros', ...pt('421305N', '0022922W') },
      { id: 'S-1', name: 'Ribafrecha', ...pt('422114N', '0022300W') },
      { id: 'W', name: 'Hormilla', ...pt('422615N', '0024551W') },
      { id: 'W-1', name: 'Navarrete', ...pt('422543N', '0023339W') },
      { id: 'W-2', name: 'Villamediana de Iregua', ...pt('422524N', '0022528W') },
      { id: 'NW', name: 'Páganos', ...pt('423328N', '0023613W') },
      { id: 'NW-1', name: 'Viana', ...pt('423102N', '0022138W') },
    ],
  },
];

const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s/(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// Flat list of every snappable point (filled from AERODROMES, then from the AIP data file).
export const POINTS = [];
export const VFR_ROUTES = [];
function rebuildPoints() {
  POINTS.length = 0;
  for (const ad of AERODROMES) {
    POINTS.push({ key: ad.icao, label: ad.icao, sub: ad.name, type: 'ad', lat: ad.lat, lon: ad.lon, ad: ad.icao });
    for (const v of ad.vrps) {
      POINTS.push({ key: `${ad.icao}-${v.id}`, label: `${v.id} (${ad.icao})`, sub: v.name, type: 'vrp', lat: v.lat, lon: v.lon, ad: ad.icao, id: v.id });
    }
  }
}
rebuildPoints();

export const adByIcao = (icao) => AERODROMES.find((a) => a.icao === icao);

/**
 * Merges data/aip.json (built weekly in CI from ENAIRE's AIP data service) — every aerodrome,
 * VFR reporting point and published VFR route within 200 NM of LEBG and LERJ. The hand-checked
 * entries above (LEBG, LEVT, LERJ) keep their values (VAC variation, frequencies).
 */
export function mergeAip(aip) {
  if (!aip || !aip.aerodromes) return false;
  const known = new Set(AERODROMES.map((a) => a.icao));
  for (const a of aip.aerodromes) {
    if (a.type === 'HP' || known.has(a.icao) || a.icao.includes('/')) continue;
    AERODROMES.push({
      icao: a.icao, name: titleCase(a.name), lat: a.lat, lon: a.lon,
      elev: a.elev != null ? Math.round(a.elev) : null, var: a.var != null ? Math.round(a.var) : 0,
      freq: '', freqNote: a.class === 'PÚBLICO' ? 'Public aerodrome — see AD 2 for frequencies' : 'Restricted-use aerodrome — prior permission',
      vac: `https://aip.enaire.es/AIP/contenido_AIP/AD/AD2/${a.icao}/LE_AD_2_${a.icao}_VAC_1_en.pdf`,
      ad2: `https://aip.enaire.es/AIP/contenido_AIP/AD/AD2/${a.icao}/LE_AD_2_${a.icao}_en.pdf`,
      public: a.class === 'PÚBLICO', ta: a.ta, vrps: [],
    });
    known.add(a.icao);
  }
  for (const v of aip.vrps || []) {
    const ad = v.ad && adByIcao(v.ad);
    if (!ad || !v.id) continue;
    if (ad.vrps.some((x) => x.id === v.id)) continue; // hand-checked entry wins
    ad.vrps.push({ id: v.id, name: titleCase(v.name), lat: v.lat, lon: v.lon });
  }
  VFR_ROUTES.length = 0;
  for (const r of aip.routes || []) VFR_ROUTES.push(r);
  rebuildPoints();
  return true;
}

function nmBetween(a, b) {
  const R = 3440.065, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Maximum altitude (ft AMSL) of the published VFR route between a reporting point and its
 * aerodrome (VAC "MAX ALT"), for arrivals (point → aerodrome) or departures (aerodrome → point).
 * One-way routes are respected. Heights (AGL) are converted with the aerodrome elevation.
 * Returns { alt, text } or null when the AIP data gives no limit.
 */
export function vacRouteAltitude(adIcao, point, kind = 'arr') {
  const ad = adByIcao(adIcao);
  if (!ad || !point) return null;
  const pick = (strict) => {
    let best = null;
    for (const r of VFR_ROUTES) {
      if (r.upper == null || !r.pts || r.pts.length < 2) continue;
      const first = { lat: r.pts[0][0], lon: r.pts[0][1] };
      const last = { lat: r.pts[r.pts.length - 1][0], lon: r.pts[r.pts.length - 1][1] };
      const dFirst = nmBetween(first, point), dLast = nmBetween(last, point);
      if (Math.min(dFirst, dLast) > 1.5) continue;
      const startsAtPoint = dFirst <= dLast;
      const other = startsAtPoint ? last : first;
      if (nmBetween(other, ad) >= nmBetween(point, ad) || nmBetween(point, ad) > 30) continue; // must lead towards the field
      const forward = kind === 'arr' ? startsAtPoint : !startsAtPoint;
      const dir = r.dir || 'FB';
      if (strict && !(dir === 'FB' || (dir === 'F' && forward) || (dir === 'B' && !forward))) continue;
      const agl = /^HEI/i.test(r.ref || '');
      const alt = agl ? Math.round(((ad.elev || 0) + r.upper) / 100) * 100 : r.upper;
      const text = agl ? `VAC max ${r.upper} ft AGL` : `VAC max ${r.upper} ft`;
      if (!best || alt < best.alt) best = { alt, text };
    }
    return best;
  };
  return pick(true) || pick(false);
}

// P2008 JC fleet, from the FlyBy M&B sheet (empty mass kg, empty moment kg·m).
export const FLEET = {
  P2008: {
    type: 'P2008 JC',
    mtow: 650,
    fuelCapacity: 120, // litres
    fuelDensity: 0.72, // kg/L (AVGAS)
    arms: { pilot: 1.8, copilot: 1.8, baggage: 2.417, fuel: 2.209 },
    cg: [1.841, 1.978],
    regs: {
      'EC-ODV': [422, 778.3], 'EC-ODX': [421, 774.3], 'EC-ODY': [423, 780.5],
      'EC-ODZ': [422, 778.3], 'EC-OJA': [433, 806.4], 'EC-OJC': [436, 809.6],
      'EC-OJD': [426, 789.0], 'EC-OKP': [421, 791.7], 'EC-OKQ': [429, 807.9],
      'EC-OKZ': [430, 810.1], 'EC-OLA': [428, 802.1], 'EC-OLB': [426, 795.9],
      'EC-OMK': [429, 800.9], 'EC-OML': [426, 799.4], 'EC-OMP': [429, 807.9],
      'EC-OMQ': [427, 799.9], 'EC-OMR': [428, 798.7],
    },
  },
};

// SOP 2511 Phase 2 Training Manual — Flight Planning Manual, Navigation Log.
export const SOP = {
  tasBase: 90, // kt at sea level
  tasPer1000: 2, // + 2 kt per 1000 ft
  tasClimb: 75,
  tasDescent: 85,
  roc: 500, // ft/min standard rate of climb
  rod: 500, // ft/min standard rate of descent
  ffCruise: 18, // L/h
  ffClimb: 23,
  ffDescent: 12,
  stdDepMin: 20, // standard departure time, SEP and MEP fleet
  stdArrMin: 15, // standard arrival time
  contingencyPct: 5, // % of trip fuel
  finalReserveMin: 45, // holding at 1500 ft above alternate/destination, ISA
  localFlightMaxMin: 90, // local flights up to 90 min...
  localFlightFuelMin: 135, // ...need fuel for 135 flight minutes (single-engine)
  windSources: [
    { name: 'Windy', url: 'https://www.windy.com' },
    { name: 'AEMET aeronautical', url: 'https://ama.aemet.es/en' },
  ],
};

// Published VFR arrival/departure routes of the school bases (AIP VAC), listed from the
// aerodrome outwards. Arrivals fly them in reverse. Altitudes:
//  - LEBG VAC 1.1: all routes MAX ALT 1000 ft AGL (field 2962 ft) → 4000 ft, the school's
//    circuit altitude (Phase 1 manual: "1000ft AGL / 4000ft LEBG"). Outbound the school flies
//    straight to S or E; inbound from S or E it joins via E-1.
//    Solo flights may only enter the FIZ via N or W (SOP 2513).
//  - LERJ VAC 1.3: inside the corridors arrivals 4500 ft, departures 4000 ft; South corridor
//    arrivals 5500 ft, departures 5000 ft.
export const PROCEDURES = {
  LEBG: {
    routes: { N: ['N'], W: ['W'], S: ['E-1', 'S'], E: ['E-1', 'E'] },
    depRoutes: { N: ['N'], W: ['W'], S: ['S'], E: ['E'] }, // outbound: direct to the point
    alt: { dep: 4000, arr: 4000 },
    source: 'LEBG VAC: max 1000 ft AGL on the visual routes',
    soloEntry: ['N', 'W'],
  },
  LERJ: {
    routes: { N: ['N-2', 'N-1', 'N'], E: ['E-2', 'E-1', 'E'], S: ['S-1', 'S'], W: ['W-2', 'W-1', 'W'], NW: ['NW-1', 'NW'] },
    alt: { dep: 4000, arr: 4500 },
    altByRoute: { S: { dep: 5000, arr: 5500 } },
    source: 'LERJ VAC: corridors 4500 ft arriving / 4000 ft departing (South 5500 / 5000)',
  },
  // LEVT VAC 1.1 (WEF 25-DEC-25): N, E, S, W direct, 1000 ft AGL MAX (elev 1682 ft → 2600 ft).
  LEVT: {
    routes: { N: ['N'], E: ['E'], S: ['S'], W: ['W'] },
    alt: { dep: 2600, arr: 2600 },
    source: 'LEVT VAC: 1000 ft AGL max in the corridors (2682 ft); contact TWR over the point',
  },
  // LEVD VAC 1.3: arrivals from N, W, NE via N-1 (La Mudarra), from S, E via S-1 (Zaratán);
  // departures leave the ATZ via N-1 or S-1. 1000 ft AGL via E and S (3700 ft), 1500 ft AGL via
  // W, N and NE (4200 ft). Do not use NE (Phase 3 and solo manuals).
  LEVD: {
    routes: { N: ['N-1', 'N'], W: ['N-1', 'W'], NE: ['N-1', 'NE'], S: ['S-1', 'S'], E: ['S-1', 'E'] },
    alt: { dep: 3700, arr: 3700 },
    altByRoute: { N: { dep: 4200, arr: 4200 }, W: { dep: 4200, arr: 4200 }, NE: { dep: 4200, arr: 4200 } },
    source: 'LEVD VAC: 1000 ft AGL via E/S, 1500 ft AGL via W/N/NE; join via N-1 or S-1. NE point not used (SOP)',
    avoid: ['NE'],
  },
  // LELN VAC 1.2: from S (Palazuelo) or SE (Santas Martas) via S-1 (Onzonilla) at 1000 ft AGL
  // (4000 ft); from N (La Robla) direct to the circuit. Departures: report the exit point to TWR.
  LELN: {
    routes: { N: ['N'], S: ['S-1', 'S'], SE: ['S-1', 'SE'] },
    depRoutes: { N: ['N'], S: ['S'], SE: ['SE'] },
    alt: { dep: 4000, arr: 4000 },
    source: 'LELN VAC: circuit at 1000 ft AGL, S and SE join via S-1; with LED7 active only S or SE. Full-stop landing (solo manual)',
  },
};

/**
 * Published procedure for leaving (dep) or joining (arr) an aerodrome via a reporting point.
 * The point may be anywhere on a corridor (e.g. LERJ W-1): departures fly the corridor out to
 * that point, arrivals fly it in from that point.
 */
export function procedureFor(adIcao, vrpId, kind) {
  const p = PROCEDURES[adIcao];
  const ad = adByIcao(adIcao);
  if (p) {
    const routes = kind === 'dep' && p.depRoutes ? p.depRoutes : p.routes;
    const route = Object.entries(routes).find(([, pts]) => pts[pts.length - 1] === vrpId)
      || Object.entries(routes).find(([, pts]) => pts.includes(vrpId));
    if (route) {
      const [name, all] = route;
      const pts = all.slice(0, all.indexOf(vrpId) + 1);
      const alt = (p.altByRoute && p.altByRoute[name] ? p.altByRoute[name] : p.alt)[kind];
      return { points: kind === 'dep' ? pts : [...pts].reverse(), alt, route: name, source: (p.avoid || []).includes(vrpId) ? `${vrpId} is not used (SOP) — ${p.source}` : p.source, solo: p.soloEntry };
    }
    if (ad && ad.vrps.some((x) => x.id === vrpId)) return { points: [vrpId], alt: p.alt[kind], source: p.source, solo: p.soloEntry };
  }
  // Other aerodromes: direct to/from the reporting point, altitude from the AIP VFR routes if published.
  const v = ad && ad.vrps.find((x) => x.id === vrpId);
  if (!v) return null;
  const lim = vacRouteAltitude(adIcao, v, kind);
  return { points: [vrpId], alt: lim ? lim.alt : null, source: lim ? lim.text : 'Check the VAC for routes and altitudes' };
}

// Fleet by type (FlyBy fleet M&B overview, updated 19/07/2025) with each type's planning numbers:
//  - cruise IAS: the aircraft SOP ("establish a cruise: 90 kts" / "100 kts for C172 and P28A",
//    P2006 "Medium cruise 100 kts"); TAS = IAS + 2 kt per 1000 ft (Phase 2 manual).
//  - fuel flows: Phase 2 manual general rule (cruise 18, climb 23, descent 12 L/h) unless the
//    aircraft SOP gives AFM cruise tables, read at the SOP cruise speed with the most
//    restrictive value (SOP: "with the most restrictive values of the charts below").
//  - wind limits: aircraft SOP "Minimum weather conditions" tables (solo only where given).
const GEN = { ffCruise: 18, ffClimb: 23, ffDescent: 12 };
export const FLEET_TYPES = [
  { id: 'P2008', name: 'Tecnam P2008 JC', icao: 'P208', mb: true, regs: Object.keys(FLEET.P2008.regs),
    xwind: { fi: 15, solo: 10 }, perf: { tasBase: 90, ...GEN, src: 'SOP2518 cruise 90 kt; Phase 2 general rule (AFM 2000 RPM ≈ 18–18.7 L/h)' } },
  { id: 'PS28', name: 'PS-28 Cruiser', icao: 'CRUZ', mb: true, regs: ['EC-NAO', 'EC-NAP', 'EC-NCO', 'EC-NCP', 'EC-NCQ', 'EC-NIM', 'EC-NIN', 'EC-NLF', 'EC-NLG', 'EC-NPM', 'EC-OIY', 'EC-OIZ'],
    xwind: { fi: 12, solo: 10 }, headwind: { fi: 24, solo: 20 }, gustNote: 'Crosswind incl. gusts: FI 18 kt gusting 20, solo 10 kt gusting 15 (SOP2517)',
    perf: { tasBase: 90, ...GEN, src: 'SOP2517 cruise 90 kt; no PS-28 cruise chart in the SOP → Phase 2 general rule (check the POH)' } },
  { id: 'P2002', name: 'Tecnam P2002 JF', icao: 'P2002', mb: true, regs: ['EC-MOH', 'EC-MOI', 'EC-MOJ'],
    xwind: { fi: 12, solo: 10 }, headwind: { fi: 24, solo: 20 }, gustNote: 'Crosswind incl. gusts: FI 18 kt gusting 20, solo 10 kt gusting 15 (SOP2517)',
    perf: { tasBase: 90, ffCruise: 22, ffClimb: 23, ffDescent: 12, src: 'SOP2517 cruise 90 kt; AFM 580 kg chart, ~100 KTAS most restrictive 22 L/h' } },
  { id: 'PMENTOR', name: 'Tecnam P-Mentor', icao: 'PMEN', mb: true, regs: ['EC-OCF', 'EC-OCG'],
    xwind: { fi: 10 }, perf: { tasBase: 90, ffCruise: 14, ffClimb: 23, ffDescent: 12, src: 'SOP2520 cruise 90 kt; AFM 720 kg chart 4800 RPM 14 L/h' } },
  { id: 'C172', name: 'Cessna 172N', icao: 'C172', mb: true, regs: ['EC-NSB', 'EC-IOG', 'EC-IDJ'],
    xwind: { fi: 15 }, perf: { tasBase: 100, ...GEN, src: 'SOP2519 cruise 100 kt; no cruise chart in the SOP → Phase 2 general rule (check the POH)' } },
  { id: 'C172RG', name: 'Cessna 172 RG', icao: 'C72R', mb: true, regs: [],
    xwind: { fi: 15 }, perf: { tasBase: 100, ...GEN, src: 'SOP2523 cruise 100 kt (21"/2100 RPM); no cruise chart in the SOP → Phase 2 general rule (check the POH)' } },
  { id: 'PA28', name: 'Piper PA-28-181', icao: 'P28A', mb: true, regs: ['EC-JFE'],
    xwind: { fi: 17 }, perf: { tasBase: 100, ...GEN, src: 'SOP2519 cruise 100 kt; no cruise chart in the SOP → Phase 2 general rule (check the POH)' } },
  { id: 'P2006', name: 'Tecnam P2006T', icao: 'P2006', mb: true, regs: ['I-CHAU', 'EC-LIF', 'EC-NKF', 'EC-OON', 'EC-OPL'],
    xwind: { fi: 17 }, perf: { tasBase: 100, ffCruise: 28.6, ffClimb: 46, ffDescent: 24, src: 'SOP2521 medium cruise 100 kt; AFM 1150 kg chart 2100 RPM/22" 14.3 L/h per engine (both engines); climb/descent: general rule × 2 engines (check the AFM)' } },
];
export const fleetType = (id) => FLEET_TYPES.find((t) => t.id === id) || FLEET_TYPES[0];
