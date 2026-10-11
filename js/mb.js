// Mass & balance for every fleet type, from the school's M&B sheets (the only approved
// templates, SOP "MASS & BALANCE") and the fleet overview (updated 19/07/2025):
//  - P2008 JC   sheet 2-P2008JC      kg / m      envelope 1.841–1.978 m, MTOW 650 kg
//  - P2002 JF   sheet 2-P2002JF      kg / m      envelope chart C.G. 26 %–32.5 %, MTOW 620 kg
//  - P-Mentor   sheet 3-PMENTOR      kg / m      envelope chart C.G. 23 %/25 %–33 %, MTOW 720 kg
//  - PS-28      POH weight & balance kg / mm     operating C.G. 420–525 mm (28–35 % MAC), MTOW 600 kg
//  - C172N      POH sample loading   lb / in     C.G. moment envelope (normal category), MTOW 2300 lb
//  - C172RG     POH sample loading   lb / in     C.G. limits chart, MTOW 2650 lb (ramp 2658 lb)
//  - PA-28-181  sheet 3-PA28-181     lb / in     C.G. range chart (normal category), MTOW 2550 lb
//  - P2006T/NG  sheet MB P2006T NEW / 4-P2006NG  kg / m  weight-moment envelope, MZFW 1195 kg
// Envelopes are polygons of [arm, mass] read from each sheet's chart. Student and instructor
// masses are always entered in kg (real masses, SOP) and converted for the lb/in aircraft.

export const KG_TO_LB = 2.20462;
export const L_PER_GAL = 3.78541;

const kgAc = { unit: 'kg', armUnit: 'm', fuelPerL: 0.72, momentDp: 2, armDp: 3 };
const lbAc = { unit: 'lb', armUnit: 'in', fuelPerL: 6 / L_PER_GAL, momentDiv: 1000, momentDp: 2, armDp: 1 };

