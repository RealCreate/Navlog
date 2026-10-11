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

/* ---------------- Navaids (Rogers-style VOR compass roses) ---------------- */
const VOR_TYPES = /VOR/i;
export function navaidLabel(n) {
  const t = n.type.replace('DVORDME', 'DVOR/DME').replace('VORDME', 'VOR/DME').replace('ILS_DME', 'ILS/DME');
  const f = n.freq != null ? String(n.freq.toFixed(n.unit === 'kHz' ? 0 : 2)).replace('.', ',') : '';
  return { lines: [t, `${n.name} ${f} ${n.id}`] };
}
/** Compass roses for VORs (oriented to magnetic north, var east-positive) and NDB symbols. */
export function drawNavaids(ctx, navaids, P, z, k = 1, varAt = () => 0) {
  if (z < 8) return;
  ctx.save();
  ctx.strokeStyle = NAVY; ctx.fillStyle = NAVY;
  for (const n of navaids || []) {
    if (/ILS/i.test(n.type)) continue;
    const [cx, cy] = P(n.lat, n.lon);
    if (VOR_TYPES.test(n.type)) {
      // rose radius 6 NM
      const [ex] = P(n.lat, n.lon + 6 / (60 * Math.cos((n.lat * Math.PI) / 180)));
      const r = Math.abs(ex - cx);
      ctx.lineWidth = 1 * k;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      const rot = ((varAt(n.lat, n.lon) || 0) * Math.PI) / 180; // magnetic north = true north + var E
      ctx.font = `700 ${Math.max(8, Math.min(12, r / 7)) * (k > 1 ? k : 1)}px Helvetica, Arial, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let d = 0; d < 360; d += 5) {
        const a = (d * Math.PI) / 180 + rot;
        const len = d % 30 === 0 ? r * 0.12 : d % 10 === 0 ? r * 0.08 : r * 0.04;
        const sx = cx + Math.sin(a) * r, sy = cy - Math.cos(a) * r;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(cx + Math.sin(a) * (r - len), cy - Math.cos(a) * (r - len)); ctx.stroke();
        if (d % 30 === 0 && z >= 9 && r > 40) {
          ctx.save(); ctx.translate(cx + Math.sin(a) * (r - len - 9 * k), cy - Math.cos(a) * (r - len - 9 * k)); ctx.rotate(a);
          ctx.fillText(String(d / 10), 0, 0); ctx.restore();
        }
      }
      // north arrow
      const a0 = rot;
      ctx.beginPath(); ctx.moveTo(cx + Math.sin(a0) * (r + 9 * k), cy - Math.cos(a0) * (r + 9 * k));
      ctx.lineTo(cx + Math.sin(a0 - 0.05) * r, cy - Math.cos(a0 - 0.05) * r); ctx.lineTo(cx + Math.sin(a0 + 0.05) * r, cy - Math.cos(a0 + 0.05) * r); ctx.closePath(); ctx.fill();
      // VOR hexagon (+ DME square)
      const h = 6 * k;
      ctx.lineWidth = 1.6 * k; ctx.beginPath();
      for (let i = 0; i < 6; i++) { const t = (i * Math.PI) / 3; const x = cx + Math.cos(t) * h, y = cy + Math.sin(t) * h; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.closePath(); ctx.stroke();
      if (/DME/i.test(n.type)) ctx.strokeRect(cx - h * 1.25, cy - h * 1.1, h * 2.5, h * 2.2);
      ctx.beginPath(); ctx.arc(cx, cy, 1.5 * k, 0, Math.PI * 2); ctx.fill();
    } else if (/NDB/i.test(n.type)) {
      ctx.fillStyle = 'rgba(29,63,143,0.85)';
      for (let ring = 1; ring <= 3; ring++) for (let i = 0; i < 12 + ring * 4; i++) {
        const t = (i / (12 + ring * 4)) * Math.PI * 2; ctx.beginPath(); ctx.arc(cx + Math.cos(t) * ring * 3.5 * k, cy + Math.sin(t) * ring * 3.5 * k, 0.9 * k, 0, Math.PI * 2); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(cx, cy, 2 * k, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

/* ---------------- Obstacles (ENAIRE eTOD, ≥ 100 m) ---------------- */
/** obstacles: [[lat, lon, topFt, heightFt, type, lit]] */
export function drawObstacles(ctx, obstacles, P, z, k = 1, view = null, tileW = Infinity) {
  if (z < 9) return;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const s = (z >= 11 ? 1.2 : 0.75) * k;
  const labelled = [];
  for (const o of obstacles || []) {
    const [la, lo, top, , type, lit] = o;
    if (view && (lo < view.w || lo > view.e || la < view.s || la > view.n)) continue;
    const [x, y] = P(la, lo);
    if (z < 10) { // overview: just a small mark per obstacle (wind farms read as dotted clusters)
      ctx.fillStyle = 'rgba(27,27,27,0.75)'; ctx.beginPath(); ctx.arc(x, y, 1.6 * k, 0, Math.PI * 2); ctx.fill();
      continue;
    }
    ctx.strokeStyle = '#1b1b1b'; ctx.fillStyle = '#1b1b1b'; ctx.lineWidth = (z >= 11 ? 1.4 : 1.1) * s;
    if (type === 'w') {
      // wind turbine: mast + three blades
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 9 * s); ctx.stroke();
      for (let i = 0; i < 3; i++) { const a = (i * 2 * Math.PI) / 3 - Math.PI / 2; ctx.beginPath(); ctx.moveTo(x, y - 9 * s); ctx.lineTo(x + Math.cos(a) * 5 * s, y - 9 * s + Math.sin(a) * 5 * s); ctx.stroke(); }
    } else {
      // obstacle: inverted V with a dot
      ctx.beginPath(); ctx.moveTo(x - 4.5 * s, y); ctx.lineTo(x, y - 11 * s); ctx.lineTo(x + 4.5 * s, y); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y - 1.5 * s, 1.3 * s, 0, Math.PI * 2); ctx.fill();
    }
    if (lit && z >= 11) {
      ctx.strokeStyle = '#d4a000'; ctx.lineWidth = 1 * s;
      for (const a of [-0.6, 0, 0.6]) { const b = a - Math.PI / 2; ctx.beginPath(); ctx.moveTo(x + Math.cos(b) * 12 * s, y - 9 * s + Math.sin(b) * 6 * s); ctx.lineTo(x + Math.cos(b) * 16 * s, y - 9 * s + Math.sin(b) * 9 * s); ctx.stroke(); }
    }
    // top elevation (ft AMSL) for the highest obstacle of each group, at higher zooms
    if (z >= 11 && !labelled.some(([lx, ly, lt]) => Math.hypot(lx - x, ly - y) < 60 * k && lt >= top)) {
      for (let i = labelled.length - 1; i >= 0; i--) if (Math.hypot(labelled[i][0] - x, labelled[i][1] - y) < 60 * k) labelled.splice(i, 1);
      labelled.push([x, y, top]);
    }
  }
  ctx.font = `700 ${10 * k}px Helvetica, Arial, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (const [x, y, top] of labelled) {
    const t = String(top), w = ctx.measureText(t).width;
    if (x + 8 * k + w > tileW) continue; // would be cut at the tile edge
    ctx.lineWidth = 3 * k; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.strokeText(t, x + 7 * k, y - 4 * k);
    ctx.fillStyle = '#1b1b1b'; ctx.fillText(t, x + 7 * k, y - 4 * k);
  }
  ctx.restore();
}
