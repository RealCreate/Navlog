// Vertical profile along the route (SkyDemon-style): planned altitude vs terrain.
// Terrain: open elevation tiles (Terrarium encoding, SRTM-based, AWS Open Data),
// sampled on the track and 2 NM either side. Obstacles (wind turbines, masts) are NOT
// included — check the chart: SOP minimum is 1000 ft above the highest obstacle
// (2000 ft over mountainous areas).

const TERRAIN_Z = 10;
const TILE_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const M_TO_FT = 3.28084;
const tileCache = new Map();

function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return { x, y };
}

async function loadTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (!tileCache.has(key)) {
    tileCache.set(key, (async () => {
      const res = await fetch(TILE_URL(z, x, y), { mode: 'cors' });
      if (!res.ok) throw new Error('terrain tile ' + res.status);
      const bmp = await createImageBitmap(await res.blob());
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height);
    })().catch((e) => { tileCache.delete(key); throw e; }));
  }
  return tileCache.get(key);
}

async function elevationFt(lat, lon) {
  const t = lonLatToTile(lon, lat, TERRAIN_Z);
  const tx = Math.floor(t.x), ty = Math.floor(t.y);
  const img = await loadTile(TERRAIN_Z, tx, ty);
  const px = Math.min(255, Math.floor((t.x - tx) * 256));
  const py = Math.min(255, Math.floor((t.y - ty) * 256));
  const i = (py * 256 + px) * 4;
  const m = img.data[i] * 256 + img.data[i + 1] + img.data[i + 2] / 256 - 32768;
  return Math.max(0, m * M_TO_FT);
}

// Offset a point by (east, north) nautical miles.
function offset(p, eNm, nNm) {
  return { lat: p.lat + nNm / 60, lon: p.lon + eNm / (60 * Math.cos((p.lat * Math.PI) / 180)) };
}

/**
 * Samples terrain along the waypoints. Returns [{d, centre, corridor}] with d in NM.
 */
export async function sampleTerrain(wps, distances, stepNm = 0.5, corridorNm = 2) {
  const out = [];
  let d0 = 0;
  for (let i = 1; i < wps.length; i++) {
    const a = wps[i - 1], b = wps[i], len = distances[i - 1];
    if (!len) continue;
    // unit vectors (local flat approximation)
    const dn = (b.lat - a.lat) * 60, de = (b.lon - a.lon) * 60 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
    const L = Math.hypot(dn, de) || 1;
    const ux = de / L, uy = dn / L; // along track (east, north)
    const n = Math.max(1, Math.ceil(len / stepNm));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const f = k / n;
      const p = { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
      const pts = [p];
      for (const s of [-corridorNm, -corridorNm / 2, corridorNm / 2, corridorNm]) pts.push(offset(p, -uy * s, ux * s));
      const el = await Promise.all(pts.map((q) => elevationFt(q.lat, q.lon)));
      out.push({ d: d0 + len * f, centre: el[0], corridor: Math.max(...el) });
    }
    d0 += len;
  }
  return out;
}

/** Planned altitude profile from navlog rows (departure climb-out and arrival descent included). */
export function plannedProfile(rows, depElev, destElev) {
  const pts = [];
  let d = 0;
  let alt = depElev ?? rows[0]?.alt ?? 0;
  pts.push({ d, alt, label: rows[0]?.from });
  rows.forEach((r) => {
    const target = r.phase === 'arr' && destElev != null ? destElev : (r.alt ?? alt);
    if (r.phase === 'cruise' && target !== alt) pts.push({ d, alt: target });
    d += r.dist; alt = target;
    pts.push({ d, alt, label: r.to, auto: r.auto });
  });
  return pts;
}

/**
 * Draws the profile. opts: { planned, terrain, color, dark }
 * Returns { maxTerrain, minClearance }.
 */
