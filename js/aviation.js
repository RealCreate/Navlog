// Aviation layer of the app's own chart, drawn as vectors in the style of the Rogers Data VFR
// charts the school uses: CTA/TMA as a light-blue band inside a dark-blue line with red labels
// along the edge, CTRs/ATZs and restricted/danger/prohibited areas pink with a red edge, FIZ/RMZ
// dark navy with ticks, CTA sectors (e.g. CTA Vitoria CVIT-1…12) with their own floors, and the
// ENAIRE grid minimum altitudes as big red figures. Data: ENAIRE AIP service (data/aip.json).
//
// The same drawing is used on the map (canvas tiles) and on the printed briefing chart.

const TILE = 256;
export function worldPx(lat, lon, z) {
  const n = TILE * 2 ** z, r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}

const RED_TYPES = new Set(['R', 'P', 'D', 'TSA', 'TRA', 'Prohibido_Sobrevuelo', 'PROHIBIDO VFR']);
const ORDER = { TMA: 0, CTA: 0, 'CTA-P': 1, FIZ: 2, RMZ: 2, D: 3, R: 3, P: 3, TSA: 3, TRA: 3, Prohibido_Sobrevuelo: 3, 'PROHIBIDO VFR': 3, CTR: 4, ATZ: 5 };
export const NAVY = '#1d3f8f', BLUE_BAND = 'rgba(70,165,220,0.55)', RED = '#cc2a2a';

/** Airspaces worth showing on a VFR chart (lower limit below FL100), drawing order. */
export function chartAirspaces(list) {
  return (list || [])
    .filter((a) => a.type in ORDER && !(a.lowerFt != null && a.lowerFt >= 10000))
    .map((a) => {
      if (!a._bb) {
        let s = 90, n = -90, w = 180, e = -180;
        for (const r of a.rings) for (const [la, lo] of r) { if (la < s) s = la; if (la > n) n = la; if (lo < w) w = lo; if (lo > e) e = lo; }
        a._bb = { s, n, w, e };
      }
      return a;
    })
    .sort((a, b) => ORDER[a.type] - ORDER[b.type]);
}

/** Short level for labels: 'SFC' → GND, '1000ft AGL' → 1000AGL, '5500ft ALT/AMSL' → 5500, FL095. */
export function lvl(t) {
  const s = String(t || '');
  const fl = /FL\s?(\d{2,3})/i.exec(s); if (fl) return `FL${fl[1].padStart(3, '0')}`;
  const ft = /(\d{3,5})\s*ft\s*(AGL|HGT|GND)?/i.exec(s); if (ft) return ft[1] + (ft[2] ? 'AGL' : '');
  if (/SFC|GND/i.test(s)) return 'GND';
  return '';
}

function path(ctx, rings, P) {
  ctx.beginPath();
  for (const r of rings) r.forEach(([la, lo], i) => { const [x, y] = P(la, lo); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.closePath();
}

/**
 * Draws the airspaces on ctx. P(lat, lon) → [x, y] in canvas pixels; z: map zoom; k: scale
 * factor for line widths (1 on screen, larger for print).
 */
export function drawAirspaces(ctx, list, P, z, k = 1, view = null) {
  const band = (z >= 10 ? 7 : z >= 8 ? 5 : 3) * k;
  for (const a of list) {
    if (view && (a._bb.e < view.w || a._bb.w > view.e || a._bb.n < view.s || a._bb.s > view.n)) continue;
    const t = a.type;
    ctx.save();
    if (t === 'TMA' || t === 'CTA') {
      path(ctx, a.rings, P); ctx.save(); ctx.clip();
      ctx.lineWidth = band * 2; ctx.strokeStyle = BLUE_BAND; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore();
      path(ctx, a.rings, P); ctx.lineWidth = 1.6 * k; ctx.strokeStyle = NAVY; ctx.stroke();
    } else if (t === 'CTA-P') {
      // CTA sector: thin dark-blue boundary (the CTA band is drawn by its parent CTA)
      path(ctx, a.rings, P); ctx.lineWidth = 1.1 * k; ctx.strokeStyle = 'rgba(29,63,143,0.85)'; ctx.setLineDash([6 * k, 3 * k]); ctx.stroke();
    } else if (t === 'FIZ' || t === 'RMZ') {
      path(ctx, a.rings, P); ctx.lineWidth = 2.2 * k; ctx.strokeStyle = NAVY; ctx.stroke();
      if (z >= 8) ticks(ctx, a.rings, P, 14 * k, 4.5 * k, 1.2 * k);
    } else if (t === 'CTR' || t === 'ATZ' || RED_TYPES.has(t)) {
      path(ctx, a.rings, P); ctx.fillStyle = t === 'ATZ' ? 'rgba(235,90,90,0.10)' : 'rgba(235,90,90,0.17)'; ctx.fill('evenodd');
      path(ctx, a.rings, P); ctx.save(); ctx.clip('evenodd');
      ctx.lineWidth = band * 1.6; ctx.strokeStyle = 'rgba(215,55,55,0.42)'; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore();
      path(ctx, a.rings, P); ctx.lineWidth = 1.7 * k; ctx.strokeStyle = RED; ctx.stroke();
    }
    ctx.restore();
  }
}

// small ticks on the inside of a boundary (FIZ/RMZ)
function ticks(ctx, rings, P, every, len, w) {
  ctx.lineWidth = w; ctx.strokeStyle = NAVY; ctx.beginPath();
  for (const r of rings) {
    const pts = r.map(([la, lo]) => P(la, lo));
    // orientation: ticks point inward
    let area = 0; for (let i = 0; i < pts.length - 1; i++) area += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
    const sgn = area > 0 ? 1 : -1;
    let carry = every / 2;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1], L = Math.hypot(x2 - x1, y2 - y1);
      if (L < 0.01) continue;
      const nx = (-(y2 - y1) / L) * sgn, ny = ((x2 - x1) / L) * sgn;
      let d = carry;
      while (d < L) { const x = x1 + ((x2 - x1) * d) / L, y = y1 + ((y2 - y1) * d) / L; ctx.moveTo(x, y); ctx.lineTo(x + nx * len, y + ny * len); d += every; }
      carry = d - L;
    }
  }
  ctx.stroke();
}

