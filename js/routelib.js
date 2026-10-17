// Route library: builds a VFR route between two aerodromes the way students plan them —
// leave by a published reporting point, fly between clear landmarks (towns), join the destination
// by one of its reporting points — with no leg longer than the school limit (20 NM).
// Pure functions: the app feeds in the reporting points, towns and airspaces.

export const MAX_LEG_NM = 20;
const NM_PER_DEG = 60;

export function nm(a, b) {
  const k = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot((b.lat - a.lat) * NM_PER_DEG, (b.lon - a.lon) * NM_PER_DEG * k);
}

// distance from p to the segment ab (NM)
function toSeg(p, a, b) {
  const k = Math.cos(a.lat * Math.PI / 180);
  const ax = a.lon * k, ay = a.lat, bx = b.lon * k, by = b.lat, px = p.lon * k, py = p.lat;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1e-12;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) * NM_PER_DEG;
}

function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if ((yi > p.lat) !== (yj > p.lat) && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}
function segsCross(a, b, c, d) {
  const o = (p, q, r) => (q.lon - p.lon) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lon - p.lon);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
/** Does segment ab enter area (rings of [lat, lon])? */
export function crossesArea(a, b, area) {
  const bb = area.bb;
  if (Math.max(a.lat, b.lat) < bb.s || Math.min(a.lat, b.lat) > bb.n || Math.max(a.lon, b.lon) < bb.w || Math.min(a.lon, b.lon) > bb.e) return false;
  for (const r of area.rings) {
    if (inRing(a, r) || inRing(b, r) || inRing({ lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 }, r)) return true;
    for (let i = 1; i < r.length; i++) if (segsCross(a, b, { lat: r[i - 1][0], lon: r[i - 1][1] }, { lat: r[i][0], lon: r[i][1] })) return true;
  }
  return false;
}

/**
 * Areas a VFR route should keep out of, with a cost for entering each:
 * prohibited / restricted / danger / temporary areas reaching below 7000 ft, and the CTR / ATZ of
 * aerodromes other than the ones being flown from and to.
 */
export function avoidAreas(airspaces, keepAds) {
  const out = [];
  for (const a of airspaces || []) {
    if (!a.rings || !a.rings.length) continue;
    const low = a.lowerFt == null || a.lowerFt < 7000;
    let cost = 0;
    if (/^(P|R|Prohibido_Sobrevuelo|PROHIBIDO VFR)$/.test(a.type) && low) cost = 400;
    else if (/^(D|TSA|TRA)$/.test(a.type) && low) cost = 150;
    else if (/^(CTR|ATZ)$/.test(a.type)) cost = 80;
    if (!cost) continue;
    if (cost === 80 && keepAds.some((p) => a.rings.some((r) => inRing(p, r)))) continue; // our own aerodromes' zones
    let s = 90, n = -90, w = 180, e = -180;
    for (const r of a.rings) for (const [la, lo] of r) { if (la < s) s = la; if (la > n) n = la; if (lo < w) w = lo; if (lo > e) e = lo; }
    out.push({ rings: a.rings, bb: { s, n, w, e }, cost, name: a.id || a.name || a.type });
  }
  return out;
}

// ENAIRE grid minimum altitude (hundreds of ft) at p, or null
function amaAt(ama, p) {
  for (const c of ama || []) if (p.lat >= c.s && p.lat < c.n && p.lon >= c.w && p.lon < c.e) return c.v;
  return null;
}

/**
 * Best way out of `from` and into `to`: one search over every published exit and entry point and the
 * towns between them (cities and towns, thinned to one per ~2.5 NM), every leg ≤ maxLeg NM.
 * exits / entries: [{ id, lat, lon, cost }] — cost is the distance flown inside the procedure.
 * Prefers fewer, longer legs, cities, low ground (ENAIRE grid altitudes) and keeping out of the
 * restricted areas and other aerodromes' zones. Returns { exit, entry, points: [{name, lat, lon}] } or null.
 */
export function bestRoute(exits, entries, towns, areas, ama, maxLeg = MAX_LEG_NM - 0.5) {
  if (!exits.length || !entries.length) return null;
  const cx = exits.reduce((t, x) => t + x.lat, 0) / exits.length, cy = exits.reduce((t, x) => t + x.lon, 0) / exits.length;
  const ex = entries.reduce((t, x) => t + x.lat, 0) / entries.length, ey = entries.reduce((t, x) => t + x.lon, 0) / entries.length;
  const A = { lat: cx, lon: cy }, B = { lat: ex, lon: ey };
  const width = Math.max(12, nm(A, B) * 0.35);
  // towns in the corridor, thinned on a grid (the bigger place wins each cell)
  const cell = new Map(), k = Math.cos(A.lat * Math.PI / 180);
  for (const [name, lat, lon, rank] of towns) {
    if (rank > 1) continue;
    const p = { name, lat, lon, rank };
    if (toSeg(p, A, B) > width) continue;
    const key = `${Math.floor(lat * 60 / 2.5)}:${Math.floor(lon * 60 * k / 2.5)}`;
    const cur = cell.get(key);
    if (!cur || p.rank < cur.rank) cell.set(key, p);
  }
  const nodes = [
    ...exits.map((x) => ({ ...x, kind: 'exit' })),
    ...[...cell.values()].filter((p) => exits.every((x) => nm(p, x) > 3) && entries.every((y) => nm(p, y) > 3)),
    ...entries.map((y) => ({ ...y, kind: 'entry' })),
  ];
  const n = nodes.length;
  const terrain = (a, b) => { // extra cost for flying over high ground
    const d = nm(a, b), steps = Math.max(1, Math.round(d / 2)); let c = 0;
    for (let i = 0; i < steps; i++) { const f = (i + 0.5) / steps; const v = amaAt(ama, { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f }); if (v != null) c += (d / steps) * Math.max(0, v - 60) * 0.06; }
    return c;
  };
  const edgeCost = (a, b) => {
    const d = nm(a, b);
    if (d > maxLeg || a.kind === 'entry' || b.kind === 'exit') return Infinity;
    let c = d + 4;
    if (d < 6) c += 8;
    if (b.rank === 1) c += 1;
    c += terrain(a, b);
    for (const ar of areas) if (crossesArea(a, b, ar)) c += ar.cost;
    return c;
  };
  // Dijkstra from every exit at once (start cost = its procedure distance)
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  nodes.forEach((x, i) => { if (x.kind === 'exit') dist[i] = x.cost || 0; });
  let bestEnd = -1, bestTotal = Infinity;
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0 || best >= bestTotal) break;
    done[u] = 1;
    if (nodes[u].kind === 'entry') { const t = dist[u] + (nodes[u].cost || 0); if (t < bestTotal) { bestTotal = t; bestEnd = u; } continue; }
    for (let v = 0; v < n; v++) {
      if (done[v] || nm(nodes[u], nodes[v]) > maxLeg) continue;
      const c = edgeCost(nodes[u], nodes[v]);
      if (dist[u] + c < dist[v]) { dist[v] = dist[u] + c; prev[v] = u; }
    }
  }
  if (bestEnd < 0) return null;
  const path = [];
  let i = prev[bestEnd];
  for (; i >= 0 && nodes[i].kind !== 'exit'; i = prev[i]) path.unshift(nodes[i]);
  if (i < 0) return null;
  return { exit: nodes[i].id, entry: nodes[bestEnd].id, points: path.map(({ name, lat, lon }) => ({ name, lat, lon })), total: bestTotal };
}