export const MB_TYPES = {
  P2008: {
    ...kgAc, name: 'Tecnam P2008 JC', sheet: 'P2008 JC M&B sheet', mtow: 650, fuelMaxL: 120,
    stations: [
      { id: 'pilot', label: 'Pilot', arm: 1.8 },
      { id: 'copilot', label: 'Copilot', arm: 1.8 },
      { id: 'baggage', label: 'Baggage', arm: 2.417 },
    ],
    fuelArm: 2.209,
    envelope: [[1.841, 0], [1.841, 650], [1.978, 650], [1.978, 0]],
    regs: {
      'EC-ODV': [422, 778.3], 'EC-ODX': [421, 774.3], 'EC-ODY': [423, 780.5], 'EC-ODZ': [422, 778.3],
      'EC-OJA': [433, 806.4], 'EC-OJC': [436, 809.6], 'EC-OJD': [426, 789.0], 'EC-OKP': [421, 791.7],
      'EC-OKQ': [429, 807.9], 'EC-OKZ': [430, 810.1], 'EC-OLA': [428, 802.1], 'EC-OLB': [426, 795.9],
      'EC-OMK': [429, 800.9], 'EC-OML': [426, 799.4], 'EC-OMP': [429, 807.9], 'EC-OMQ': [427, 799.9],
      'EC-OMR': [428, 798.7],
    },
  },
  P2002: {
    ...kgAc, name: 'Tecnam P2002 JF', sheet: 'P2002 JF M&B sheet', mtow: 620, fuelMaxL: 99,
    stations: [
      { id: 'pilot', label: 'Pilot', arm: 1.8 },
      { id: 'copilot', label: 'Co-pilot', arm: 1.8 },
      { id: 'baggage', label: 'Baggage', arm: 2.26, max: 20 },
    ],
    fuelArm: 1.53,
    // chart: C.G. 26 % = 1.693 m, C.G. 32.5 % = 1.783 m (moment/weight of the printed lines)
    envelope: [[1.693, 0], [1.693, 620], [1.783, 620], [1.783, 0]],
    regs: { 'EC-MOH': [400, 670.80], 'EC-MOI': [400, 680], 'EC-MOJ': [401, 669.52] },
  },
  PMENTOR: {
    ...kgAc, name: 'Tecnam P-Mentor', sheet: 'P-Mentor M&B sheet', mtow: 720, fuelMaxL: 131.6,
    stations: [
      { id: 'pilot', label: 'Pilot', arm: 1.804 },
      { id: 'copilot', label: 'Copilot', arm: 1.804 },
      { id: 'baggage', label: 'Baggage', arm: 2.26 },
    ],
    fuelArm: 2.139,
    // chart: forward C.G. 23 % up to 550 kg, then to C.G. 25 % at 720 kg; aft C.G. 33 %
    envelope: [[1.698, 0], [1.698, 550], [1.780, 720], [1.890, 720], [1.890, 0]],
    regs: { 'EC-OCF': [452, 781.06], 'EC-OCG': [452, 782.41] },
  },
  PS28: {
    ...kgAc, armUnit: 'mm', momentDp: 0, armDp: 1, name: 'PS-28 Cruiser', sheet: 'PS-28 weight & balance record', mtow: 600, fuelMaxL: 113,
    stations: [
      { id: 'pilot', label: 'Pilot', arm: 700, min: 55 },
      { id: 'copilot', label: 'Passenger', arm: 700 },
      { id: 'baggage', label: 'Baggage compartment', arm: 1310, max: 18 },
      { id: 'baggage2', label: 'Wing lockers (both)', arm: 600, max: 20 },
    ],
    fuelArm: 180,
    mac: 1500, // % MAC = arm / 1500 mm × 100
    envelope: [[420, 0], [420, 600], [525, 600], [525, 0]],
    regs: {
      'EC-NAO': [398.8, 172282], 'EC-NAP': [389.6, 168892], 'EC-NCO': [396.2, 173891], 'EC-NCP': [394.4, 174556],
      'EC-NCQ': [394.4, 171702], 'EC-NIM': [394.8, 176871], 'EC-NIN': [400, 174511], 'EC-NLF': [395.8, 171785],
      'EC-NLG': [397.4, 175272], 'EC-NPM': [392.1, 170090], 'EC-OIY': [400.8, 175321], 'EC-OIZ': [400.4, 176256],
    },
  },
  C172: {
    ...lbAc, name: 'Cessna 172N', sheet: 'C172N sample loading problem', mtow: 2300, fuelMaxL: 151.4, // 40 US gal
    stations: [
      { id: 'pilot', label: 'Pilot', arm: 37, group: 'front' },
      { id: 'copilot', label: 'Front passenger', arm: 37, group: 'front' },
      { id: 'pax', label: 'Rear passengers', arm: 73 },
      { id: 'baggage', label: 'Baggage area 1', arm: 95, max: 120 },
      { id: 'baggage2', label: 'Baggage area 2', arm: 123, max: 50 },
    ],
    combinedMax: { ids: ['baggage', 'baggage2'], max: 120, label: 'baggage areas 1 + 2' },
    fuelArm: 48,
    envelope: [[35.0, 0], [35.0, 1950], [38.5, 2300], [47.3, 2300], [47.3, 0]],
    regs: { 'EC-NSB': [1511.85, 64578], 'EC-IOG': [1472.25, 58810], 'EC-IDJ': [1488, 62390] },
  },
  C172RG: {
    ...lbAc, name: 'Cessna 172 RG', sheet: 'C172RG sample loading problem', mtow: 2650, ramp: 2658, fuelMaxL: 234.7,
    taxi: [8, 50], // fuel allowance for engine start, taxi and run-up: 8 lb (moment 0.4)
    stations: [
      { id: 'pilot', label: 'Pilot', arm: 37, group: 'front' },
      { id: 'copilot', label: 'Front passenger', arm: 37, group: 'front' },
      { id: 'pax', label: 'Rear passengers', arm: 73 },
      { id: 'baggage', label: 'Baggage area 1', arm: 95, max: 200 },
      { id: 'baggage2', label: 'Baggage area 2', arm: 123, max: 50 },
    ],
    combinedMax: { ids: ['baggage', 'baggage2'], max: 200, label: 'baggage areas 1 + 2' },
    fuelArm: 48,
    envelope: [[36.0, 0], [36.0, 1950], [39.5, 2650], [46.5, 2650], [46.5, 0]],
    regs: {}, // not in the fleet overview: enter the empty mass and moment from the aircraft's W&B report
  },
  PA28: {
    ...lbAc, name: 'Piper PA-28-181', sheet: 'PA-28-181 W&B sheet', mtow: 2550, fuelMaxL: 181.7, // 48 US gal
    stations: [
      { id: 'pilot', label: 'Pilot', arm: 80.5, group: 'front' },
      { id: 'copilot', label: 'Front passenger', arm: 80.5, group: 'front' },
      { id: 'pax', label: 'Rear passengers', arm: 118.1 },
      { id: 'baggage', label: 'Baggage', arm: 142.8, max: 200 },
    ],
    fuelArm: 95.0,
    envelope: [[82.0, 0], [82.0, 2050], [88.6, 2550], [93.0, 2550], [93.0, 0]],
    regs: { 'EC-JFE': [1603, 137952] },
  },
  P2006: {
    ...kgAc, name: 'Tecnam P2006T / NG', sheet: 'P2006T weight and C.G. form', mtow: 1290, mzfw: 1195, fuelMaxL: 194,
    mtowByReg: { 'I-CHAU': 1230, 'EC-LIF': 1180, 'EC-NKF': 1230, 'EC-OON': 1290, 'EC-OPL': 1290 },
    ngRegs: ['EC-OON', 'EC-OPL'],
    stations: [
      { id: 'pilot', label: 'Pilot', arm: -0.893 },
      { id: 'copilot', label: 'Co-pilot', arm: -0.893 },
      { id: 'pax1', label: '1st passenger', arm: 0.226 },
      { id: 'pax2', label: '2nd passenger', arm: 0.226 },
      { id: 'baggage', label: 'Baggage', arm: 1.215 },
    ],
    fuelArm: 0.755,
    // weight-moment envelope (C.G. 16.5 % → kink → C.G. 19 % at 1290 kg; aft C.G. 31 %)
    envelope: [[0.2215, 790], [0.2195, 1231], [0.2519, 1290], [0.4100, 1290], [0.4114, 790]],
    regs: { 'I-CHAU': [907, 537], 'EC-LIF': [878, 403], 'EC-NKF': [875, 357], 'EC-OON': [935, 299], 'EC-OPL': [929, 320] },
  },
};

