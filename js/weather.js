// METAR / TAF from aviationweather.gov (NOAA, free, worldwide) and the school's dispatch
// limits (Phase 3 manual + aircraft SOP, e.g. SOP2518 P2008):
//              with FI                  solo
//   Visibility 5000 m                   7000 m
//   Ceiling    1500 ft (BKN/OVC)        2500 ft (BKN/OVC)
//   Max temp   ≥35 °C FI discretion     ≥35 °C
//   Crosswind  per aircraft SOP (P2008: 15 kt FI / 10 kt solo)
// TAF must be at or above minima from 1 h before to 1 h after the time over the aerodrome.
// CB forecast → the HT or CFI must be informed.

const API = 'https://aviationweather.gov/api/data';
const SM_TO_M = 1609.34;

export const MINIMA = {
  fi: { vis: 5000, ceil: 1500, temp: 35 },
  solo: { vis: 7000, ceil: 2500, temp: 35 },
};

// Runway magnetic directions (designator × 10) for the school's aerodromes.
export const RUNWAYS = {
  LEBG: [40, 220], LERJ: [110, 290], LEVT: [40, 220], LEVD: [50, 230], LELN: [50, 230],
  LEPP: [150, 330], LESO: [40, 220], LEHC: [120, 300], LEXJ: [110, 290], LESA: [30, 210], LEBB: [120, 300, 100, 280],
};

const cache = new Map();
async function getJson(kind, ids) {
  const key = kind + ids.join(',');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 10 * 60e3) return hit.v;
  const url = `${API}/${kind}?ids=${ids.join(',')}&format=json${kind === 'metar' ? '&hours=3' : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${kind} ${res.status}`);
  const text = await res.text();
  const v = text.trim() ? JSON.parse(text) : [];
  cache.set(key, { t: Date.now(), v });
  return v;
}

export async function fetchWeather(icaos) {
  const ids = [...new Set(icaos.filter(Boolean))];
  if (!ids.length) return {};
  const [metars, tafs] = await Promise.all([getJson('metar', ids).catch(() => null), getJson('taf', ids).catch(() => null)]);
  if (metars === null && tafs === null) throw new Error('Weather service unreachable');
  const out = {};
  for (const id of ids) out[id] = { metar: null, taf: null };
  for (const m of metars || []) {
    const id = m.icaoId; if (!out[id]) continue;
    if (!out[id].metar || (m.obsTime || 0) > (out[id].metar.obsTime || 0)) out[id].metar = m;
  }
  for (const t of tafs || []) { const id = t.icaoId; if (out[id] && !out[id].taf) out[id].taf = t; }
  return out;
}

const visM = (v) => {
  if (v == null) return null;
  const s = String(v);
  if (s.includes('+')) return 10000;
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * SM_TO_M) : null;
};
const ceilingFt = (clouds) => {
  const c = (clouds || []).filter((x) => /BKN|OVC|VV/.test(x.cover) && x.base != null).map((x) => x.base);
  return c.length ? Math.min(...c) : null;
};
const hasCb = (o) => (o.clouds || []).some((c) => /CB/.test(c.type || '')) || /\bCB\b|TS/.test(o.rawOb || o.rawTAF || o.wxString || '');

function crosswind(ad, wdir, wspd, gust) {
  const rw = RUNWAYS[ad];
  if (!rw || wdir == null || wdir === 'VRB' || !wspd) return null;
  const s = Math.max(wspd, gust || 0);
  let best = null;
  for (const r of rw) {
    const ang = ((+wdir - r) * Math.PI) / 180;
    const xw = Math.abs(Math.round(s * Math.sin(ang)));
    const hw = Math.round(s * Math.cos(ang));
    if (!best || xw < best.xw || (xw === best.xw && hw > best.hw)) best = { rwy: String(r / 10).padStart(2, '0'), xw, hw };
  }
  return best;
}

