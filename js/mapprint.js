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

import { drawAirspaces, drawAmaGrid, drawLabels } from './aviation.js';

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
    const vis = (l) => { const [x, y] = PP(l.lat, l.lon); return x > -50 && y > -50 && x < width + 50 && y < height + 50; };
    drawLabels(g, aviation.labels.filter((l) => vis(l) && (l.kind !== 'edge' || l.edgePx10 * 2 ** (z - 10) * 2 > l.text.length * 13)), PP, k * 0.9, aviation.ama.filter((c) => vis({ lat: (c.n + c.s) / 2, lon: (c.w + c.e) / 2 })));
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
  const hatBox = (n, parts, cx, cy, col) => {
    const size = 25 * s, padX = 10 * s, h = size * 1.5;
    g.font = `800 ${size}px Helvetica, Arial, sans-serif`;
    const cells = [n, ...parts].map((t) => ({ t, w: g.measureText(t).width + 2 * padX }));
    const W = cells.reduce((t, c) => t + c.w, 0);
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

  for (const r of routes) {
    const col = r.color;
    const wp = r.wps.map(P);
    // track
    const path = () => { g.beginPath(); wp.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); };
    halo(path, 11 * s);
    g.save(); g.strokeStyle = col; g.lineWidth = 5 * s; g.lineJoin = 'round'; g.setLineDash(r.alt ? [22 * s, 12 * s] : []); path(); g.stroke(); g.restore();
    // ticks, TOC/TOD and HATs per leg
    for (let i = 1; i < wp.length; i++) {
      const A = wp[i - 1], B = wp[i];
      const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
      const legRows = r.rows.filter((x) => x.legIndex === i);
      const legDist = legRows.reduce((t, x) => t + x.dist, 0) || 1;
      let done = 0;
      const at = (f) => ({ x: A.x + dx * f, y: A.y + dy * f });
      const bar = (p, len, w, color) => { g.beginPath(); g.moveTo(p.x - nx * len, p.y - ny * len); g.lineTo(p.x + nx * len, p.y + ny * len); halo(() => { g.beginPath(); g.moveTo(p.x - nx * len, p.y - ny * len); g.lineTo(p.x + nx * len, p.y + ny * len); }, w + 5 * s); g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(p.x - nx * len, p.y - ny * len); g.lineTo(p.x + nx * len, p.y + ny * len); g.stroke(); };
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
          label(`${row.to} ${row.to === 'TOC' ? '^' : 'v'}`, p.x + nx * 46 * s, p.y + ny * 46 * s, { size: 19 });
        }
        done += row.dist;
      }
      const last = legRows[legRows.length - 1];
      if (last && L > 120 * s) {
        const ete = legRows.reduce((t, x) => t + x.eteSec, 0);
        const m = at(0.5), off = 52 * s;
        hatBox(`${r.alt ? 'A' : ''}${i}`, [`${pad3(last.mh)}°`, `${last.altDisp || ''}`, mmss(ete)], m.x - nx * off, m.y - ny * off, col);
      }
    }
    // circled waypoints with names
    r.wps.forEach((w, i) => {
      const p = wp[i];
      g.save(); g.lineWidth = 9 * s; g.strokeStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.arc(p.x, p.y, 20 * s, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 4.5 * s; g.strokeStyle = col; g.beginPath(); g.arc(p.x, p.y, 20 * s, 0, Math.PI * 2); g.stroke(); g.restore();
      if (r.alt && i === 0) return; // the alternate starts at the destination, already named
      label(w.name, p.x + 30 * s + g.measureText(w.name).width / 2, p.y - 30 * s, { size: 22 });
    });
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