/** Point-in-polygon on [arm, mass]; points on an edge count as inside (limit values are allowed). */
export function insideEnvelope(env, arm, mass) {
  const xs = env.map((p) => p[0]), ys = env.map((p) => p[1]);
  const sx = Math.max(...xs) - Math.min(...xs) || 1, sy = Math.max(...ys) - Math.min(...ys) || 1;
  const px = arm / sx, py = mass / sy;
  let inside = false;
  for (let i = 0, j = env.length - 1; i < env.length; j = i++) {
    const xi = env[i][0] / sx, yi = env[i][1] / sy, xj = env[j][0] / sx, yj = env[j][1] / sy;
    // distance to the edge (normalised): on the line = within limits
    const dx = xj - xi, dy = yj - yi, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - xi) * dx + (py - yi) * dy) / l2));
    if (Math.hypot(px - (xi + t * dx), py - (yi + t * dy)) < 1e-6) return true;
    if ((yi > py) !== (yj > py) && px < (dx * (py - yi)) / dy + xi) inside = !inside;
  }
  return inside;
}

/** Forward and aft C.G. limits at a given mass (for display). */
export function cgLimitsAt(env, mass) {
  const xs = [];
  for (let i = 0, j = env.length - 1; i < env.length; j = i++) {
    const [xi, yi] = env[i], [xj, yj] = env[j];
    if (yi === yj) continue;
    if (mass >= Math.min(yi, yj) && mass <= Math.max(yi, yj)) xs.push(xi + ((mass - yi) / (yj - yi)) * (xj - xi));
  }
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : null;
}

const r = (x, dp = 2) => Math.round(x * 10 ** dp) / 10 ** dp;

/**
 * loads: masses in kg by station id; fobL / tripL / altL in litres.
 * empty: optional [mass, moment] override (sheet units) when the registration is not listed.
 * Returns rows in the sheet's units plus takeoff/landing results and every limit check.
 */
