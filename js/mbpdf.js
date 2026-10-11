// Fills the school's own M&B sheet for each aircraft type (the only approved templates, SOP
// "MASS & BALANCE"). Cell positions were measured on each sheet (points, y from the top of
// the page). The take-off and landing points are also plotted on the sheet's envelope chart,
// as the sheets ask ("locate this point on the C.G. envelope").

import { embedPlan } from './plans.js';

// Row keys: empty, pilot, copilot, front (pilot + front passenger), pax, pax1, pax2, baggage,
// baggage2, zfw, fuel, ramp, taxi, to, trip, ldg. Each row: [yCentre, halfHeight].
const FORMS = {
  P2008: {
    file: 'assets/mb/P2008.pdf', size: 10,
    header: { page: 0, date: [35, 166, 150, 174], reg: [167, 297, 150, 174], student: [298, 429, 150, 174], weather: [98, 560, 197, 249], notams: [98, 560, 249, 300] },
    table: {
      page: 0, w: [167, 297], a: [298, 429], m: [429, 560],
      rows: { empty: [394, 17], pilot: [427.5, 16], copilot: [461, 17], baggage: [494.5, 16], fuel: [528, 17], to: [572, 27], trip: [616, 17], ldg: [660, 27] },
      armRows: ['empty', 'to', 'ldg'], armOffset: { to: 7, ldg: 7 },
    },
  },
  PMENTOR: {
    file: 'assets/mb/PMENTOR.pdf', size: 9.5,
    header: { page: 0, date: [36, 166, 117, 146], reg: [166, 297, 117, 146], student: [297, 428, 117, 146], weather: [95, 560, 157, 182], notams: [95, 560, 185, 210] },
    table: {
      page: 0, w: [166, 297], a: [297, 428], m: [428, 560],
      rows: { empty: [262, 13], pilot: [290, 13], copilot: [318, 13], baggage: [346, 13], fuel: [374, 13], to: [402, 13], trip: [430, 13], ldg: [458, 13] },
      armRows: ['empty', 'to', 'ldg'], clear: ['empty'],
    },
    chart: { page: 0, x: 'moment', y: 'mass', xs: [750, 83.9, 1400, 541.8], ys: [450, 767.1, 750, 500.6] },
  },
  P2002: {
    file: 'assets/mb/P2002.pdf', size: 9,
    header: { page: 0, line: [560, 560, 836] },
    table: {
      page: 0, w: [175, 256], a: [256, 351], m: [351, 486],
      rows: { empty: [47, 7], pilot: [78.3, 7], copilot: [94.5, 7], baggage: [110.7, 7], fuel: [131.4, 9], to: [176.4, 12], trip: [216.9, 12], ldg: [250.2, 12] },
      armRows: ['empty'], clear: ['empty'],
    },
    chart: { page: 0, x: 'moment', y: 'mass', xs: [650, 66.96, 1100, 495.7], ys: [400, 534.6, 650, 278.6] },
  },
  PS28: {
    file: 'assets/mb/PS28.pdf', size: 8.5, thousands: true,
    header: { page: 0, reg: [322, 378, 462, 478], date: [322, 378, 503, 519], student: [322, 378, 523, 539] },
    table: {
      page: 0, w: [140, 200], a: [225, 282], m: [298, 380],
      rows: { empty: [161, 7], pilot: [178, 7], copilot: [195, 7], baggage: [213, 8], baggage2: [232, 7], fuel: [249, 7] },
      armRows: ['empty'],
      totals: { mass: [150, 210, 270, 282], cg: [240, 275, 259, 273], pct: [228, 264, 278, 292], moment: [318, 380, 270, 282] },
    },
  },
  C172: {
    file: 'assets/mb/C172.pdf', size: 8.5,
    table: {
      page: 1, w: [414.5, 467], m: [467, 520],
      rows: { empty: [523, 9], fuel: [549, 8], front: [588, 8], pax: [604, 8], baggage: [628, 9], baggage2: [645, 8], to: [670, 9] },
    },
    header: { page: 1, line: [432, 60, 400] },
    chart: { page: 2, x: 'moment', y: 'mass', xs: [45, 123.5, 110, 463.5], ys: [1500, 708, 2300, 495], div: 1000 },
  },
  C172RG: {
    file: 'assets/mb/C172RG.pdf', size: 7.5,
    table: {
      page: 2, w: [402, 447], m: [447, 492],
      rows: { empty: [163, 7], fuel: [179, 6], front: [211.5, 6], pax: [223, 6], baggage: [236, 6], baggage2: [248, 6], ramp: [267, 8], taxi: [283.5, 8], to: [307, 9] },
    },
    header: { page: 2, line: [80, 60, 540] },
    chart: { page: 2, x: 'arm', y: 'mass', xs: [35, 140.8, 48, 449.3], ys: [1600, 694.4, 2700, 428.8] },
  },
  PA28: {
    file: 'assets/mb/PA28.pdf', size: 9,
    header: { page: 0, studentAt: [100, 61.5], dateAt: [100, 76], regAt: [118, 90.5] },
    table: {
      page: 0, w: [187, 245], a: [245, 310.5], m: [310.5, 364.5],
      rows: { empty: [166.5, 10], front: [189, 10], pax: [211.5, 10], fuel: [233, 10], baggage: [254.7, 10], to: [275.4, 10] },
      armRows: ['empty', 'to'],
    },
    chart: { page: 0, x: 'arm', y: 'mass', xs: [82, 163.8, 96, 472.5], ys: [1200, 684, 2800, 360] },
  },
  P2006: {
    file: 'assets/mb/P2006.pdf', size: 8.5,
    header: { page: 0, date: [72, 189, 135, 158], reg: [189, 308, 135, 158], student: [308, 427, 135, 158], weather: [126, 546, 178, 227], notams: [126, 546, 227, 275] },
    table: {
      page: 0, w: [213, 319], a: [319, 416], m: [416, 519],
      rows: { empty: [373.7, 8], pilot: [414, 8], copilot: [432, 8], pax1: [449, 8], pax2: [468, 8], baggage: [492.5, 8], zfw: [532, 18], fuel: [578, 18], to: [641, 16], trip: [683, 22], ldg: [728, 18] },
      armRows: ['empty'],
    },
    chart: { page: 1, x: 'mass', y: 'moment', xs: [790, 459.8, 1290, 146.4], ys: [175, 642.7, 325, 472.8] },
  },
  P2006NG: {
    file: 'assets/mb/P2006NG.pdf', size: 9,
    header: { page: 0, date: [34, 166, 108, 132], reg: [166, 297, 108, 132], student: [297, 428, 108, 132], weather: [97, 560, 158, 207], notams: [97, 560, 207, 263] },
    table: {
      page: 0, w: [223, 313], a: [313, 419], m: [419, 558],
      rows: { empty: [368, 10], pilot: [417, 10], copilot: [442, 10], pax1: [466, 10], pax2: [491, 10], baggage: [517, 10], zfw: [549, 18], fuel: [598, 22], to: [689, 22], trip: [738, 22], ldg: [792, 22] },
      armRows: ['empty'],
    },
    chart: { page: 1, x: 'mass', y: 'moment', xs: [790, 489.6, 1290, 128.6], ys: [175, 685.4, 325, 472.8] },
  },
};

