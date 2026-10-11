// Winds aloft for each leg from the free Open-Meteo forecast API (ECMWF/ICON models,
// the same kind of model output Windy shows). Wind is taken at the leg's planned altitude
// (interpolated between pressure levels) and at the time the aircraft is expected there.
// The SOP's approved sources are windy.com and AEMET: the app marks these winds
// "check on Windy" so the student confirms them before the briefing.

const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600];
const API = 'https://api.open-meteo.com/v1/forecast';

const rad = (d) => (d * Math.PI) / 180;

/**
 * points: [{ lat, lon, altFt, time: Date }] — one per leg (leg midpoint).
 * Returns [{ dir, spd } | null] in the same order (true direction the wind blows FROM, knots).
 */
export async function fetchWinds(points) {
  if (!points.length) return [];
  const hourly = LEVELS.flatMap((l) => [`wind_speed_${l}hPa`, `wind_direction_${l}hPa`, `geopotential_height_${l}hPa`]);
  const times = points.map((p) => p.time.getTime());
  const start = new Date(Math.min(...times) - 3600e3), end = new Date(Math.max(...times) + 3600e3);
  const iso = (d) => d.toISOString().slice(0, 13) + ':00';
  const url = `${API}?latitude=${points.map((p) => p.lat.toFixed(3)).join(',')}&longitude=${points.map((p) => p.lon.toFixed(3)).join(',')}`
    + `&hourly=${hourly.join(',')}&wind_speed_unit=kn&timezone=GMT&start_hour=${iso(start)}&end_hour=${iso(end)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`forecast ${res.status}`);
  let data = await res.json();
  if (!Array.isArray(data)) data = [data];
  return points.map((p, i) => windAt(data[i], p));
}

function windAt(d, p) {
  if (!d || !d.hourly) return null;
  const h = d.hourly;
  // nearest forecast hour
  const target = p.time.getTime();
  let k = 0, best = Infinity;
  h.time.forEach((t, j) => { const dt = Math.abs(Date.parse(t + 'Z') - target); if (dt < best) { best = dt; k = j; } });
  const altM = p.altFt * 0.3048;
  const lv = LEVELS.map((l) => ({
    z: h[`geopotential_height_${l}hPa`]?.[k], s: h[`wind_speed_${l}hPa`]?.[k], dir: h[`wind_direction_${l}hPa`]?.[k],
  })).filter((x) => x.z != null && x.s != null && x.dir != null).sort((a, b) => a.z - b.z);
  if (!lv.length) return null;
  let lo = lv[0], hi = lv[lv.length - 1];
  for (let i = 1; i < lv.length; i++) if (lv[i].z >= altM) { lo = lv[i - 1]; hi = lv[i]; break; }
  const f = hi.z === lo.z ? 0 : Math.min(1, Math.max(0, (altM - lo.z) / (hi.z - lo.z)));
  // interpolate wind vectors (u, v) so directions near 360/000 blend correctly
  const vec = (x) => [x.s * Math.sin(rad(x.dir)), x.s * Math.cos(rad(x.dir))];
  const [u1, v1] = vec(lo), [u2, v2] = vec(hi);
  const u = u1 + (u2 - u1) * f, v = v1 + (v2 - v1) * f;
  const spd = Math.round(Math.hypot(u, v));
  let dir = Math.round(((Math.atan2(u, v) * 180) / Math.PI + 360) % 360);
  dir = Math.round(dir / 10) * 10 % 360 || 360; // forecasts are given to the nearest 10°
  return { dir: spd === 0 ? 0 : dir, spd };
}