/** Grid lines of the ENAIRE AMA cells (30'), very light. */
export function drawAmaGrid(ctx, cells, P, k = 1) {
  ctx.save(); ctx.strokeStyle = 'rgba(120,120,120,0.35)'; ctx.lineWidth = 0.8 * k;
  for (const c of cells || []) {
    const [x0, y0] = P(c.n, c.w), [x1, y1] = P(c.s, c.e);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }
  ctx.restore();
}

/**
 * Labels: for CTA/TMA/CTR/CTA-sectors/FIZ a line of text along the longest edge on the inside
 * ("CTA VITORIA 2 'D' 1000AGL - FL095"), for R/D/P a stacked box at the centre
 * ("LE D 10 / FL080 / GND"). Returns [{ lat, lon, angle (deg), text | lines, kind, color }].
 */
export function airspaceLabels(list, avoid = []) {
  const avoidPx = avoid.map(([la, lo]) => worldPx(la, lo, 12));
  const out = [];
  const Z = 10;
  for (const a of list) {
    const t = a.type;
    const lo = lvl(a.lower) || (/sector/i.test(a.lower || '') ? 'SECTORS' : ''), up = lvl(a.upper);
    const cls = a.cls || (t === 'FIZ' ? 'G' : ['CTR', 'CTA', 'TMA', 'CTA-P', 'ATZ'].includes(t) ? 'D' : '');
    if (RED_TYPES.has(t)) {
      const id = (a.id || '').replace(/^LE([DRP])(\d)/, 'LE $1 $2');
      const lines = [id || a.name, up && (/FL/.test(up) ? up : up.includes('AGL') ? `${up.replace('AGL', '')} FT AGL` : `${up} FT MSL`), lo].filter(Boolean);
      const c = centroid(a.rings[0]);
      out.push({ lat: c[0], lon: c[1], angle: 0, lines, kind: 'box', color: RED });
      continue;
    }
    if (t === 'ATZ') continue; // shown with its CTR
    if (t === 'CTA-P') {
      // CTA sector: its name and floor inside it (e.g. "CVIT-4 / 1000 ft AGL"), as on the ENAIRE chart
      const c = interior(a.rings[0], avoidPx);
      const nm = (a.name || a.id).replace(/^A[12]\s*/, '').trim();
      const floor = lo.endsWith('AGL') ? `${lo.replace('AGL', '')} FT AGL` : /^\d/.test(lo) ? `${lo} FT` : lo;
      out.push({ lat: c[0], lon: c[1], angle: 0, lines: [`${nm} '${cls}'`, `${floor || '?'} - ${up || '?'}`], kind: 'box', color: NAVY, minZoom: 9 });
      continue;
    }
    let name = t === 'CTA-P' ? (a.name || a.id).replace(/^A[12]\s*/, '') : (a.name || a.id || t);
    name = name.replace(/\bAREA\b|\bÁREA\b/gi, '').replace(/\s+/g, ' ').replace(/\(RMZ\)|\(FPMZ\)/g, '').trim().toUpperCase();
    const text = `${name} '${cls}' ${lo || '?'} - ${up || '?'}`;
    // longest edge, label placed just inside it
    const ring = a.rings[0];
    let best = null;
    for (let i = 0; i < ring.length - 1; i++) {
      const p = worldPx(ring[i][0], ring[i][1], Z), q = worldPx(ring[i + 1][0], ring[i + 1][1], Z);
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (!best || L > best.L) best = { L, p, q, i };
    }
    if (!best) continue;
    if (best.L < 90) {
      // curved boundary (no long straight edge): label inside instead
      const c = interior(ring, avoidPx);
      out.push({ lat: c[0], lon: c[1], angle: 0, lines: [`${name} '${cls}'`, `${lo || '?'} - ${up || '?'}`], kind: 'box', color: t === 'FIZ' || t === 'RMZ' ? NAVY : RED, minZoom: 8 });
      continue;
    }
    let { p, q } = best;
    let ang = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
    // inward normal (by ring orientation)
    let area = 0; for (let i = 0; i < ring.length - 1; i++) { const u = worldPx(ring[i][0], ring[i][1], Z), v = worldPx(ring[i + 1][0], ring[i + 1][1], Z); area += u[0] * v[1] - v[0] * u[1]; }
    const L = best.L, sgn = area > 0 ? 1 : -1;
    const nx = (-(q[1] - p[1]) / L) * sgn, ny = ((q[0] - p[0]) / L) * sgn;
    if (ang > 90 || ang < -90) ang += 180;
    const mx = (p[0] + q[0]) / 2 + nx * 10, my = (p[1] + q[1]) / 2 + ny * 10; // 10 px inside at z10
    const ll = unproject(mx, my, Z);
    out.push({ lat: ll[0], lon: ll[1], angle: ang, text, kind: 'edge', color: t === 'FIZ' || t === 'RMZ' ? NAVY : RED, minZoom: t === 'CTA-P' ? 9 : 8, edgePx10: L });
  }
  return out;
}