// Top edge of the page in PDF space (some sheets have a MediaBox that does not start at 0).
const topOf = (page) => { const b = page.getMediaBox(); return b.y + b.height; };

const lin = ([v1, p1, v2, p2], v) => p1 + ((v - v1) / (v2 - v1)) * (p2 - p1);

/** Values for each row key from a computeMb() result: [mass, arm, moment] in sheet units. */
function rowValues(m) {
  const out = {};
  const by = Object.fromEntries(m.rows.map((r) => [r.id, r]));
  for (const r of m.rows) out[r.id] = [r.mass, r.arm, r.moment];
  const front = m.rows.filter((r) => m.ac.stations.find((s) => s.id === r.id && s.group === 'front'));
  if (front.length) { const ms = front.reduce((t, r) => t + r.mass, 0), mo = front.reduce((t, r) => t + r.moment, 0); out.front = [ms, ms ? mo / ms : null, mo]; }
  out.zfw = [m.zfw.mass, m.zfw.moment / m.zfw.mass, m.zfw.moment];
  if (m.ramp) out.ramp = [m.ramp.mass, m.ramp.arm, m.ramp.moment];
  out.to = [m.to.mass, m.to.arm, m.to.moment];
  out.trip = [-m.trip.mass, m.ac.fuelArm, -m.trip.mass * m.ac.fuelArm];
  out.ldg = [m.ldg.mass, m.ldg.arm, m.ldg.moment];
  void by;
  return out;
}

export function mbFormFor(m) {
  if (m.type === 'P2006' && m.ac.ngRegs && m.ac.ngRegs.includes(m.reg)) return FORMS.P2006NG;
  return FORMS[m.type];
}

