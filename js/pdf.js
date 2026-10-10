// Fills the official FlyBy "Visual Operational Flight Plan" form (assets/navlog-template.pdf)
// with the computed navlog. Positions were measured from the form's own grid, so the
// printed page keeps FlyBy's layout and logo exactly. In-flight columns (ETA, ATE, ATA,
// AOBT, ATOT, LDG, OFF, Squawk) are left blank, as in the Excel workbook.

import { fmtMMSS, fmtVar, fmtAlt } from './nav.js';

const H = 595.32; // page height (A4 landscape)
const BLOCK_TOPS = [227.4, 275.9, 324.3, 373.1, 421.6, 470.0, 519.2];
const BLOCK_BOTTOM = 567.7;
const PER_SIDE = BLOCK_TOPS.length;

const LEFT = {
  wp: [18, 46.5], tc: [70, 93], var: [93, 120], alt: [120, 158], tas: [158, 186],
  dir: [186, 211], spd: [211, 246], wca: [246, 275], dist: [275, 304], gs: [304, 325],
  ete: [325, 350], eta: [350, 378], fuel: [378, 412],
};
const RIGHT = Object.fromEntries(Object.entries(LEFT).map(([k, [a, b]]) => [k, [a + 392, b + 392]]));
RIGHT.wp = [414, 438.5];

// Header value cells: [x0, x1, yTop, yBottom]
const HDR = {
  tripFuel: [718, 824, 31, 67],
  date: [154, 232, 68, 92], dep: [296, 359, 68, 92], dest: [430, 508, 68, 92], alt: [572, 639, 68, 92], altFuel: [718, 824, 68, 92],
  callsign: [154, 232, 92, 116], tom: [296, 359, 92, 116], lmDest: [430, 508, 92, 116], lmAlt: [572, 639, 92, 116], contingency: [718, 824, 92, 116],
  reg: [154, 232, 116, 140], elevDep: [296, 359, 116, 140], elevDest: [430, 508, 116, 140], elevAlt: [572, 639, 116, 140], finalReserve: [718, 824, 116, 140],
  weather: [154, 572, 140, 164],
  freq: [154, 430, 164, 188],
};

const fmtL = (v) => (v == null || v === '' ? '' : `${(+v).toFixed(1).replace(/\.0$/, '')} L`);
const fmtLx = (v) => (v == null || v === '' ? '' : `${(Math.round(+v * 100) / 100)} L`);
const fmtKg = (v) => (v == null || v === '' || !Number.isFinite(+v) ? '' : `${Math.round(+v * 10) / 10}`);

let templateBytes = null;
async function template() {
  if (!templateBytes) {
    const res = await fetch('assets/navlog-template.pdf');
    templateBytes = await res.arrayBuffer();
  }
  return templateBytes;
}

function textFits(font, text, size, width) {
  return font.widthOfTextAtSize(text, size) <= width;
}

function drawCentered(page, font, text, [x0, x1], yTop, yBottom, size = 8) {
  if (text == null || text === '') return;
  text = String(text);
  const w = x1 - x0 - 3;
  while (size > 4.5 && !textFits(font, text, size, w)) size -= 0.25;
  const tw = font.widthOfTextAtSize(text, size);
  const cy = (yTop + yBottom) / 2;
  page.drawText(text, { x: x0 + (x1 - x0 - tw) / 2, y: H - cy - size * 0.35, size, font });
}

