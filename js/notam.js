// ICARO NOTAM bulletin (the PDF saved from notampib.enaire.es). ICARO only works from Spain, so
// the student saves the bulletin and adds it here; the app reads it, keeps what is active for the
// flight and flags what matters. The bulletin itself stays the official document (its pages are
// added to the briefing PDF). Format (sample in test/fixtures): "Identifier: 3123651", then per
// aerodrome a MET block (METAR/TAF, if requested) and NOTAM entries
// "FROM dd/mm/yyyy hh:mm TO dd/mm/yyyy hh:mm [EST] … B8287/26" + text, then warnings,
// special areas activity and miscellaneous sections.

const NOTAM_START = /^\s*FROM\s+(\d\d\/\d\d\/\d{4}\s+\d\d:\d\d)\s+TO\s+(PERM|\d\d\/\d\d\/\d{4}\s+\d\d:\d\d)(\s+EST)?.*?\b([A-Z]\d{4}\/\d\d)\s*$/;
const SECTION = /^\s*(AERODROMES|WARNINGS AERODROMES|SPECIAL AREAS ACTIVITY|MISCELLANEOUS AERODROMES|ROUTE[A-Z ]*|OPERATIONAL[A-Z ]*|NAVIGATION WARNINGS[A-Z ]*|GPS[A-Z ]*)\s*$/;
const AD_HEADER = /^\s*(LE[A-Z]{2})\s+[A-ZÁÉÍÓÚÑ/ .-]{3,}\s*$/;
const AREA_HEADER = /^\s*([A-Z]{2,3}[A-Z0-9]{1,8})\s+-\s+(.+?)\s*(---\s*)?$/;
const FOOTER = /^\s*\d+\s*\/\s*\d+\s+\w+day\s+\d\d\/\d\d\/\d{4}/i;

const toDate = (s) => {
  const m = s && s.match(/(\d\d)\/(\d\d)\/(\d{4})\s+(\d\d):(\d\d)/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]) : null;
};

/** Parse the bulletin's text lines (as laid out on the page). */
export function parseBulletin(lines) {
  const out = { id: null, issued: null, ads: {}, areas: [], areaNotams: [], misc: {} };
  let section = 'AERODROMES', ad = null, block = null, cur = null, area = null, areaName = null;
  const flush = () => { cur = null; };
  for (let raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || /^\s*-{3}\s*$/.test(line) || FOOTER.test(line)) continue;
    const idm = line.match(/Identifier:\s*(\d+)/i);
    if (idm) { out.id = idm[1]; continue; }
    const iss = line.match(/(\w+day)\s+(\d\d\/\d\d\/\d{4}\s+\d\d:\d\d)\s+UTC/i);
    if (iss && !out.issued) out.issued = toDate(iss[2]);
    if (/End of Bulletin/i.test(line)) break;
    const sec = line.match(SECTION);
    if (sec) { section = sec[1].trim(); ad = null; block = null; flush(); continue; }
    const head = line.trim();
    if (head === 'MET' || head === 'NOTAM') { block = head; flush(); continue; }
    const adh = line.match(AD_HEADER);
    if (adh && !NOTAM_START.test(line) && !/^\s*(METAR|TAF|SPECI)\b/.test(line)) {
      ad = adh[1]; block = null; flush();
      const bucket = section === 'MISCELLANEOUS AERODROMES' ? out.misc : out.ads;
      bucket[ad] = bucket[ad] || { metar: '', taf: '', notams: [] };
      if (section === 'SPECIAL AREAS ACTIVITY') { areaName = head; ad = null; }
      continue;
    }
    if (section === 'SPECIAL AREAS ACTIVITY') {
      const ah = line.match(AREA_HEADER);
      if (ah && !NOTAM_START.test(line)) { area = { code: ah[1], name: ah[2].replace(/\s*---\s*$/, ''), periods: [] }; out.areas.push(area); flush(); continue; }
      const per = line.match(/WITH ACTIVITY PERIOD:\s*(.+?)\s*(---)?\s*(AIP|[A-Z]\d{4}\/\d\d)?\s*$/);
      const vl0 = line.match(/VERTICAL LIMITS:\s*LOWER:\s*(\d+)\s*UPPER:\s*(\d+)/);
      if (cur && !area && (per || vl0)) { if (per) cur.period = per[1].replace(/\s*---\s*$/, ''); if (vl0) cur.limits = `${vl0[1]}–${vl0[2]}`; continue; }
      if (per && area) { area.periods.push({ period: per[1].replace(/\s*---\s*$/, ''), src: per[3] || '' }); continue; }
      const vl = line.match(/VERTICAL LIMITS:\s*LOWER:\s*(\d+)\s*UPPER:\s*(\d+)/);
      if (vl && area && area.periods.length) { Object.assign(area.periods[area.periods.length - 1], { lower: +vl[1], upper: +vl[2] }); continue; }
      const n = line.match(NOTAM_START);
      if (n) { cur = { id: n[4], from: toDate(n[1]), to: n[2] === 'PERM' ? null : toDate(n[2]), est: !!n[3], text: '', area: areaName }; out.areaNotams.push(cur); continue; }
      if (/^\s{20,}\S/.test(line)) { areaName = head; area = null; cur = null; continue; }
      if (cur) cur.text += (cur.text ? '\n' : '') + head;
      continue;
    }
    if (!ad) continue;
    const bucket = section === 'MISCELLANEOUS AERODROMES' ? out.misc : section === 'AERODROMES' ? out.ads : null;
    if (!bucket) continue; // warnings section only points to the special areas chapter
    const rec = bucket[ad];
    if (block === 'MET' && section === 'AERODROMES') {
      if (/^\s*METAR\b/.test(line)) { rec.metar = head; cur = 'metar'; continue; }
      if (/^\s*TAF\b/.test(line)) { rec.taf = head; cur = 'taf'; continue; }
      if (/UNAVAILABLE/.test(line)) continue;
      if (cur === 'metar' || cur === 'taf') { rec[cur] += ' ' + head; continue; }
      continue;
    }
    const n = line.match(NOTAM_START);
    if (n) { cur = { id: n[4], from: toDate(n[1]), to: n[2] === 'PERM' ? null : toDate(n[2]), est: !!n[3], text: '' }; rec.notams.push(cur); continue; }
    if (cur && typeof cur === 'object' && head !== 'NIL') cur.text += (cur.text ? '\n' : '') + head;
  }
  return out;
}

