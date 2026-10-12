// Printed marked map for the briefing (as students mark the paper chart): the ENAIRE VFR chart
// around the route with the track line, circled waypoints, 2-minute marks spaced by ground
// speed, TOC/TOD bars and a HAT box (heading · altitude · time) on every leg. The alternate
// route is drawn in blue. Rendered on a canvas from the same chart tiles the app shows.

const TILE = 256;
const MAXZ = 12, MINZ = 6;
const worldPx = (lat, lon, z) => {
  const n = TILE * 2 ** z, r = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
};

import { drawPlaces } from './places.js';
import { drawAirspaces, drawAmaGrid, drawLabels, drawNavaids, drawObstacles, navaidLabel } from './aviation.js';

async function tile(z, x, y, dir = 'tiles') {
  try {
    const res = await fetch(`${dir}/${z}/${x}/${y}.webp`);
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch { return null; }
}

const pad3 = (n) => String(n).padStart(3, '0');
const mmss = (s) => { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/**
 * routes: [{ wps:[{name,lat,lon}], rows: navlog rows, color, alt: bool }]
 * Returns { bytes (JPEG), width, height, zoom, nmPerPx }.
 */
export async function renderRouteMap(routes, { width = 2400, height = 1650, title = '', aviation = null } = {}) {
  const pts = routes.flatMap((r) => r.wps);
  if (pts.length < 2) return null;
  const lats = pts.map((p) => p.lat), lons = pts.map((p) => p.lon);
  const box = { n: Math.max(...lats), s: Math.min(...lats), e: Math.max(...lons), w: Math.min(...lons) };
  // largest zoom that fits the route with a margin
  let z = MAXZ;
  for (; z > MINZ; z--) {
    const a = worldPx(box.n, box.w, z), b = worldPx(box.s, box.e, z);
    if (b.x - a.x <= width * 0.82 && b.y - a.y <= height * 0.80) break;
  }
  const a = worldPx(box.n, box.w, z), b = worldPx(box.s, box.e, z);
  const ox = (a.x + b.x) / 2 - width / 2, oy = (a.y + b.y) / 2 - height / 2;
  const P = (p) => { const q = worldPx(p.lat, p.lon, z); return { x: q.x - ox, y: q.y - oy }; };

  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const g = c.getContext('2d');
  g.fillStyle = '#f2efe6'; g.fillRect(0, 0, width, height);
  // chart tiles
  const tx0 = Math.floor(ox / TILE), ty0 = Math.floor(oy / TILE), tx1 = Math.floor((ox + width) / TILE), ty1 = Math.floor((oy + height) / TILE);
  const jobs = [];
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) jobs.push(tile(z, tx, ty, aviation ? 'chart' : 'tiles').then((img) => img && g.drawImage(img, tx * TILE - ox, ty * TILE - oy, TILE, TILE)));
  await Promise.all(jobs);
  const s0 = Math.max(1, width / 2400);
  if (aviation) {
    // own chart: airspaces, grid minimum altitudes and labels drawn as vectors (sharp in print)
    const PP = (la, lo) => { const q = worldPx(la, lo, z); return [q.x - ox, q.y - oy]; };
    const k = 2 * s0;
    drawAmaGrid(g, aviation.ama, PP, k);
    drawAirspaces(g, aviation.list, PP, z, k);
    drawNavaids(g, aviation.navaids || [], PP, Math.max(z, 9), k, aviation.varAt || (() => 0));
    drawObstacles(g, aviation.obstacles || [], PP, Math.max(z, 11), k * 0.8);
    // town names in the Rogers style (one zoom step denser than the tiles: the sheet is read up close)
    if (aviation.places && aviation.places.length) {
      drawPlaces(g, aviation.places, PP, Math.min(z + 1, 11), { k: 2.1 * s0, style: 'rogers', inView: (la, lo) => { const [x, y] = PP(la, lo); return x > -20 && y > -20 && x < width + 20 && y < height + 20; } });
    }
    const vis = (l) => { const [x, y] = PP(l.lat, l.lon); return x > -50 && y > -50 && x < width + 50 && y < height + 50; };
    const navLabels = (aviation.navaids || []).filter((n) => !/ILS/i.test(n.type)).map((n) => ({ lat: n.lat - 0.06, lon: n.lon + 0.08, angle: 0, kind: 'box', color: '#1d3f8f', lines: navaidLabel(n).lines }));
    drawLabels(g, navLabels.concat(aviation.labels).filter((l) => vis(l) && (l.kind !== 'edge' || l.edgePx10 * 2 ** (z - 10) * 2 > l.text.length * 13)), PP, k * 0.9, aviation.ama.filter((c) => vis({ lat: (c.n + c.s) / 2, lon: (c.w + c.e) / 2 })));
  }

  const latC = (box.n + box.s) / 2;
  const mPerPx = (156543.034 * Math.cos((latC * Math.PI) / 180)) / 2 ** z;
  const pxPerNm = 1852 / mPerPx;
  const s = Math.max(1, width / 2400); // line scale

  const halo = (fn, w) => { g.save(); g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = w; fn(); g.stroke(); g.restore(); };
  const label = (text, x, y, { fg = '#111', bg = 'rgba(255,255,255,0.93)', border, size = 22, bold = true } = {}) => {
    g.font = `${bold ? 700 : 500} ${size * s}px Helvetica, Arial, sans-serif`;
    const w = g.measureText(text).width + 12 * s, h = size * s * 1.35;
    g.fillStyle = bg; g.strokeStyle = border || 'rgba(0,0,0,0.25)'; g.lineWidth = 2 * s;
    g.beginPath(); g.roundRect ? g.roundRect(x - w / 2, y - h / 2, w, h, 5 * s) : g.rect(x - w / 2, y - h / 2, w, h); g.fill(); g.stroke();
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y + 1);
  };

  // HAT box, numbered per leg: [n | heading | altitude | time]
  const hatSize = (n, parts) => {
    const size = 25 * s, padX = 10 * s, h = size * 1.5;
    g.font = `800 ${size}px Helvetica, Arial, sans-serif`;
    const cells = [n, ...parts].map((t) => ({ t, w: g.measureText(t).width + 2 * padX }));
    return { cells, W: cells.reduce((t, c) => t + c.w, 0), h };
  };
  const hatBox = (n, parts, cx, cy, col) => {
    const { cells, W, h } = hatSize(n, parts);
    const size = 25 * s;
    g.font = `800 ${size}px Helvetica, Arial, sans-serif`;
    let x = cx - W / 2; const y = cy - h / 2;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.3)'; g.shadowBlur = 6 * s;
    g.fillStyle = '#fff'; g.beginPath(); g.roundRect ? g.roundRect(x, y, W, h, 8 * s) : g.rect(x, y, W, h); g.fill();
    g.shadowBlur = 0;
    cells.forEach((c, k) => {
      if (k === 0) { g.fillStyle = col; g.beginPath(); g.roundRect ? g.roundRect(x, y, c.w, h, [8 * s, 0, 0, 8 * s]) : g.rect(x, y, c.w, h); g.fill(); }
      else { g.strokeStyle = 'rgba(0,0,0,0.15)'; g.lineWidth = 1.5 * s; g.beginPath(); g.moveTo(x, y + 4 * s); g.lineTo(x, y + h - 4 * s); g.stroke(); }
      g.fillStyle = k === 0 ? '#fff' : '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(c.t, x + c.w / 2, y + h / 2 + 1);
      x += c.w;
    });
    g.strokeStyle = col; g.lineWidth = 3 * s; g.beginPath(); g.roundRect ? g.roundRect(cx - W / 2, y, W, h, 8 * s) : g.rect(cx - W / 2, y, W, h); g.stroke();
    g.restore();
  };
  const labelSize = (text, size = 22) => { g.font = `700 ${size * s}px Helvetica, Arial, sans-serif`; return { w: g.measureText(text).width + 12 * s, h: size * s * 1.35 }; };

  // Labels are placed after every track is drawn, so none covers a waypoint, another label or a HAT:
  // each one tries several spots and takes the free one (or the least crowded).
  const placed = [];   // boxes already used {x, y, w, h}
  const circles = [];  // waypoint rings {x, y, r}
  const segs = [];     // track segments [A, B]
  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const segHits = (bx, A, B) => { // does segment AB cross box bx? (sampled)
    for (let t = 0; t <= 1; t += 0.05) { const x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t; if (x > bx.x && x < bx.x + bx.w && y > bx.y && y < bx.y + bx.h) return true; }
    return false;
  };
  const cost = (bx, ownSegs = []) => {
    let c = 0;
    for (const o of placed) c += overlap(bx, o) * 40;
    for (const ci of circles) { const r = ci.r * 1.3; c += overlap(bx, { x: ci.x - r, y: ci.y - r, w: 2 * r, h: 2 * r }) * 40; }
    for (const sg of segs) if (!ownSegs.includes(sg) && segHits(bx, sg[0], sg[1])) c += 1500 * s * s;
    for (const sg of ownSegs) if (segHits(bx, sg[0], sg[1])) c += 600 * s * s;
    if (bx.x < 0 || bx.y < 0 || bx.x + bx.w > width || bx.y + bx.h > height) c += 1e7;
    return c;
  };
  const best = (cands, ownSegs) => {
    let pick = null;
    for (const cd of cands) { const c = cost(cd.box, ownSegs) + (cd.pen || 0); if (!pick || c < pick.c) pick = { ...cd, c }; if (c === 0 && !cd.pen) break; }
    return pick;
  };

  const jobs2 = [];
  for (const r of routes) {
    const col = r.color;
    const wp = r.wps.map(P);
    // track
    const path = () => { g.beginPath(); wp.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); };
    halo(path, 11 * s);
    g.save(); g.strokeStyle = col; g.lineWidth = 5 * s; g.lineJoin = 'round'; g.setLineDash(r.alt ? [22 * s, 12 * s] : []); path(); g.stroke(); g.restore();
    const legSegs = [];
    for (let i = 1; i < wp.length; i++) { const sg = [wp[i - 1], wp[i]]; segs.push(sg); legSegs.push(sg); }
    // ticks, TOC/TOD bars per leg (labels later)
    for (let i = 1; i < wp.length; i++) {
      const A = wp[i - 1], B = wp[i];
      const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
      const legRows = r.rows.filter((x) => x.legIndex === i);
      const legDist = legRows.reduce((t, x) => t + x.dist, 0) || 1;
      let done = 0;
      const at = (f) => ({ x: A.x + dx * f, y: A.y + dy * f });
      const bar = (p, len, w, color) => { halo(() => { g.beginPath(); g.moveTo(p.x - nx * len, p.y - ny * len); g.lineTo(p.x + nx * len, p.y + ny * len); }, w + 5 * s); g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(p.x - nx * len, p.y - ny * len); g.lineTo(p.x + nx * len, p.y + ny * len); g.stroke(); };
      for (const row of legRows) {
        const f0 = done / legDist, f1 = (done + row.dist) / legDist;
        if (row.gs > 0 && !row.fixedMin) {
          const step = (row.gs / 60) * 2; // NM flown in 2 minutes
          for (let d = step; d < row.dist - 0.2; d += step) {
            // amber with a dark edge so the marks stand out from the pink/blue track
            const q = at(f0 + (d / row.dist) * (f1 - f0)), len = 15 * s;
            g.save(); g.lineCap = 'round';
            for (const [w, c2] of [[10 * s, '#1a1a1a'], [5.5 * s, '#ffb000']]) { g.strokeStyle = c2; g.lineWidth = w; g.beginPath(); g.moveTo(q.x - nx * len, q.y - ny * len); g.lineTo(q.x + nx * len, q.y + ny * len); g.stroke(); }
            g.restore();
          }
        }
        if (row.auto && (row.to === 'TOC' || row.to === 'TOD')) {
          const p = at(f1);
          bar(p, 24 * s, 7 * s, '#111');
          jobs2.push({ kind: 'toc', text: `${row.to} ${row.to === 'TOC' ? '^' : 'v'}`, p, nx, ny, own: [[A, B]], leg: legSegs[i - 1] });
        }
        done += row.dist;
      }
      const last = legRows[legRows.length - 1];
      if (last) {
        const ete = legRows.reduce((t, x) => t + x.eteSec, 0);
        jobs2.push({ kind: 'hat', n: `${r.alt ? 'A' : ''}${i}`, parts: [`${pad3(last.mh)}°`, `${last.altDisp || ''}`, mmss(ete)], A, B, nx, ny, L, col, leg: legSegs[i - 1] });
      }
    }
    // circled waypoints (names later)
    r.wps.forEach((w, i) => {
      const p = wp[i];
      g.save(); g.lineWidth = 9 * s; g.strokeStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.arc(p.x, p.y, 20 * s, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 4.5 * s; g.strokeStyle = col; g.beginPath(); g.arc(p.x, p.y, 20 * s, 0, Math.PI * 2); g.stroke(); g.restore();
      circles.push({ x: p.x, y: p.y, r: 20 * s });
      if (r.alt && i === 0) return; // the alternate starts at the destination, already named
      jobs2.push({ kind: 'name', text: w.name, p, own: legSegs.filter((sg) => sg[0] === p || sg[1] === p) });
    });
  }

  // 1) waypoint names: around the ring, first free spot
  const namedAt = [];
  for (const j of jobs2.filter((x) => x.kind === 'name')) {
    if (namedAt.some((q) => q.text === j.text && Math.hypot(q.p.x - j.p.x, q.p.y - j.p.y) < 30 * s)) continue; // a round trip ends where it started
    namedAt.push(j);
    const { w, h } = labelSize(j.text, 22), d = 26 * s, p = j.p;
    const spots = [[d, -d - h], [d, d], [-d - w, -d - h], [-d - w, d], [d + 4 * s, -h / 2], [-d - w - 4 * s, -h / 2], [-w / 2, -d - h - 6 * s], [-w / 2, d + 6 * s]];
    const pick = best(spots.map(([ox, oy], k) => ({ box: { x: p.x + ox, y: p.y + oy, w, h }, pen: k * 50 * s })), j.own);
    placed.push(pick.box);
    label(j.text, pick.box.x + w / 2, pick.box.y + h / 2, { size: 22 });
  }
  // 2) HATs: along their leg, either side, nearer or further; a thin leader line when moved off the leg
  for (const j of jobs2.filter((x) => x.kind === 'hat')) {
    const { W, h } = hatSize(j.n, j.parts);
    const cands = [];
    for (const f of [0.5, 0.38, 0.62, 0.28, 0.72, 0.18, 0.82]) for (const side of [-1, 1]) for (const off of [52, 95, 145]) {
      const cx = j.A.x + (j.B.x - j.A.x) * f + side * j.nx * off * s, cy = j.A.y + (j.B.y - j.A.y) * f + side * j.ny * off * s;
      cands.push({ box: { x: cx - W / 2, y: cy - h / 2, w: W, h }, cx, cy, f, pen: (Math.abs(f - 0.5) * 300 + (off - 52) * 4 + (side === 1 ? 20 : 0)) * s * s * 10 });
    }
    const pick = best(cands, [j.leg]);
    placed.push(pick.box);
    const mx = j.A.x + (j.B.x - j.A.x) * pick.f, my = j.A.y + (j.B.y - j.A.y) * pick.f;
    if (Math.hypot(pick.cx - mx, pick.cy - my) > 70 * s) { g.save(); g.strokeStyle = j.col; g.lineWidth = 2.5 * s; g.setLineDash([6 * s, 5 * s]); g.beginPath(); g.moveTo(mx, my); g.lineTo(pick.cx, pick.cy); g.stroke(); g.restore(); }
    hatBox(j.n, j.parts, pick.cx, pick.cy, j.col);
  }
  // 3) TOC / TOD labels next to their bar
  for (const j of jobs2.filter((x) => x.kind === 'toc')) {
    const { w, h } = labelSize(j.text, 19);
    const cands = [46, 80, -46, -80].map((o, k) => { const cx = j.p.x + j.nx * o * s, cy = j.p.y + j.ny * o * s; return { box: { x: cx - w / 2, y: cy - h / 2, w, h }, cx, cy, pen: k * 30 * s }; });
    const pick = best(cands, j.own);
    placed.push(pick.box);
    label(j.text, pick.cx, pick.cy, { size: 19 });
  }

  // scale bar (NM) and north
  const nm = [5, 10, 20, 25, 50].find((v) => v * pxPerNm > 180 * s) || 50;
  const bx = 40 * s, by = height - 40 * s, bw = nm * pxPerNm;
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(bx - 10 * s, by - 34 * s, bw + 110 * s, 48 * s);
  g.strokeStyle = '#111'; g.lineWidth = 4 * s; g.beginPath(); g.moveTo(bx, by - 8 * s); g.lineTo(bx, by); g.lineTo(bx + bw, by); g.lineTo(bx + bw, by - 8 * s); g.stroke();
  g.fillStyle = '#111'; g.font = `700 ${20 * s}px Helvetica, Arial, sans-serif`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText(`${nm} NM`, bx + bw + 12 * s, by);
  g.fillText('N ^', width - 90 * s, 50 * s);
  if (title) { g.font = `700 ${22 * s}px Helvetica, Arial, sans-serif`; const tw = g.measureText(title).width; g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(30 * s, 24 * s, tw + 24 * s, 40 * s); g.fillStyle = '#111'; g.fillText(title, 42 * s, 52 * s); }
  g.font = `500 ${15 * s}px Helvetica, Arial, sans-serif`; g.fillStyle = 'rgba(0,0,0,0.7)'; g.textAlign = 'right';
  g.fillText(aviation ? 'Navlog chart: terrain SRTM · OpenStreetMap · airspace ENAIRE AIP (not to scale when printed) · check the official chart' : 'Chart: AIP España · ENAIRE 1:500 000 (not to scale when printed) · check the current edition', width - 30 * s, height - 18 * s);

  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.86));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height, zoom: z, pxPerNm };
}

/** Adds the map as an A4 landscape page. */
export async function addMapPage(doc, img, caption) {
  const page = doc.addPage([841.89, 595.28]);
  const jpg = await doc.embedJpg(img.bytes);
  const W = 841.89 - 40, H = 595.28 - 56;
  const k = Math.min(W / img.width, H / img.height);
  page.drawImage(jpg, { x: (841.89 - img.width * k) / 2, y: 20, width: img.width * k, height: img.height * k });
  const { StandardFonts, rgb } = window.PDFLib;
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText(caption, { x: 20, y: 595.28 - 26, size: 11, font, color: rgb(0.1, 0.1, 0.12) });
}
