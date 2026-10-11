// Briefing pages in the SOP briefing order (Briefing List): weather, NOTAMs, ATC flight plan,
// mission objective (route, departure/arrival briefings, charts, frequencies, alternate),
// mass & balance, performance, TEM — plus the go/no-go list. The navlog and M&B sheets are
// appended after these pages by the caller.

const A4 = [595.28, 841.89];
const M = 42; // margins

// The standard PDF fonts only cover WinAnsi: replace the few symbols the app uses.
const MAP = { '→': '->', '←': '<-', '↑': '^', '↓': 'v', '≥': '>=', '≤': '<=', '✕': 'X', '✓': 'OK', '−': '-', '⚠': '!', '︎': '', ' ': ' ', ' ': ' ', ' ': ' ' };
export function pdfText(s) {
  return String(s ?? '').replace(/[^\x20-\x7E -ÿ–—‘’“”•…€]/g, (c) => (c in MAP ? MAP[c] : ''));
}

class Writer {
  constructor(doc, fonts, title) {
    this.doc = doc; this.f = fonts; this.title = title; this.page = null; this.y = 0; this.n = 0;
    this.ink = window.PDFLib.rgb(0.1, 0.1, 0.12); this.grey = window.PDFLib.rgb(0.42, 0.42, 0.47);
    this.red = window.PDFLib.rgb(0.8, 0.05, 0.1); this.amber = window.PDFLib.rgb(0.75, 0.45, 0); this.green = window.PDFLib.rgb(0.1, 0.55, 0.25);
    this.line = window.PDFLib.rgb(0.8, 0.8, 0.83); this.tint = window.PDFLib.rgb(0.82, 0, 0.6);
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage(A4); this.n++;
    this.y = M;
    this.text(this.title, M, 8.5, this.f.bold, this.grey);
    this.page.drawText(pdfText(`Briefing · page ${this.n}`), { x: A4[0] - M - 70, y: A4[1] - M, size: 8.5, font: this.f.reg, color: this.grey });
    this.y += 14;
    this.page.drawLine({ start: { x: M, y: A4[1] - this.y }, end: { x: A4[0] - M, y: A4[1] - this.y }, thickness: 0.5, color: this.line });
    this.y += 14;
  }
  need(h) { if (this.y + h > A4[1] - M) this.newPage(); }
  text(t, x, size, font, color) { this.page.drawText(pdfText(t), { x, y: A4[1] - this.y - size * 0.8, size, font, color: color || this.ink }); }
  wrap(t, size, font, width) {
    const out = [];
    for (const para of pdfText(t).split('\n')) {
      let cur = '';
      for (const w of para.split(/(\s+)/)) {
        const next = cur + w;
        if (font.widthOfTextAtSize(next.trimEnd(), size) > width && cur.trim()) { out.push(cur.trimEnd()); cur = w.trimStart(); } else cur = next;
      }
      out.push(cur.trimEnd());
    }
    return out;
  }
  para(t, { size = 9.5, font = this.f.reg, color, x = M, width = A4[0] - 2 * M - (x - M), gap = 3 } = {}) {
    if (t == null || t === '') return;
    for (const l of this.wrap(t, size, font, width)) { this.need(size * 1.35); this.text(l, x, size, font, color); this.y += size * 1.35; }
    this.y += gap;
  }
  heading(t) {
    this.need(40); this.y += 6;
    this.text(t, M, 12.5, this.f.bold, this.tint); this.y += 18;
  }
  sub(t, right, rightColor) {
    this.need(18);
    this.text(t, M, 10.5, this.f.bold);
    if (right) { const w = this.f.bold.widthOfTextAtSize(pdfText(right), 9); this.text(right, A4[0] - M - w, 9, this.f.bold, rightColor); }
    this.y += 15;
  }
  row(label, value, color) {
    this.need(14);
    const lines = this.wrap(label, 9.5, this.f.reg, 330);
    lines.forEach((l, i) => { this.text(l, M + 8, 9.5, this.f.reg); if (i === 0 && value != null) { const w = this.f.bold.widthOfTextAtSize(pdfText(value), 9.5); this.text(value, A4[0] - M - w, 9.5, this.f.bold, color); } this.y += 13; });
  }
  mono(t) { this.para(t, { size: 8.5, font: this.f.mono, x: M + 8, gap: 5 }); }
  rule() { this.need(10); this.page.drawLine({ start: { x: M, y: A4[1] - this.y }, end: { x: A4[0] - M, y: A4[1] - this.y }, thickness: 0.4, color: this.line }); this.y += 8; }
}