/** Text lines of a PDF, grouped by row (pdf.js in the browser). */
export async function pdfLines(bytes) {
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5], x = it.transform[4];
      let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x, s: it.str, w: it.width });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      let s = '', end = 0;
      for (const it of r.items) {
        const gap = it.x - end;
        s += s ? (gap > 30 ? '      ' : gap > 1.5 ? ' ' : '') + it.s : ' '.repeat(Math.max(0, Math.round(it.x / 5))) + it.s;
        end = it.x + (it.w || 0);
      }
      lines.push(s);
    }
  }
  return lines;
}

/* ---------------- What matters for the flight ---------------- */

const COORD = /(\d{2})(\d{2})(\d{2}(?:\.\d+)?)([NS])\s*(\d{3})(\d{2})(\d{2}(?:\.\d+)?)([EW])/g;
export function coordsIn(text) {
  const pts = [];
  for (const m of String(text).matchAll(COORD)) {
    const lat = (+m[1] + +m[2] / 60 + +m[3] / 3600) * (m[4] === 'S' ? -1 : 1);
    const lon = (+m[5] + +m[6] / 60 + +m[7] / 3600) * (m[8] === 'W' ? -1 : 1);
    pts.push({ lat, lon });
  }
  return pts;
}
function nmToSegment(p, a, b) {
  const k = Math.cos((p.lat * Math.PI) / 180);
  const ax = (a.lon - p.lon) * 60 * k, ay = (a.lat - p.lat) * 60, bx = (b.lon - p.lon) * 60 * k, by = (b.lat - p.lat) * 60;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

const BAD = /\b(AD|AERODROME|RWY\s*[\d/LRC]*)\b[^.\n]*\bCLSD\b|\bAD CLOSED\b|CLOSED TO (ALL|VFR)|NOT AVBL FOR (VFR|TRAINING|GA)|TRAINING FLT NOT ALLOWED|VFR FLT NOT ALLOWED/i;
const WARN = /\bU\/S\b|NOT AVBL|\bCLSD\b|\bWIP\b|\bFOD\b|\bPPR\b|FUEL|AVGAS|\bCRANE\b|\bOBST\b|RESTRICT|HR OF OPERATION|HOURS OF OPERATION|HR OF SER|AFIS|\bDLA\b|ALTITUDE|FREQ/i;

/**
 * flights: [{ ads: [{icao, t: Date}], legs: [[{lat,lon},{lat,lon}], …] }]; crossings: [{code,label}] of the route.
 * Returns [{ level: 'bad'|'warn'|'info', text, id }], most important first.
 */
export function notamFlags(b, { ads = [], legs = [], crossings = [], sun = null }) {
  if (!b) return [];
  const out = [], seen = new Set();
  const push = (level, text, id) => { if (!seen.has(id)) { seen.add(id); out.push({ level, text, id }); } };
  const active = (n, t0, t1) => (n.from == null || n.from <= t1) && (n.to == null || n.to >= t0);
  const nearRoute = (text) => {
    const pts = coordsIn(text);
    if (!pts.length || !legs.length) return null;
    let best = Infinity;
    for (const p of pts) for (const [a, c] of legs) best = Math.min(best, nmToSegment(p, a, c));
    return best;
  };
  const short = (t) => t.replace(/\n/g, ' ').replace(/\s+/g, ' ').slice(0, 160);
  for (const { icao, t } of ads) {
    const t0 = t.getTime() - 3600e3, t1 = t.getTime() + 3600e3;
    for (const src of [b.ads[icao], b.misc[icao]]) {
      for (const n of (src && src.notams) || []) {
        if (!active(n, t0, t1)) continue;
        if (/^TRIGGER NOTAM/i.test(n.text)) { push('info', `${icao} ${n.id}: AIP amendment (trigger NOTAM) — ${short(n.text.split('\n').slice(1).join(' ')) || 'see bulletin'}`, n.id); continue; }
        let level = BAD.test(n.text) ? 'bad' : WARN.test(n.text) ? 'warn' : 'info';
        let note = '';
        const slots = timeSlots(n.text, t, sun && sun(icao, t));
        if (slots) { level = slots.inside ? 'bad' : 'info'; note = slots.inside ? ` — your time ${hhmm(t)} is inside a slot` : ` — not at your time (${hhmm(t)})`; }
        push(level, `${icao} ${n.id}: ${short(n.text)}${note}${n.est ? ' (end time estimated)' : ''}`, n.id);
      }
    }
  }
  // NOTAMs with positions (drones, cranes, obstacles…) near the route, any section
  const tFlight = ads.length ? ads[0].t.getTime() : Date.now();
  const tEnd = ads.length ? ads[ads.length - 1].t.getTime() : tFlight;
  const all = [...b.areaNotams, ...Object.values(b.ads).flatMap((x) => x.notams), ...Object.values(b.misc).flatMap((x) => x.notams)];
  for (const n of all) {
    if (!active(n, tFlight - 3600e3, tEnd + 3600e3)) continue;
    const d = nearRoute(n.text);
    if (d != null && d <= 3) push('warn', `${n.id}${n.area ? ` (${n.area})` : ''}: within ${d.toFixed(1)} NM of your route — ${short(n.text.replace(/\s*WI\b.*$/s, ''))}${n.period ? ` · ${n.period}` : ''}${n.limits ? ` · limits ${n.limits}` : ''}`, n.id);
  }
  // special areas listed as active that the route crosses
  for (const a of b.areas) {
    const hit = crossings.find((c) => c && (c.code === a.code || (c.label || '').toUpperCase().includes(a.code)));
    if (hit) push('warn', `${a.code} ${a.name}: active ${a.periods.map((p) => `${p.period}${p.upper != null ? ` (${p.lower}–${p.upper})` : ''}`).join('; ')} — your route crosses it`, a.code);
  }
  const order = { bad: 0, warn: 1, info: 2 };
  return out.sort((x, y) => order[x.level] - order[y.level]);
}

const hhmm = (d) => `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
/**
 * NOTAM schedules such as "MON 0000-SR/ SS-2200" or "TUE, WED, THU, FRI 0100-SR/ SS-2200" (UTC; SR/SS
 * at the aerodrome). Returns { inside } for time t, or null when the text has no such schedule.
 */
export function timeSlots(text, t, sun) {
  let found = false, inside = false;
  const mins = (s) => {
    if (/^SR$/.test(s)) return sun && sun.rise ? sun.rise.getUTCHours() * 60 + sun.rise.getUTCMinutes() : null;
    if (/^SS$/.test(s)) return sun && sun.set ? sun.set.getUTCHours() * 60 + sun.set.getUTCMinutes() : null;
    const m = s.match(/^(\d\d)(\d\d)$/); return m ? +m[1] * 60 + +m[2] : null;
  };
  const now = t.getUTCHours() * 60 + t.getUTCMinutes(), day = DAYS[t.getUTCDay()];
  for (const line of String(text).split('\n')) {
    const m = line.match(/^((?:(?:MON|TUE|WED|THU|FRI|SAT|SUN)[,\s]*)+)\s*(.+)$/);
    if (!m) continue;
    const days = m[1].match(/MON|TUE|WED|THU|FRI|SAT|SUN/g);
    for (const r of m[2].split('/')) {
      const rm = r.trim().match(/^(SR|SS|\d{4})\s*-\s*(SR|SS|\d{4})$/);
      if (!rm) continue;
      found = true;
      if (!days.includes(day)) continue;
      const a = mins(rm[1]), b = mins(rm[2]);
      if (a == null || b == null) { inside = true; continue; } // unknown sunrise/sunset: be safe
      if (a <= b ? now >= a && now <= b : now >= a || now <= b) inside = true;
    }
  }
  return found ? { inside } : null;
}

/** Renders page 1 of a PDF to a canvas (longest side about maxPx). */
export async function pdfFirstPageCanvas(bytes, maxPx = 2400) {
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(1);
  const v1 = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: maxPx / Math.max(v1.width, v1.height) });
  const c = document.createElement('canvas'); c.width = Math.round(viewport.width); c.height = Math.round(viewport.height);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: g, viewport }).promise;
  return c;
}
