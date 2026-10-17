// Fills the official FlyBy "Visual Operational Flight Plan" form (assets/navlog-template.pdf)
// with the computed navlog. Positions were measured from the form's own grid, so the
// printed page keeps FlyBy's layout and logo exactly. In-flight columns (ETA, ATE, ATA,
// AOBT, ATOT, LDG, OFF, Squawk) are left blank, as in the Excel workbook.

import { fmtMMSS, fmtVar, fmtAlt } from './nav.js';
import { embedPlan } from './plans.js';

const H = 595.32; // page height (A4 landscape)
const BLOCK_TOPS = [227.4, 275.9, 324.3, 373.1, 421.6, 470.0, 519.2];
const BLOCK_BOTTOM = 567.7;
export const PER_SIDE = BLOCK_TOPS.length;

// Column edges (pt), measured from the form's printed grid. Both halves have the same columns
// but slightly different widths, so each half is listed in full.
const LEFT = {
  wp: [17.5, 46], tc: [72, 93], var: [93, 120], alt: [120, 158], tas: [158, 186.5],
  dir: [186.5, 211], spd: [211, 246], wca: [246, 275.5], dist: [275.5, 305], gs: [305, 326],
  ete: [326, 351], eta: [351, 378], fuel: [378, 413],
};
const RIGHT = {
  wp: [414, 440], tc: [465, 484], var: [484, 512], alt: [512, 548], tas: [548, 576],
  dir: [576, 605], spd: [605, 640], wca: [640, 675], dist: [675, 711], gs: [711, 732],
  ete: [732, 760], eta: [760, 789], fuel: [789, 823],
};

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