export async function buildMbFormPdf(m, meta, plan) {
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const form = mbFormFor(m);
  if (!form) throw new Error('No M&B sheet for this type');
  const bytes = await (await fetch(form.file)).arrayBuffer();
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const blue = rgb(0.05, 0.25, 0.75), red = rgb(0.84, 0, 0.08), white = rgb(1, 1, 1);
  const ac = m.ac;

  const cell = (page, text, [x0, x1], yC, f = font, size = form.size, color = blue) => {
    if (text == null || text === '') return;
    text = String(text);
    const H = topOf(page);
    while (size > 5 && f.widthOfTextAtSize(text, size) > x1 - x0 - 4) size -= 0.25;
    const tw = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: x0 + (x1 - x0 - tw) / 2, y: H - yC - size * 0.35, size, font: f, color });
  };
  const para = (page, text, [x0, x1, yT, yB]) => {
    if (!text) return;
    const H = topOf(page);
    page.drawText(String(text), { x: x0 + 5, y: H - yT - 12, size: 8, font, color: blue, maxWidth: x1 - x0 - 10, lineHeight: 10 });
    void yB;
  };
  const num = (v, dp) => {
    if (v == null || !Number.isFinite(v)) return '';
    const s = v.toFixed(dp);
    return form.thousands ? Number(s).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : s;
  };
  const mom = (v) => num(v / (ac.momentDiv || 1), ac.momentDp);

  // header
  const h = form.header || {};
  if (h.page != null) {
    const p = pages[h.page];
    if (h.date) cell(p, meta.date, h.date, (h.date[2] + h.date[3]) / 2);
    if (h.reg) cell(p, meta.reg, h.reg, (h.reg[2] + h.reg[3]) / 2, bold);
    if (h.student) cell(p, meta.studentCode, h.student, (h.student[2] + h.student[3]) / 2);
    if (h.weather) para(p, meta.weather, h.weather);
    if (h.notams) para(p, meta.notams, h.notams);
    const H = topOf(p);
    if (h.line) {
      const [yC, x0, x1] = h.line;
      const txt = [`Date ${meta.date}`, `Reg ${meta.reg}`, meta.studentCode ? `Student ${meta.studentCode}` : ''].filter(Boolean).join('   ·   ');
      p.drawText(txt, { x: x0, y: H - yC - 3, size: 9, font: bold, color: blue, maxWidth: x1 - x0 });
    }
    if (h.studentAt && meta.studentCode) p.drawText(meta.studentCode, { x: h.studentAt[0], y: H - h.studentAt[1] - 3, size: 9, font, color: blue });
    if (h.dateAt) p.drawText(meta.date, { x: h.dateAt[0], y: H - h.dateAt[1] - 3, size: 9, font, color: blue });
    if (h.regAt) p.drawText(meta.reg || '', { x: h.regAt[0], y: H - h.regAt[1] - 3, size: 9, font: bold, color: blue });
  }

  // table
  const t = form.table;
  const p = pages[t.page];
  const H = topOf(p);
  const vals = rowValues(m);
  for (const key of t.clear || []) {
    const [y, hh] = t.rows[key];
    for (const c of [t.w, t.a, t.m].filter(Boolean)) p.drawRectangle({ x: c[0] + 1.5, y: H - y - hh + 1.5, width: c[1] - c[0] - 3, height: hh * 2 - 3, color: white });
  }
  for (const [key, [y]] of Object.entries(t.rows)) {
    const v = vals[key];
    if (!v) continue;
    const total = key === 'to' || key === 'ldg' || key === 'zfw' || key === 'ramp';
    const okMass = key === 'to' ? m.to.massOk : key === 'ldg' ? m.ldg.massOk : key === 'zfw' ? !(ac.mzfw && m.zfw.mass > ac.mzfw) : key === 'ramp' ? !(ac.ramp && m.ramp.mass > ac.ramp) : true;
    const okCg = key === 'to' ? m.to.cgOk : key === 'ldg' ? m.ldg.cgOk : true;
    const f = total ? bold : font, size = total ? form.size + 0.5 : form.size;
    cell(p, num(v[0], 1), t.w, y, f, size, okMass ? blue : red);
    if (t.a && (t.armRows || []).includes(key)) cell(p, num(v[1], ac.armDp), t.a, y + ((t.armOffset || {})[key] || 0), f, size, okCg ? blue : red);
    cell(p, mom(v[2]), t.m, y, f, size, blue);
  }
  if (t.totals) {
    const T = t.totals, c = (k, txt, f = bold, color = blue) => cell(p, txt, [T[k][0], T[k][1]], (T[k][2] + T[k][3]) / 2, f, form.size, color);
    c('mass', num(m.to.mass, 1), bold, m.to.massOk ? blue : red);
    c('cg', num(m.to.arm, ac.armDp), bold, m.to.cgOk ? blue : red);
    if (ac.mac) c('pct', num(m.pct(m.to.arm), 1), bold, m.to.cgOk ? blue : red);
    c('moment', mom(m.to.moment));
  }

  // envelope chart: take-off (filled) and landing (ring) points
  if (form.chart) {
    const ch = form.chart, cp = pages[ch.page], CH = topOf(cp);
    const val = (axis, pt) => (axis === 'mass' ? pt.mass : axis === 'arm' ? pt.arm : pt.moment / (ch.div || 1));
    const at = (pt) => ({ x: lin(ch.xs, val(ch.x, pt)), y: CH - lin(ch.ys, val(ch.y, pt)) });
    const a = at(m.to), b = at(m.ldg);
    cp.drawLine({ start: a, end: b, thickness: 1.2, color: blue });
    cp.drawCircle({ x: a.x, y: a.y, size: 3.2, color: m.to.cgOk && m.to.massOk ? blue : red });
    cp.drawCircle({ x: b.x, y: b.y, size: 3.2, borderColor: m.ldg.cgOk && m.ldg.massOk ? blue : red, borderWidth: 1.4 });
    cp.drawText('T/O', { x: a.x + 5, y: a.y + 3, size: 7.5, font: bold, color: blue });
    cp.drawText('LDG', { x: b.x + 5, y: b.y - 9, size: 7.5, font: bold, color: blue });
  }

  if (meta.perf && meta.perf.length) addPerfPage(doc, font, bold, m, meta);
  if (plan) embedPlan(doc, plan);
  doc.setTitle(`M&B ${meta.reg || ac.name}`);
  return doc.save();
}