// A point well inside a polygon ring (coarse search for the point farthest from its edges).
function interior(ring, avoidPx = []) {
  const Z = 12, pts = ring.map(([la, lo]) => worldPx(la, lo, Z));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const inside = (x, y) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const segDist = (x, y) => { let m = Infinity; for (let i = 0; i < pts.length - 1; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1]; const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)); m = Math.min(m, Math.hypot(x - ax - t * dx, y - ay - t * dy)); } return m; };
  let best = null;
  const N = 14;
  for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
    const x = x0 + ((x1 - x0) * i) / N, y = y0 + ((y1 - y0) * j) / N;
    if (!inside(x, y)) continue;
    let d = segDist(x, y);
    // keep clear of aerodrome symbols and their names (~60 px at z10)
    for (const [ax, ay] of avoidPx) if (Math.hypot(ax - x, ay - y) < 240) d *= 0.25;
    if (!best || d > best.d) best = { d, x, y };
  }
  return best ? unproject(best.x, best.y, Z) : centroid(ring);
}

function centroid(r) {
  let la = 0, lo = 0; for (const p of r) { la += p[0]; lo += p[1]; }
  return [la / r.length, lo / r.length];
}
export function unproject(x, y, z) {
  const n = TILE * 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return [lat, lon];
}

/** Draws labels on a canvas (print). */
export function drawLabels(ctx, labels, P, k = 1, ama = []) {
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const c of ama) {
    const [x, y] = P((c.n + c.s) / 2, (c.w + c.e) / 2);
    const big = String(Math.floor(c.v / 10)), small = String(c.v % 10);
    ctx.font = `800 ${34 * k}px Helvetica, Arial, sans-serif`; ctx.fillStyle = 'rgba(205,35,35,0.55)';
    const w = ctx.measureText(big).width;
    ctx.fillText(big, x + 60 * k, y - 40 * k);
    ctx.font = `800 ${20 * k}px Helvetica, Arial, sans-serif`; ctx.fillText(small, x + 60 * k + w / 2 + 7 * k, y - 32 * k);
  }
  for (const l of labels) {
    const [x, y] = P(l.lat, l.lon);
    ctx.save(); ctx.translate(x, y); ctx.rotate((l.angle * Math.PI) / 180);
    ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.fillStyle = l.color;
    if (l.kind === 'box') {
      ctx.font = `800 ${11 * k}px Helvetica, Arial, sans-serif`;
      l.lines.forEach((t, i) => { const yy = (i - (l.lines.length - 1) / 2) * 13 * k; ctx.lineWidth = 3 * k; ctx.strokeText(t, 0, yy); ctx.fillText(t, 0, yy); });
    } else {
      ctx.font = `700 ${10.5 * k}px Helvetica, Arial, sans-serif`; ctx.lineWidth = 3 * k; ctx.strokeText(l.text, 0, 0); ctx.fillText(l.text, 0, 0);
    }
    ctx.restore();
  }
  ctx.restore();
}
