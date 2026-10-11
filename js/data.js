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
// Frequencies of the school's other VFR aerodromes, from their VACs (AIRAC 2025–26).
const AD_FREQ = {
  LEPP: ['LEPP:118.200', 'Pamplona APP/TWR 118.200 · GMC 121.705'],
  LESO: ['LESO:119.855', 'San Sebastián APP/TWR 119.855 · GMC 121.705'],
  LEXJ: ['LEXJ:118.105', 'Santander TWR 118.105 · APP 118.375 · GMC 121.705 · ATIS 127.530'],
  LEHC: ['LEHC:128.955', 'Huesca AFIS 128.955 (NO ATS outside AFIS hours, same frequency)'],
  LESA: ['LESA:118.105', 'Salamanca TWR 118.105 · APP 124.405 · GMC 121.855'],
};

// Reporting points of those aerodromes as printed on their VACs (the AIP data service sometimes
// files a shared point under a neighbouring aerodrome, e.g. LESA N under LEUN).
const V = (id, name, lat, lon) => ({ id, name, ...pt(lat, lon) });
const VAC_VRPS = {
  LEPP: [V('N', 'Usetxi', '425628N', '0013243W'), V('E', 'Lizárraga', '424658N', '0012551W'), V('W', 'Zabalza - Arraiza', '424437N', '0015150W')],
  LESO: [V('E', 'San Juan de Luz', '432302N', '0013945W'), V('S', 'Sumbilla', '430950N', '0014010W'), V('W', 'Ría de Orio', '431750N', '0020800W'), V('W-1', 'Ría de Pasaia', '432030N', '0015550W')],
  LEXJ: [V('E-1', 'Santoña', '432703N', '0032550W'), V('E-2', 'Cabo de Ajo', '433051N', '0033427W'), V('N-1', 'Santa Marina', '432833N', '0034316W'), V('N-2', 'Cabo de Lata', '432942N', '0034842W'),
    V('S-1', 'Villacarriedo', '431359N', '0034821W'), V('S-2', 'El Pozón de la Dolores', '432326N', '0035301W'), V('W-1', 'Torrelavega', '432051N', '0040205W'), V('W-2', 'Suances', '432611N', '0040207W')],
  LEHC: [V('N', 'Castillo de Montearagón', '420914N', '0002008W'), V('E', 'Velillas', '420730N', '0001238W'), V('S', 'Piracés', '420016N', '0001852W'), V('W', 'Embalse de Valdabra', '420447N', '0002607W'),
    V('W-1', 'Embalse de Tormos', '420603N', '0004304W'), V('SW', 'Torralba de Aragón', '415633N', '0003013W'), V('S-1', 'Sariñena', '414747N', '0000935W')],
  LESA: [V('N', 'Estación de Huelmos', '410803N', '0054137W'), V('N-1', 'Polideportivo Helmántico', '410016N', '0054020W'), V('E', 'Peñaranda de Bracamonte', '405428N', '0051131W'),
    V('E-1', 'Ventosa del Río Almar', '405543N', '0052043W'), V('S', 'Alba de Tormes', '404942N', '0053014W')],
};