function drawCentered(page, font, text, [x0, x1], yTop, yBottom, size = 9) {
  if (text == null || text === '') return;
  text = String(text);
  const w = x1 - x0 - 4;
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

// Waypoint names fill their whole cell: as large as fits (max 8.5 pt), wrapped on spaces and
// hyphens, and narrowed (condensed up to 70 %) before the size is reduced, so names stay legible.
function drawName(page, font, text, [x0, x1], yTop, yBottom) {
  if (!text) return;
  const { pushGraphicsState, popGraphicsState, setCharacterSqueeze } = window.PDFLib;
  const width = x1 - x0 - 3;
  const height = yBottom - yTop - 3;
  const fit = (str) => {
    const words = str.replace(/([-/])/g, '$1 ').replace(/\s+/g, ' ').trim();
    for (let size = 8.5; size >= 4.5; size -= 0.25) {
      for (const sq of [100, 90, 80, 70]) {
        const k = sq / 100;
        const lines = wrap(font, words, size * k, width).map((l) => l.replace(/([-/]) /g, '$1'));
        const longest = Math.max(...lines.map((l) => font.widthOfTextAtSize(l, size) * k));
        if (longest <= width && lines.length * size * 1.12 <= height) return { size, sq, lines };
      }
    }
    return { size: 4.5, sq: 70, lines: [str] };
  };
  let best = fit(String(text));
  if (best.size < 7.5 || best.sq < 85) {
    // a long single word (e.g. "Villadiego"): hyphenate it in two rather than print it tiny
    const split = String(text).split(' ').map((w) => (w.length >= 7 ? `${w.slice(0, Math.ceil(w.length / 2))}- ${w.slice(Math.ceil(w.length / 2))}` : w)).join(' ');
    const alt = fit(split);
    if (alt.size > best.size) best = alt;
  }
  const { size, sq, lines } = best;
  const lh = size * 1.12;
  const total = lines.length * lh;
  const cy = (yTop + yBottom) / 2;
  page.pushOperators(pushGraphicsState(), setCharacterSqueeze(sq));
  lines.forEach((l, i) => {
    const tw = font.widthOfTextAtSize(l, size) * sq / 100;
    const yLine = cy - total / 2 + lh * (i + 0.5);
    page.drawText(l, { x: x0 + (x1 - x0 - tw) / 2, y: H - yLine - size * 0.35, size, font });
  });
  page.pushOperators(popGraphicsState());
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
  const altText = r.altDisp || fmtAlt(r.alt, r.altLabel);
  full('alt', altText);
  if (r.vs) {
    // climb / descent arrow next to the altitude (Helvetica has no arrow glyph, so draw it)
    const size = 9;
    const tw = font.widthOfTextAtSize(altText, size);
    const [x0, x1] = cols.alt;
    const cx = x0 + (x1 - x0 + tw) / 2 + 5, cy = H - (top + bottom) / 2;
    const up = r.vs === 'up';
    page.drawSvgPath(up ? 'M 0 -4 L 3.2 1 L -3.2 1 Z' : 'M 0 4 L 3.2 -1 L -3.2 -1 Z', { x: cx, y: cy, color: window.PDFLib.rgb(0, 0, 0), scale: 1 });
    page.drawLine({ start: { x: cx, y: cy + (up ? -1 : 1) }, end: { x: cx, y: cy + (up ? -4 : 4) }, thickness: 1.1 });
  }
  full('tas', r.tas);
  full('dir', r.wspd ? String(r.wdir).padStart(3, '0') : '');
  full('spd', r.wspd ? r.wspd : '');
  up('wca', r.wca > 0 ? `+${r.wca}` : r.wca); dn('wca', r.mh, bold);
  up('dist', r.dist); dn('dist', r.rem);
  full('gs', r.gs);
  up('ete', fmtMMSS(r.eteSec), bold);
  if (r.ateOv) dn('ete', r.ateOv);
  if (r.etaOv) up('eta', r.etaOv);
  if (r.ataOv) dn('eta', r.ataOv);
  up('fuel', fmtL(r.fuel)); dn('fuel', r.fuelRem);
}

/**
 * pages: [{ header: {...}, rows: [...], firstName: 'LEBG' }]
 * Returns Uint8Array of the filled PDF.
 */
export async function buildNavlogPdf(sheets, plan) {
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
      // The right half of the form has a stray half-line across the TC column (the left half
      // does not): cover it so both halves read the same.
      for (let b = 0; b < PER_SIDE; b++) {
        const m = (BLOCK_TOPS[b] + (b + 1 < PER_SIDE ? BLOCK_TOPS[b + 1] : BLOCK_BOTTOM)) / 2;
        page.drawRectangle({ x: 463.9, y: H - m - 0.9, width: 19.4, height: 1.8, color: window.PDFLib.rgb(1, 1, 1) });
      }
      const slice = rows.slice(p * perPage, (p + 1) * perPage);
      slice.forEach((r, idx) => {
        const side = idx < PER_SIDE ? LEFT : RIGHT;
        const b = idx % PER_SIDE;
        const mid = (k) => (BLOCK_TOPS[k] + (k + 1 < PER_SIDE ? BLOCK_TOPS[k + 1] : BLOCK_BOTTOM)) / 2;
        // The waypoint column is split half a block down from the grid: the first cell holds the
        // starting point, then each cell (centred on a block line) holds the point the arrow leads to.
        if (b === 0) drawName(page, bold, r.from, side.wp, BLOCK_TOPS[0], mid(0));
        drawRow(page, font, bold, side, b, r);
        drawName(page, bold, r.to, side.wp, mid(b), b + 1 < PER_SIDE ? mid(b + 1) : BLOCK_BOTTOM);
      });
    }
  }
  if (plan) embedPlan(out, plan);
  out.setTitle(`Navlog ${sheets[0]?.header?.dep || ''}-${sheets[0]?.header?.dest || ''}`);
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

/* ---------------- Mass & balance sheet: the school's form for each type (see mbpdf.js) ---------------- */

export { buildMbFormPdf as buildMbPdf } from './mbpdf.js';