/** Extra page: take-off and landing distances (SOP: "M&B with Take Off and Landing Distances"). */
function addPerfPage(doc, font, bold, m, meta) {
  const { rgb } = window.PDFLib;
  const page = doc.addPage([595.28, 841.89]);
  const H = 841.89, ink = rgb(0.1, 0.1, 0.12), grey = rgb(0.45, 0.45, 0.5), blue = rgb(0.05, 0.25, 0.75), line = rgb(0.75, 0.75, 0.78);
  let y = 60;
  const text = (t, x, size = 10, f = font, color = ink) => page.drawText(String(t), { x, y: H - y, size, font: f, color });
  text('Take-off & landing distances', 40, 18, bold); y += 20;
  text(`${m.ac.name} · ${meta.reg || ''} · ${meta.date || ''}${meta.studentCode ? ` · student ${meta.studentCode}` : ''}`, 40, 10, font, grey); y += 28;
  const ftm = 3.28084;
  for (const { c, r } of meta.perf) {
    const isTo = c.role === 'dep';
    page.drawLine({ start: { x: 40, y: H - y + 12 }, end: { x: 555, y: H - y + 12 }, thickness: 0.6, color: line });
    text(`${isTo ? 'TAKE-OFF' : 'LANDING'} · ${c.ad.icao} ${c.ad.name || ''}`, 40, 12, bold); y += 18;
    text(`Elevation ${c.ad.elev} ft · QNH ${c.qnh} (${c.src.qnh}) · pressure altitude ${c.pa} ft · OAT ${c.oat} °C (${c.src.oat}) · wind ${c.wind >= 0 ? 'head' : 'tail'} ${Math.abs(c.wind)} kt (${c.src.wind}) · ${c.surface} · slope ${c.slope} %`, 40, 8.5, font, grey); y += 22;
    const ph = !r || r.manual ? null : isTo ? r.to : r.ldg;
    if (!ph || ph.manual) { text((r && (r.manual || ph?.manual)) || 'No table for this type — use the AFM/POH', 40, 10, font, rgb(0.84, 0, 0.08)); y += 30; continue; }
    const both = (v) => (r.unit === 'ft' ? `${v} ft  (${Math.round(v / ftm)} m)` : `${v} m  (${Math.round(v * ftm)} ft)`);
    text('Ground roll', 50, 11); text(both(ph.gr), 300, 11, bold, blue); y += 18;
    text(isTo ? 'Distance over 50 ft obstacle' : 'Distance from 50 ft', 50, 11); text(both(ph.d50), 300, 11, bold, blue); y += 18;
    if (ph.out) { text('Outside the table — nearest edge used, check the AFM', 50, 9, font, rgb(0.84, 0, 0.08)); y += 14; }
    text(`${r.source}${ph.steps && ph.steps.length ? ' · corrections: ' + ph.steps.join(', ') : ''}`, 50, 8, font, grey); y += 12;
    if (ph.note) { text(ph.note, 50, 8, font, grey); y += 12; }
    text('TORA / LDA (AD 2.13): ____________   Margin: ____________', 50, 9, font, ink); y += 30;
  }
}