export function drawProfile(canvas, { planned, terrain, color = '#d1009a' }) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return null;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const ink = dark ? 'rgba(235,235,245,0.62)' : 'rgba(60,60,67,0.62)';
  const grid = dark ? 'rgba(235,235,245,0.10)' : 'rgba(60,60,67,0.10)';
  const font = '600 10.5px -apple-system, system-ui, sans-serif';

  if (!planned || planned.length < 2) {
    ctx.fillStyle = ink; ctx.font = '500 13px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Add waypoints to see the vertical profile', w / 2, h / 2);
    return null;
  }

  const totalD = planned[planned.length - 1].d || 1;
  const maxTerr = terrain && terrain.length ? Math.max(...terrain.map((t) => t.corridor)) : 0;
  const maxAlt = Math.max(maxTerr, ...planned.map((p) => p.alt));
  const top = Math.ceil((maxAlt + 1500) / 1000) * 1000;
  const padL = 36, padR = 12, padT = 18, padB = 18;
  const X = (d) => padL + (d / totalD) * (w - padL - padR);
  const Y = (a) => padT + (1 - a / top) * (h - padT - padB);

  // grid + altitude labels
  ctx.font = font; ctx.fillStyle = ink; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const plotH = h - padT - padB;
  const stepA = [1000, 2000, 2500, 5000].find((st) => (plotH / (top / st)) >= 16) || 5000;
  for (let a = 0; a <= top; a += stepA) {
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, Y(a)); ctx.lineTo(w - padR, Y(a)); ctx.stroke();
    ctx.fillText(a ? `${a / 1000}k` : '0', padL - 6, Y(a));
  }

  // terrain: corridor (light) and track (solid)
  if (terrain && terrain.length) {
    const area = (key, fill) => {
      ctx.beginPath(); ctx.moveTo(X(terrain[0].d), Y(0));
      terrain.forEach((t) => ctx.lineTo(X(t.d), Y(t[key])));
      ctx.lineTo(X(terrain[terrain.length - 1].d), Y(0)); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
    };
    area('corridor', dark ? 'rgba(160,130,95,0.35)' : 'rgba(170,140,100,0.30)');
    const g = ctx.createLinearGradient(0, Y(maxTerr || 1), 0, Y(0));
    g.addColorStop(0, dark ? '#8a6f4f' : '#b08d63');
    g.addColorStop(1, dark ? '#4d4033' : '#d9c7a8');
    area('centre', g);
  }

  // planned altitude
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = dark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.9)'; ctx.lineWidth = 6;
  ctx.beginPath(); planned.forEach((p, i) => (i ? ctx.lineTo(X(p.d), Y(p.alt)) : ctx.moveTo(X(p.d), Y(p.alt)))); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = 3;
  ctx.beginPath(); planned.forEach((p, i) => (i ? ctx.lineTo(X(p.d), Y(p.alt)) : ctx.moveTo(X(p.d), Y(p.alt)))); ctx.stroke();

  // clearance check (SOP: 1000 ft above highest obstacle / 2000 ft mountainous)
  let minClear = Infinity, minAt = null;
  if (terrain && terrain.length) {
    const altAt = (d) => {
      for (let i = 1; i < planned.length; i++) {
        const a = planned[i - 1], b = planned[i];
        if (d <= b.d + 1e-6) return b.d === a.d ? b.alt : a.alt + ((d - a.d) / (b.d - a.d)) * (b.alt - a.alt);
      }
      return planned[planned.length - 1].alt;
    };
    // ignore the first/last 3 NM (departure/arrival)
    terrain.forEach((t) => {
      if (t.d < 3 || t.d > totalD - 3) return;
      const c = altAt(t.d) - t.corridor;
      if (c < minClear) { minClear = c; minAt = t; }
    });
    if (minAt && minClear < 1000) {
      ctx.fillStyle = '#ff3b30';
      ctx.beginPath(); ctx.arc(X(minAt.d), Y(minAt.corridor), 4, 0, Math.PI * 2); ctx.fill();
    }
  }

  // waypoint ticks and names
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  let lastX = -Infinity;
  planned.forEach((p) => {
    if (!p.label) return;
    const x = X(p.d);
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, padT - 4); ctx.lineTo(x, h - padB); ctx.stroke();
    ctx.fillStyle = p.auto ? ink : (dark ? '#f5f5f7' : '#111');
    const label = p.label.length > 14 ? p.label.slice(0, 13) + '…' : p.label;
    const tw = ctx.measureText(label).width;
    if (x - tw / 2 > lastX + 4) { ctx.fillText(label, Math.min(Math.max(x, padL + tw / 2), w - padR - tw / 2), padT - 8); lastX = x + tw / 2; }
    ctx.beginPath(); ctx.fillStyle = color; ctx.arc(x, Y(p.alt), 3.5, 0, Math.PI * 2); ctx.fill();
  });
  // distance axis
  ctx.fillStyle = ink; ctx.textBaseline = 'top';
  const stepD = totalD > 120 ? 20 : totalD > 50 ? 10 : 5;
  for (let d = 0; d <= totalD; d += stepD) ctx.fillText(`${d}`, X(d), h - padB + 6);
  ctx.textAlign = 'right'; ctx.fillText('NM', w - padR, h - padB + 6);

  return { maxTerrain: Math.round(maxTerr), minClearance: Number.isFinite(minClear) ? Math.round(minClear) : null };
}
