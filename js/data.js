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

// Flat list of every snappable point.
export const POINTS = AERODROMES.flatMap((ad) => [
  { key: ad.icao, label: ad.icao, sub: ad.name, type: 'ad', lat: ad.lat, lon: ad.lon, ad: ad.icao },
  ...ad.vrps.map((v) => ({
    key: `${ad.icao}-${v.id}`, label: `${v.id} (${ad.icao})`, sub: v.name,
    type: 'vrp', lat: v.lat, lon: v.lon, ad: ad.icao,
  })),
]);

export const adByIcao = (icao) => AERODROMES.find((a) => a.icao === icao);

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