export function computeMb(typeId, { reg, empty, loads = {}, fobL = 0, tripL = 0, altL = 0 }) {
  const ac = MB_TYPES[typeId];
  if (!ac) return null;
  const e = empty && empty[0] > 0 ? empty : ac.regs[reg];
  if (!e) return null;
  const toU = (kg) => (ac.unit === 'lb' ? kg * KG_TO_LB : kg);
  const div = ac.momentDiv || 1;
  const rows = [{ id: 'empty', label: 'Empty mass', mass: e[0], arm: e[1] / e[0], moment: e[1] }];
  const issues = [];
  for (const s of ac.stations) {
    const kg = +loads[s.id] || 0;
    const m = r(toU(kg), 1);
    rows.push({ id: s.id, label: s.label, mass: m, kg, arm: s.arm, moment: m * s.arm });
    if (s.max && m > s.max + 1e-9) issues.push(`${s.label} ${m} ${ac.unit} — max ${s.max} ${ac.unit}`);
    if (s.min && kg > 0 && m < s.min) issues.push(`${s.label} ${m} ${ac.unit} — min ${s.min} ${ac.unit}`);
  }
  if (ac.combinedMax) {
    const sum = rows.filter((x) => ac.combinedMax.ids.includes(x.id)).reduce((t, x) => t + x.mass, 0);
    if (sum > ac.combinedMax.max + 1e-9) issues.push(`${ac.combinedMax.label} ${r(sum, 1)} ${ac.unit} — max ${ac.combinedMax.max} ${ac.unit} combined`);
  }
  const zfw = rows.reduce((t, x) => t + x.mass, 0);
  const zfm = rows.reduce((t, x) => t + x.moment, 0);
  if (ac.mzfw && zfw > ac.mzfw) issues.push(`Zero-fuel mass ${r(zfw, 1)} ${ac.unit} — max ${ac.mzfw} ${ac.unit}`);
  if (+fobL > ac.fuelMaxL + 1e-9) issues.push(`Fuel ${fobL} L — max usable ${ac.fuelMaxL} L`);

  const fuelU = r(+fobL * ac.fuelPerL, 1);
  rows.push({ id: 'fuel', label: 'Usable fuel', mass: fuelU, litres: +fobL, arm: ac.fuelArm, moment: fuelU * ac.fuelArm });
  let mass = zfw + fuelU, moment = zfm + fuelU * ac.fuelArm;
  let ramp = null;
  if (ac.taxi) {
    ramp = { mass, moment, arm: moment / mass };
    if (ac.ramp && mass > ac.ramp) issues.push(`Ramp mass ${r(mass, 1)} ${ac.unit} — max ${ac.ramp} ${ac.unit}`);
    rows.push({ id: 'taxi', label: 'Start, taxi and run-up', mass: -ac.taxi[0], arm: ac.taxi[1], moment: -ac.taxi[0] * ac.taxi[1] });
    mass -= ac.taxi[0]; moment -= ac.taxi[0] * ac.taxi[1];
  }
  const mtow = (ac.mtowByReg && ac.mtowByReg[reg]) || ac.mtow;
  const mlw = ac.mlw || mtow;
  const to = { mass, moment, arm: moment / mass };
  const tripU = r(+tripL * ac.fuelPerL, 1);
  const ldg = { mass: mass - tripU, moment: moment - tripU * ac.fuelArm };
  ldg.arm = ldg.moment / ldg.mass;
  const altU = r(+altL * ac.fuelPerL, 1);
  const ldgAlt = { mass: ldg.mass - altU, moment: ldg.moment - altU * ac.fuelArm };
  ldgAlt.arm = ldgAlt.moment / ldgAlt.mass;

  to.massOk = to.mass <= mtow + 1e-9; to.cgOk = insideEnvelope(ac.envelope, to.arm, Math.min(to.mass, mtow));
  ldg.massOk = ldg.mass <= mlw + 1e-9; ldg.cgOk = insideEnvelope(ac.envelope, ldg.arm, Math.min(ldg.mass, mlw));
  ldgAlt.cgOk = insideEnvelope(ac.envelope, ldgAlt.arm, Math.min(ldgAlt.mass, mlw));
  if (!to.massOk) issues.push(`Takeoff mass ${r(to.mass, 1)} ${ac.unit} — MTOW ${mtow} ${ac.unit}`);
  if (!to.cgOk) issues.push(`Takeoff C.G. ${r(to.arm, ac.armDp)} ${ac.armUnit} outside the envelope`);
  if (!ldg.massOk) issues.push(`Landing mass ${r(ldg.mass, 1)} ${ac.unit} — MLW ${mlw} ${ac.unit}`);
  if (!ldg.cgOk) issues.push(`Landing C.G. ${r(ldg.arm, ac.armDp)} ${ac.armUnit} outside the envelope`);
  if (altL > 0 && !ldgAlt.cgOk) issues.push(`Landing C.G. at the alternate ${r(ldgAlt.arm, ac.armDp)} ${ac.armUnit} outside the envelope`);

  const pct = (arm) => (ac.mac ? (arm / ac.mac) * 100 : null);
  const kg = (m) => (ac.unit === 'lb' ? m / KG_TO_LB : m);
  return {
    type: typeId, ac, reg, rows, zfw: { mass: zfw, moment: zfm }, ramp, to, ldg, ldgAlt, trip: { mass: tripU, litres: +tripL },
    mtow, mlw, div, pct, issues, ok: issues.length === 0,
    // kg values for the navlog header (TOM / LM boxes are in kg)
    tom: kg(to.mass), lm: kg(ldg.mass), lmAlt: kg(ldgAlt.mass), toCg: to.arm, ldgCg: ldg.arm,
  };
}

/** Moment as printed on the sheet (lb·in sheets print moment / 1000). */
export function fmtMoment(res, moment) {
  const v = moment / res.div;
  return v.toFixed(res.ac.momentDp);
}
