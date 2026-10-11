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
  const lvl = (l) => (l === 'bad' ? W.red : W.amber);
  W.para(meta.flightLine, { size: 10, font: F.bold });

  // Go / no-go: only what needs attention
  const top = B.issues.filter((i) => i.level !== 'info');
  const bad = top.filter((i) => i.level === 'bad').length;
  W.sub('Go / no-go', bad ? `${bad} NO-GO` : 'NO BLOCKERS', bad ? W.red : W.green);
  for (const i of top) W.para(`${i.level === 'bad' ? 'X' : '!'}  ${i.text}`, { size: 9, color: lvl(i.level), x: M + 8, gap: 0 });
  W.y += 4;

  // 1. Weather: status + raw METAR / TAF
  W.heading('1 · Weather');
  for (const { ad, role, w, st } of B.wx) {
    W.sub(`${ad.icao} · ${role}`, st[1], st[0] === 'bad' ? W.red : st[0] === 'warn' ? W.amber : st[0] === 'ok' ? W.green : W.grey);
    W.mono(w.metar ? w.metar.rawOb : 'METAR —');
    if (w.taf) W.mono(w.taf.rawTAF);
  }

  // 2. NOTAMs
  W.heading('2 · NOTAMs');
  W.para(`${B.notamAds.join(', ') || '—'} (ICARO) · en-route (Insignia VFR)${meta.notams ? ` · ${meta.notams}` : ' · bulletin: ______________'}`, { x: M + 8 });

  // 3. ATC flight plan
  W.heading('3 · ATC flight plan');
  W.mono(B.fpl || '—');

  // 4. Mission objective: route, alternate, frequencies
  W.heading('4 · Route');
  if (meta.rows && meta.rows.length) {
    const cols = [['From', 0], ['To', 90], ['ALT', 180], ['MH', 228], ['Dist', 268], ['GS', 310], ['ETE', 345], ['Fuel', 395]];
    W.need(14); cols.forEach(([c, x]) => W.text(c, M + 8 + x, 8.5, F.bold, W.grey)); W.y += 12;
    for (const r of meta.rows) {
      W.need(12);
      const v = [r.from, r.to, r.altDisp || '', `${String(r.mh).padStart(3, '0')}°`, `${r.dist}`, `${r.gs}`, meta.mmss(r.eteSec), `${r.fuel}`];
      cols.forEach(([, x], i) => W.text(String(v[i]).slice(0, i < 2 ? 18 : 10), M + 8 + x, 8.5, F.reg));
      W.y += 11.5;
    }
    W.para(`Total ${meta.totals}${B.alt ? ` · alternate ${B.alt.icao}` : ''}`, { size: 9, font: F.bold, x: M + 8 });
  }
  W.para(`Freq: ${B.freq}`, { size: 9, x: M + 8 });

  // 5–6. M&B, fuel, performance — one line each
  W.heading('5 · M&B, fuel · 6 · Performance');
  const m = B.mb;
  if (m) W.row(`T/O ${m.to.mass.toFixed(1)} ${m.ac.unit} (max ${m.mtow}) · C.G. ${m.to.arm.toFixed(m.ac.armDp)} ${m.ac.armUnit} · LDG ${m.ldg.mass.toFixed(1)} ${m.ac.unit}`, m.ok ? 'IN LIMITS' : 'OUT', m.ok ? W.green : W.red);
  else W.row('Mass & balance', 'NOT DONE', W.red);
  if (B.fuel) { const p = B.fuel; W.row(`Fuel: trip ${p.trip.toFixed(1)} · alternate ${p.alternate.toFixed(1)} · minimum ${p.required} L · on board ${p.fob} L`, p.fob >= p.required ? 'OK' : 'SHORT', p.fob >= p.required ? W.green : W.red); }
  for (const { c, r } of B.perf) {
    const ph = !r || r.manual ? null : c.role === 'dep' ? r.to : r.ldg;
    const txt = ph && !ph.manual ? `ground roll ${ph.gr} ${r.unit}${ph.d50 != null ? ` · 50 ft ${ph.d50} ${r.unit}` : ''}` : 'read the AFM chart';
    W.row(`${c.role === 'dep' ? 'T/O' : 'LDG'} ${c.ad.icao} (PA ${c.pa} ft, ${c.oat} °C, wind ${c.wind} kt): ${txt}`);
  }

  // 7. TEM
  W.heading('7 · TEM');
  for (const t of B.threats) W.para(`•  ${t}`, { size: 9, x: M + 8, gap: 0 });
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