export function mergeAip(aip) {
  if (!aip || !aip.aerodromes) return false;
  const known = new Set(AERODROMES.map((a) => a.icao));
  for (const a of aip.aerodromes) {
    if (a.type === 'HP' || known.has(a.icao) || a.icao.includes('/')) continue;
    AERODROMES.push({
      icao: a.icao, name: titleCase(a.name), lat: a.lat, lon: a.lon,
      elev: a.elev != null ? Math.round(a.elev) : null, var: a.var != null ? Math.round(a.var) : 0,
      freq: AD_FREQ[a.icao] ? AD_FREQ[a.icao][0] : '',
      freqNote: AD_FREQ[a.icao] ? AD_FREQ[a.icao][1] : a.class === 'PÚBLICO' ? 'Public aerodrome — see AD 2 for frequencies' : 'Restricted-use aerodrome — prior permission',
      vac: `https://aip.enaire.es/AIP/contenido_AIP/AD/AD2/${a.icao}/LE_AD_2_${a.icao}_VAC_1_en.pdf`,
      ad2: `https://aip.enaire.es/AIP/contenido_AIP/AD/AD2/${a.icao}/LE_AD_2_${a.icao}_en.pdf`,
      public: a.class === 'PÚBLICO', ta: a.ta, vrps: VAC_VRPS[a.icao] ? VAC_VRPS[a.icao].map((v) => ({ ...v })) : [],
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
    // School SOP (not the VAC): depart to every point at 5000 ft; arrive over N, W, S at 4500 ft,
    // over E at 5000 ft, then E-1 at 4000 ft and to the field. (The FlyBy "tunnels" north of the
    // field are flown at 4000 ft but are not official and not on the navlog.)
    alt: { dep: 5000, arr: 4500 },
    pointAlt: { arr: { N: 4500, W: 4500, S: 4500, E: 5000, 'E-1': 4000 } },
    source: 'LEBG SOP: depart at 5000 ft; arrive N/W/S 4500 ft, E 5000 ft, E-1 4000 ft',
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
    alt: { dep: 2500, arr: 2500 },
    source: 'LEVT VAC: 1000 ft AGL max in the corridors (2682 ft); contact TWR over the point',
  },
  // LEVD VAC 1.3: arrivals from N, W, NE via N-1 (La Mudarra), from S, E via S-1 (Zaratán);
  // departures leave the ATZ via N-1 or S-1. 1000 ft AGL via E and S (3700 ft), 1500 ft AGL via
  // W, N and NE (4200 ft). Do not use NE (Phase 3 and solo manuals).
  LEVD: {
    routes: { N: ['N-1', 'N'], W: ['N-1', 'W'], NE: ['N-1', 'NE'], S: ['S-1', 'S'], E: ['S-1', 'E'] },
    alt: { dep: 3500, arr: 3500 },
    altByRoute: { N: { dep: 4000, arr: 4000 }, W: { dep: 4000, arr: 4000 }, NE: { dep: 4000, arr: 4000 } },
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
  // VAC heights are converted with the aerodrome elevation and rounded down to the 500 ft below
  // (school preference: levels in 500 ft steps, never above the VAC maximum).
  // LEPP VAC 1.1 (WEF 22-JAN-26): contact TWR over N (Usetxi), E (Lizárraga) or W (Zabalza-Arraiza),
  // direct routes, MAX ALT 1000 ft AGL (elev 1506 ft → 2500 ft). Hold over the point if told.
  LEPP: {
    routes: { N: ['N'], E: ['E'], W: ['W'] },
    alt: { dep: 2500, arr: 2500 },
    source: 'LEPP VAC: contact TWR over N, E or W, request CTR entry, 1000 ft AGL max (2506 ft)',
  },
  // LESO VAC 1.1 (WEF 30-OCT-25): contact TWR over S (Sumbilla), W (Ría de Orio) or E (San Juan
  // de Luz) before the CTR, 1000 ft AGL max (elev 15 ft → 1000 ft). W route via W-1 (Ría de Pasaia).
  LESO: {
    routes: { S: ['S'], W: ['W-1', 'W'], E: ['E'] },
    alt: { dep: 1000, arr: 1000 },
    source: 'LESO VAC: contact TWR over S, W or E before the CTR, 1000 ft AGL max; W route via W-1',
  },
  // LEXJ VAC 1.1 (WEF 14-MAY-26): contact TWR at E-1, E-2, N-2, S-1, W-1, W-2. From E-2 along the
  // coast to N-2 or N-1 (north visual pattern); from S-1, W-1, W-2 to S-2 (south visual pattern).
  // CTR SFC–1000 ft AGL, TWR gives the altitude (planned 1000 ft). Departures: GMC assigns the route.
  LEXJ: {
    routes: { E: ['N-1', 'E-2', 'E-1'], N: ['N-2'], S: ['S-2', 'S-1'], W: ['S-2', 'W-1'], W2: ['S-2', 'W-2'] },
    alt: { dep: 1000, arr: 1000 },
    source: 'LEXJ VAC: TWR gives the altitude (CTR SFC–1000 ft AGL); E-2 → N-1 along the coast, S-1/W-1/W-2 → S-2. Departure route assigned by GMC',
  },
  // LEHC VAC 1.1 (WEF 15-MAY-25): enter/leave the FIZ via N, S, E, W, W-1, SW, S-1. MAX ALT 1000 ft
  // AGL (elev 1769 ft → 2700 ft) unless IFR traffic is reported; W → field MAX 500 ft AGL (2200 ft).
  // S-1 joins via S, W-1 via W.
  LEHC: {
    routes: { N: ['N'], E: ['E'], S: ['S', 'S-1'], W: ['W', 'W-1'], SW: ['SW'] },
    alt: { dep: 2500, arr: 2500 },
    altByRoute: { W: { dep: 2000, arr: 2000 } },
    source: 'LEHC VAC: 1000 ft AGL max (planned 2500 ft) (5500 ft AMSL only with IFR traffic reported), W route 500 ft AGL max; notify AFIS before the point',
  },
  // LESA VAC 1.1 (WEF 04-SEP-25): North route N–N-1 (road N-630 0.5 NM left), East route E–E-1
  // (N-501 0.5 NM left), South route S (river Tormes 0.5 NM left); 1000 ft AGL max (2595 → 3500 ft).
  LESA: {
    routes: { N: ['N-1', 'N'], E: ['E-1', 'E'], S: ['S'] },
    alt: { dep: 3500, arr: 3500 },
    source: 'LESA VAC: call TWR 2 min / 10 NM before the point; 1000 ft AGL max; keep the road/river 0.5 NM on the left',
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
      return { points: kind === 'dep' ? pts : [...pts].reverse(), alt, pointAlt: p.pointAlt && p.pointAlt[kind], route: name, source: (p.avoid || []).includes(vrpId) ? `${vrpId} is not used (SOP) — ${p.source}` : p.source, solo: p.soloEntry };
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
    perf: { tasBase: 90, ...GEN, src: 'SOP2517 cruise 90 kt; school rule: general fuel flows 18/23/12 L/h for every type (safety margin)' } },
  { id: 'PMENTOR', name: 'Tecnam P-Mentor', icao: 'PMEN', mb: true, regs: ['EC-OCF', 'EC-OCG'],
    xwind: { fi: 10 }, perf: { tasBase: 90, ...GEN, src: 'SOP2520 cruise 90 kt; school rule: general fuel flows 18/23/12 L/h (safety margin)' } },
  { id: 'C172', name: 'Cessna 172N', icao: 'C172', mb: true, regs: ['EC-NSB', 'EC-IOG', 'EC-IDJ'],
    xwind: { fi: 15 }, perf: { tasBase: 100, ...GEN, src: 'SOP2519 cruise 100 kt; no cruise chart in the SOP → Phase 2 general rule (check the POH)' } },
  { id: 'C172RG', name: 'Cessna 172 RG', icao: 'C72R', mb: true, regs: [],
    xwind: { fi: 15 }, perf: { tasBase: 100, ...GEN, src: 'SOP2523 cruise 100 kt (21"/2100 RPM); no cruise chart in the SOP → Phase 2 general rule (check the POH)' } },
  { id: 'PA28', name: 'Piper PA-28-181', icao: 'P28A', mb: true, regs: ['EC-JFE'],
    xwind: { fi: 17 }, perf: { tasBase: 100, ...GEN, src: 'SOP2519 cruise 100 kt; no cruise chart in the SOP → Phase 2 general rule (check the POH)' } },
  { id: 'P2006', name: 'Tecnam P2006T', icao: 'P2006', mb: true, regs: ['I-CHAU', 'EC-LIF', 'EC-NKF', 'EC-OON', 'EC-OPL'],
    xwind: { fi: 17 }, perf: { tasBase: 100, ffCruise: 36, ffClimb: 46, ffDescent: 24, src: 'SOP2521 medium cruise 100 kt; school rule: general fuel flows 18/23/12 L/h per engine × 2 engines (safety margin)' } },
];
export const fleetType = (id) => FLEET_TYPES.find((t) => t.id === id) || FLEET_TYPES[0];