export async function fonts(doc) {
  const { StandardFonts } = window.PDFLib;
  return { reg: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), mono: await doc.embedFont(StandardFonts.Courier) };
}

/**
 * B: briefingData() of one flight; meta: { title, flightLine, notams, rows (navlog rows), tem (checked map), fuel }.
 */
export function addBriefingPages(doc, F, B, meta) {
  const W = new Writer(doc, F, meta.title);
  const lvl = (l) => (l === 'bad' ? W.red : l === 'warn' ? W.amber : W.grey);
  W.para(meta.flightLine, { size: 10, font: F.bold });

  // Go / no-go
  const bad = B.issues.filter((i) => i.level === 'bad').length, warn = B.issues.filter((i) => i.level === 'warn').length;
  W.sub('Go / no-go', bad ? `${bad} NO-GO` : 'NO BLOCKERS FOUND', bad ? W.red : W.green);
  if (!B.issues.length) W.para('No issues found. The final decision stays with the PIC and the instructor.', { color: W.grey });
  for (const i of B.issues) W.para(`${i.level === 'bad' ? 'X' : i.level === 'warn' ? '!' : 'i'}  ${i.text}`, { color: lvl(i.level), x: M + 8, gap: 1 });
  if (warn) W.y += 4;

  // 1. Weather
  W.heading('1 · Weather (METAR / TAF)');
  if (!B.wx.length) W.para('No aerodromes planned.', { color: W.grey });
  for (const { ad, t, role, w, a, st } of B.wx) {
    W.sub(`${ad.icao} ${ad.name || ''} · ${role} · ${meta.zl(t)} ±1 h`, st[1], st[0] === 'bad' ? W.red : st[0] === 'warn' ? W.amber : st[0] === 'ok' ? W.green : W.grey);
    if (w.metar) { W.para(meta.metarSummary(w.metar) + (a.xw ? ` · best RWY ${a.xw.rwy}: crosswind ${a.xw.xw} kt` : ''), { size: 9, color: W.grey, x: M + 8, gap: 1 }); W.mono(w.metar.rawOb); } else W.para('No METAR in the briefing data (fetch it in the Briefing tab).', { size: 9, color: W.grey, x: M + 8 });
    if (w.taf) W.mono(w.taf.rawTAF);
    for (const i of a.issues) W.para(`${i.level === 'bad' ? 'X' : '!'}  ${i.text}`, { size: 9, color: lvl(i.level), x: M + 8, gap: 1 });
  }
  W.para(B.limits + ' Also brief the surface pressure chart, SIGWX and wind charts (Windy / AEMET).', { size: 8.5, color: W.grey });

  // 2. NOTAMs
  W.heading('2 · NOTAMs');
  W.row(`Aerodromes to check: ${B.notamAds.join(', ') || '—'} (every alternate individually)`, 'ICARO');
  W.row('En-route NOTAMs', 'Insignia VFR');
  W.para(meta.notams ? `Bulletin / relevant NOTAMs: ${meta.notams}` : 'Bulletin code / relevant NOTAMs: ____________________________________________', { x: M + 8 });

  // 3. ATC flight plan
  W.heading('3 · ATC flight plan (draft)');
  if (B.fpl) { W.mono(B.fpl); W.para('EOBT 10 min before takeoff. Check equipment, endurance and persons on board before filing.', { size: 8.5, color: W.grey }); } else W.para('Plan a route between two aerodromes.', { color: W.grey });

  // 4. Mission objective
  W.heading('4 · Mission objective');
  if (meta.rows && meta.rows.length) {
    W.sub('Route');
    const cols = [['From', 0], ['To', 90], ['ALT', 180], ['MH', 228], ['Dist', 268], ['GS', 310], ['ETE', 345], ['Fuel', 395]];
    W.need(14); cols.forEach(([c, x]) => W.text(c, M + 8 + x, 8.5, F.bold, W.grey)); W.y += 12;
    for (const r of meta.rows) {
      W.need(12);
      const v = [r.from, r.to, r.altDisp || '', `${String(r.mh).padStart(3, '0')}°`, `${r.dist}`, `${r.gs}`, meta.mmss(r.eteSec), `${r.fuel}`];
      cols.forEach(([, x], i) => W.text(String(v[i]).slice(0, i < 2 ? 18 : 10), M + 8 + x, 8.5, F.reg));
      W.y += 11.5;
    }
    W.para(`Total ${meta.totals}`, { size: 9, font: F.bold, x: M + 8 });
  }
  W.sub('Departure briefing'); W.para(B.depText || '—', { x: M + 8 });
  W.sub('Arrival briefing'); W.para(B.arrText || '—', { x: M + 8 });
  W.sub('Charts to have in sight'); W.para(`${B.chartAds.map((x) => `${x.icao} VAC`).join(' · ') || '—'} · ENAIRE 1:500 000 chart`, { x: M + 8 });
  W.sub('Frequencies'); W.para(B.freq, { x: M + 8 });
  if (B.alt) W.row(`Alternate: ${B.alt.icao} ${B.alt.name || ''} (company alternate policy: one FlyBy base among the alternates)`);

  // 5. M&B
  W.heading('5 · Mass & balance');
  const m = B.mb;
  if (m) {
    const u = m.ac.unit, a = m.ac.armUnit, dp = m.ac.armDp;
    W.row(`${m.ac.name} · ${m.reg || ''}`, m.ok ? 'IN LIMITS' : 'OUT OF LIMITS', m.ok ? W.green : W.red);
    W.row(`Take-off mass (max ${m.mtow} ${u})`, `${m.to.mass.toFixed(1)} ${u}`, m.to.massOk ? undefined : W.red);
    W.row('Take-off C.G.', `${m.to.arm.toFixed(dp)} ${a}`, m.to.cgOk ? undefined : W.red);
    W.row('Landing mass / C.G.', `${m.ldg.mass.toFixed(1)} ${u} / ${m.ldg.arm.toFixed(dp)} ${a}`, m.ldg.cgOk ? undefined : W.red);
    for (const i of m.issues) W.para(`X  ${i}`, { size: 9, color: W.red, x: M + 8, gap: 1 });
    W.para('The filled M&B sheet follows the navlog.', { size: 8.5, color: W.grey });
  } else W.para('Mass & balance not complete (registration / empty mass missing).', { color: W.red });
  if (B.fuel) {
    const p = B.fuel;
    W.sub('Fuel (SOP fuel calculations)');
    W.row('Taxi · trip · alternate', `${p.taxi} · ${p.trip.toFixed(1)} · ${p.alternate.toFixed(1)} L`);
    W.row('Contingency 5 % · final reserve 45 min · extra', `${p.contingency.toFixed(1)} · ${p.finalReserve} · ${p.extra} L`);
    W.row('Minimum required / on board', `${p.required} / ${p.fob} L`, p.fob >= p.required ? W.green : W.red);
    for (const c of p.checks) if (!c.ok) W.para(`X  ${c.text}`, { size: 9, color: W.red, x: M + 8, gap: 1 });
  }

  // 6. Performance
  W.heading('6 · Performance (take-off & landing)');
  if (!B.perf.length) W.para('Plan a route from an aerodrome.', { color: W.grey });
  for (const { c, r } of B.perf) {
    const isTo = c.role === 'dep';
    W.sub(`${isTo ? 'Take-off' : 'Landing'} · ${c.ad.icao} · PA ${c.pa} ft · OAT ${c.oat} °C · wind ${c.wind >= 0 ? 'head' : 'tail'} ${Math.abs(c.wind)} kt · ${c.surface}`);
    const ph = !r || r.manual ? null : isTo ? r.to : r.ldg;
    if (!ph || ph.manual) { W.para((r && (r.manual || ph?.manual)) || 'No table — use the AFM/POH', { color: W.amber, x: M + 8 }); continue; }
    W.row('Ground roll', `${ph.gr} ${r.unit}`);
    W.row(isTo ? 'Over 50 ft' : 'From 50 ft', `${ph.d50} ${r.unit}`);
    W.para(`${r.source}${ph.steps.length ? ' · ' + ph.steps.join(', ') : ''}. Compare with TORA / LDA (AD 2.13).`, { size: 8, color: W.grey, x: M + 8 });
  }

  // 7. TEM
  W.heading('7 · Threat & error management');
  for (const t of B.threats) W.para(`${meta.tem && meta.tem[t] ? '[x]' : '[ ]'}  ${t}`, { x: M + 8, gap: 1 });
  W.y += 6;
  W.para('Briefing order (SOP): weather, NOTAMs, ATC flight plan, mission objective, mass & balance, performance, TEM.', { size: 8, color: W.grey });
  return W.n;
}

/** Cover page for a mission: legs, figures and mission checks. */
export function addMissionCover(doc, F, { title, lines, legs, checks }) {
  const W = new Writer(doc, F, title);
  W.para(lines.join('\n'), { size: 11, font: F.bold });
  W.heading('Legs');
  for (const l of legs) { W.sub(l.label, l.status, l.ok ? W.green : W.amber); W.para(l.detail, { size: 9, color: W.grey, x: M + 8 }); }
  W.heading('Mission checks');
  for (const c of checks) W.row(c.text, c.ok ? 'OK' : 'X', c.ok ? W.green : W.red);
}