function wrap(font, text, size, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const t = cur ? cur + ' ' + word : word;
    if (textFits(font, t, size, width)) cur = t;
    else { if (cur) lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawName(page, font, text, [x0, x1], yTop, yBottom) {
  if (!text) return;
  const width = x1 - x0 - 2;
  const height = yBottom - yTop - 2;
  let size = 7, lines;
  for (; size >= 4.5; size -= 0.25) {
    lines = wrap(font, text, size, width);
    const longest = Math.max(...lines.map((l) => font.widthOfTextAtSize(l, size)));
    if (longest <= width && lines.length * size * 1.15 <= height) break;
  }
  const lh = size * 1.15;
  const total = lines.length * lh;
  const cy = (yTop + yBottom) / 2;
  lines.forEach((l, i) => {
    const tw = font.widthOfTextAtSize(l, size);
    const yLine = cy - total / 2 + lh * (i + 0.5);
    page.drawText(l, { x: x0 + (x1 - x0 - tw) / 2, y: H - yLine - size * 0.35, size, font });
  });
}

function drawRow(page, font, bold, cols, b, r) {
  const top = BLOCK_TOPS[b];
  const bottom = b + 1 < PER_SIDE ? BLOCK_TOPS[b + 1] : BLOCK_BOTTOM;
  const mid = (top + bottom) / 2;
  const full = (k, v, f = font) => drawCentered(page, f, v, cols[k], top, bottom);
  const up = (k, v, f = font) => drawCentered(page, f, v, cols[k], top, mid);
  const dn = (k, v, f = font) => drawCentered(page, f, v, cols[k], mid, bottom);

  full('tc', r.tc);
  up('var', fmtVar(r.var)); dn('var', r.mc, bold);
  full('alt', fmtAlt(r.alt, r.altLabel));
  full('tas', r.tas);
  full('dir', r.wspd ? String(r.wdir).padStart(3, '0') : '');
  full('spd', r.wspd ? r.wspd : '');
  up('wca', r.wca > 0 ? `+${r.wca}` : r.wca); dn('wca', r.mh, bold);
  up('dist', r.dist); dn('dist', r.rem);
  full('gs', r.gs);
  up('ete', fmtMMSS(r.eteSec), bold);
  up('fuel', fmtL(r.fuel)); dn('fuel', r.fuelRem);
}

/**
 * pages: [{ header: {...}, rows: [...], firstName: 'LEBG' }]
 * Returns Uint8Array of the filled PDF.
 */
export async function buildNavlogPdf(sheets) {
  const { PDFDocument, StandardFonts } = window.PDFLib;
  const out = await PDFDocument.create();
  const src = await PDFDocument.load(await template());
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);

  for (const sheet of sheets) {
    const rows = sheet.rows;
    const perPage = PER_SIDE * 2;
    const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
    for (let p = 0; p < pageCount; p++) {
      const [page] = await out.copyPages(src, [0]);
      out.addPage(page);
      fillHeader(page, font, bold, sheet.header);
      const slice = rows.slice(p * perPage, (p + 1) * perPage);
      slice.forEach((r, idx) => {
        const side = idx < PER_SIDE ? LEFT : RIGHT;
        const b = idx % PER_SIDE;
        if (b === 0) {
          // "from" name in the top half of the first block of each column
          const top = BLOCK_TOPS[0];
          drawName(page, bold, r.from, side.wp, top, (top + BLOCK_TOPS[1]) / 2);
        }
        drawRow(page, font, bold, side, b, r);
        // destination name in the lower half of the block, level with the arrow's lower edge (as in the Excel)
        const top = BLOCK_TOPS[b];
        const bottom = b + 1 < PER_SIDE ? BLOCK_TOPS[b + 1] : BLOCK_BOTTOM;
        drawName(page, bold, r.to, side.wp, (top + bottom) / 2, bottom);
      });
    }
  }
  return out.save();
}

function fillHeader(page, font, bold, h) {
  const c = (k, v, f = font, size = 8.5) => { const [x0, x1, t, b] = HDR[k]; drawCentered(page, f, v, [x0, x1], t, b, size); };
  c('tripFuel', fmtL(h.trip), bold, 11);
  c('date', h.date);
  c('dep', h.dep, bold); c('dest', h.dest, bold); c('alt', h.alt, bold);
  c('altFuel', fmtL(h.altFuel), bold);
  c('callsign', h.callsign); c('tom', fmtKg(h.tom)); c('lmDest', fmtKg(h.lmDest)); c('lmAlt', fmtKg(h.lmAlt));
  c('contingency', fmtLx(h.contingency), bold);
  c('reg', h.reg); c('elevDep', h.elevDep); c('elevDest', h.elevDest); c('elevAlt', h.elevAlt);
  c('finalReserve', fmtL(h.finalReserve), bold);
  if (h.weather) { const [x0, x1, t, b] = HDR.weather; page.drawText(String(h.weather), { x: x0 + 4, y: H - (t + b) / 2 - 3, size: 7.5, font, maxWidth: x1 - x0 - 8 }); }
  if (h.freq) { const [x0, x1, t, b] = HDR.freq; page.drawText(String(h.freq), { x: x0 + 4, y: H - (t + b) / 2 - 3, size: 8.5, font }); }
}

/* ---------------- Mass & balance sheet (P2008 JC form) ---------------- */

const MB_H = 841.92; // A4 portrait
let mbTemplateBytes = null;

/**
 * mb: { date, reg, studentCode, weather, notams, rows: { empty, pilot, copilot, baggage, fuel, trip }
 *        each [mass, arm, moment], to: [mass, cg, moment], ldg: [mass, cg, moment] }
 */
export async function buildMbPdf(mb) {
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  if (!mbTemplateBytes) mbTemplateBytes = await (await fetch('assets/mb-p2008-template.pdf')).arrayBuffer();
  const doc = await PDFDocument.load(mbTemplateBytes);
  const page = doc.getPages()[0];
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const cell = (text, [x0, x1], yTop, yBottom, f = font, size = 10, color) => {
    if (text == null || text === '') return;
    text = String(text);
    while (size > 5 && f.widthOfTextAtSize(text, size) > x1 - x0 - 6) size -= 0.25;
    const tw = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: x0 + (x1 - x0 - tw) / 2, y: MB_H - (yTop + yBottom) / 2 - size * 0.35, size, font: f, color });
  };
  const para = (text, x0, x1, yTop, yBottom) => {
    if (!text) return;
    page.drawText(String(text), { x: x0 + 6, y: MB_H - yTop - 14, size: 8.5, font, maxWidth: x1 - x0 - 12, lineHeight: 10.5 });
  };
  cell(mb.date, [35, 166], 150, 174);
  cell(mb.reg, [167, 297], 150, 174, bold);
  cell(mb.studentCode, [298, 429], 150, 174);
  para(mb.weather, 98, 560, 197, 249);
  para(mb.notams, 98, 560, 249, 300);

  const W = [167, 297], A = [298, 429], M = [429, 560];
  const n = (v, d) => (v == null || !Number.isFinite(+v) ? '' : (+v).toFixed(d));
  const rowsY = { empty: [377, 411], pilot: [411, 444], copilot: [444, 478], baggage: [478, 511], fuel: [511, 545], trip: [599, 633] };
  for (const [k, [t, b]] of Object.entries(rowsY)) {
    const r = mb.rows[k]; if (!r) continue;
    cell(n(r[0], 1), W, t, b);
    if (k === 'empty') cell(n(r[1], 3), A, t, b); // other arms are printed on the form
    cell(n(r[2], 1), M, t, b);
  }
  const red = rgb(0.84, 0, 0.08);
  for (const [k, t, b] of [['to', 545, 599], ['ldg', 633, 687]]) {
    const r = mb[k]; if (!r) continue;
    cell(n(r[0], 1), W, t, b, bold, 11, r[3] ? undefined : red);
    cell(n(r[1], 3), A, t + 14, b, bold, 11, r[4] ? undefined : red);
    cell(n(r[2], 1), M, t, b, bold, 11);
  }
  return doc.save();
}