/**
 * Checks an aerodrome against the school minima for a time window [from, to].
 * Returns { metar, taf, issues: [{level:'bad'|'warn'|'info', text}] }.
 */
export function assess(ad, wx, from, to, { solo = false, xwLimit = null } = {}) {
  const lim = solo ? MINIMA.solo : MINIMA.fi;
  const issues = [];
  const who = solo ? 'solo' : 'with FI';
  const check = (o, label) => {
    const v = visM(o.visib), c = ceilingFt(o.clouds);
    if (v != null && v < lim.vis) issues.push({ level: 'bad', text: `${ad} ${label}: visibility ${v >= 10000 ? '10 km+' : `${v} m`} below ${lim.vis} m (${who})` });
    if (c != null && c < lim.ceil) issues.push({ level: 'bad', text: `${ad} ${label}: ceiling ${c} ft below ${lim.ceil} ft BKN/OVC (${who})` });
    if (hasCb(o)) issues.push({ level: 'warn', text: `${ad} ${label}: CB / thunderstorm — inform the HT or CFI (SOP)` });
    const xw = crosswind(ad, o.wdir, o.wspd, o.wgst);
    if (xw && xwLimit && xw.xw > xwLimit) issues.push({ level: 'bad', text: `${ad} ${label}: crosswind ${xw.xw} kt on RWY ${xw.rwy} above the ${xwLimit} kt limit (${who})` });
    if (xw && xw.hw < -5) issues.push({ level: 'warn', text: `${ad} ${label}: ${-xw.hw} kt tailwind on the best runway (${xw.rwy})` });
    return xw;
  };
  let metarXw = null;
  // A METAR describes now: only use it when the time there is within 2 h; otherwise the TAF decides.
  const near = Math.abs(from.getTime() - Date.now()) < 2 * 3600e3;
  if (wx?.metar && near) {
    metarXw = check(wx.metar, 'METAR');
    if (wx.metar.temp != null && wx.metar.temp >= lim.temp) issues.push({ level: solo ? 'bad' : 'warn', text: `${ad}: ${wx.metar.temp} °C — ${solo ? 'solo limit ≥35 °C' : '≥35 °C at FI discretion'}` });
  }
  if (wx?.taf && Array.isArray(wx.taf.fcsts)) {
    const f0 = from.getTime() / 1000 - 3600, f1 = to.getTime() / 1000 + 3600;
    const covered = wx.taf.fcsts.filter((f) => f.timeTo > f0 && f.timeFrom < f1);
    if (!covered.length) issues.push({ level: 'warn', text: `${ad}: TAF does not cover ±1 h of your time there` });
    for (const f of covered) check(f, `TAF${f.fcstChange ? ' ' + f.fcstChange : ''} ${hhmm(f.timeFrom)}–${hhmm(f.timeTo)}`);
  } else if (wx) {
    issues.push({ level: 'info', text: `${ad}: no TAF published — check AEMET / METAR trend` });
  }
  // de-duplicate identical texts
  const seen = new Set();
  return { metar: wx?.metar || null, taf: wx?.taf || null, xw: metarXw, issues: issues.filter((i) => (seen.has(i.text) ? false : seen.add(i.text))) };
}

const hhmm = (s) => { const d = new Date(s * 1000); return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}Z`; };

export function metarSummary(m) {
  if (!m) return '';
  const v = visM(m.visib), c = ceilingFt(m.clouds);
  return [m.wdir != null ? `${m.wdir === 'VRB' ? 'VRB' : String(m.wdir).padStart(3, '0')}/${m.wspd}${m.wgst ? 'G' + m.wgst : ''} kt` : null,
    v != null ? (v >= 10000 ? '10 km+' : `${v} m`) : null,
    c != null ? `ceiling ${c} ft` : 'no ceiling', m.temp != null ? `${m.temp} °C` : null,
    m.altim != null ? `QNH ${Math.round(m.altim)}` : null].filter(Boolean).join(' · ');
}
