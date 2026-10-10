// Navigation log engine. Follows SOP 2511 (Phase 2 Training Manual),
// Flight Planning Manual – Navigation Log, step by step:
//  TC from the chart (true), MC = TC − VAR(E) / + VAR(W), TAS rule of thumb,
//  TOC/TOD at 500 ft/min using Ground Speed, WCA, MH = MC ± WCA, GS, ETE = Dist/GS,
//  standard times for the initial (20 min) and final (15 min) legs,
//  fuel per phase in litres, contingency 5 % trip, final reserve 45 min.

import { SOP } from './data.js';

const R_NM = 3440.065;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
export const norm360 = (d) => ((d % 360) + 360) % 360;
const hdg = (d) => { const v = Math.round(norm360(d)); return v === 0 ? 360 : v; };

export function distanceNm(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return norm360(deg(Math.atan2(y, x)));
}

export function midpoint(a, b) {
  return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
}

// True course as measured with the plotter: the course at the middle of the leg.
export function trueCourse(a, b) {
  const m = midpoint(a, b);
  const back = bearing(m, a), fwd = bearing(m, b);
  // average the forward bearing and the reversed back bearing at the midpoint
  const r = norm360(back + 180);
  let diff = ((fwd - r + 540) % 360) - 180;
  return norm360(r + diff / 2);
}

export const roundHalfUp = (x, step) => Math.ceil(x / step - 1e-9) * step;
export const roundTo = (x, step) => Math.round(x / step) * step;

// SOP: "+2 kt of the IAS for each 1000 ft" (90 kt at sea level).
export function cruiseTas(altFt, s = SOP) {
  return Math.round(s.tasBase + s.tasPer1000 * (altFt / 1000));
}

// Wind triangle (true course, true wind). Returns integer WCA (+R / −L) and integer GS.
export function windTriangle(tc, tas, wdir, wspd) {
  if (!wspd) return { wca: 0, gs: Math.round(tas), xw: 0, hw: 0 };
  const angle = rad(wdir - tc);
  const xw = wspd * Math.sin(angle); // + = from the right
  const hw = wspd * Math.cos(angle); // + = headwind (SOP: positive = headwind)
  if (Math.abs(xw) >= tas) return { error: 'Wind too strong for TAS', wca: 0, gs: 0, xw, hw };
  const wcaRad = Math.asin(xw / tas);
  const gs = tas * Math.cos(wcaRad) - hw;
  return { wca: Math.round(deg(wcaRad)), gs: Math.round(gs), xw, hw };
}

export function parseAlt(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim().toUpperCase();
  const fl = s.match(/^FL\s*(\d{2,3})$/);
  if (fl) return +fl[1] * 100;
  const n = parseFloat(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function fmtAlt(ft, label) {
  if (label && /^FL/i.test(label)) return label.toUpperCase().replace(/\s+/g, '');
  return ft == null ? '' : String(ft);
}

export function fmtVar(v) {
  if (v == null || v === '') return '';
  if (+v === 0) return '0';
  return `${Math.abs(v)}${v > 0 ? 'E' : 'W'}`;
}

export function fmtMMSS(sec) {
  sec = Math.round(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtHMS(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return [h, m, s].map((x) => String(x).padStart(2, '0')).join(':');
}

const r1 = (x) => Math.round(x * 10 + 1e-9) / 10;

/**
 * plan = {
 *   waypoints: [{ name, lat, lon, alt, altLabel, wdir, wspd, tas, var }],
 *     — alt/wind/tas/var on waypoint i (i ≥ 1) describe the leg INTO waypoint i.
 *   stdDep: bool, stdArr: bool, fob: litres at start
 * }
 */
export function computeNavlog(plan, s = SOP) {
  const wps = plan.waypoints || [];
  const rows = [];
  const warnings = [];
  if (wps.length < 2) return { rows, warnings, totals: emptyTotals() };

  const legs = [];
  for (let i = 1; i < wps.length; i++) {
    const a = wps[i - 1], b = wps[i];
    const tc = trueCourse(a, b);
    const dist = roundTo(distanceNm(a, b), 0.5);
    legs.push({ i, a, b, tc, dist });
  }

  // Standard times (SOP): the initial legs up to the departure reporting point take 20 min,
  // the legs from the arrival reporting point to the aerodrome take 15 min. Published
  // procedure legs (VAC corridors) are marked proc: 'dep' / 'arr' on their waypoints.
  let depCount = 0, arrCount = 0;
  if (plan.stdDep) {
    while (depCount < legs.length && wps[depCount + 1].proc === 'dep') depCount++;
    depCount = Math.max(1, depCount);
  }
  if (plan.stdArr) {
    arrCount = 1;
    while (arrCount < legs.length && wps[wps.length - 1 - arrCount].proc === 'arr') arrCount++;
  }
  if (depCount + arrCount > legs.length) depCount = Math.max(0, legs.length - arrCount);
  const groupDist = (from, n) => legs.slice(from, from + n).reduce((t, l) => t + l.dist, 0) || 1;
  const depDist = groupDist(0, depCount), arrDist = groupDist(legs.length - arrCount, arrCount);

  let prevAlt = parseAlt(wps[1].alt), prevLabel = wps[1].alt;
  legs.forEach((leg, idx) => {
    const b = leg.b;
    const alt = parseAlt(b.alt);
    const altLabel = b.alt;
    const vr = b.var != null && b.var !== '' ? +b.var : 0;
    const wdir = +b.wdir || 0, wspd = +b.wspd || 0;
    const std = idx < depCount ? 'dep' : idx >= legs.length - arrCount ? 'arr' : null;
    const tcRounded = hdg(leg.tc);
    const base = {
      to: b.name, from: leg.a.name, tc: tcRounded, var: vr, mc: hdg(tcRounded - vr),
      alt, altLabel, wdir, wspd, legIndex: leg.i,
    };

    const segRow = (extra) => {
      const tas = extra.tas;
      const wt = windTriangle(tcRounded, tas, wdir, wspd);
      if (wt.error) warnings.push(`${base.from} → ${extra.to}: ${wt.error}`);
      const row = { ...base, ...extra, wca: wt.wca, mh: hdg(base.mc + wt.wca), gs: wt.gs };
      if (row.fixedSec != null) row.eteSec = row.fixedSec;
      else row.eteSec = row.gs > 0 ? (row.dist / row.gs) * 3600 : 0;
      row.fuel = r1((row.eteSec / 3600) * row.ff);
      return row;
    };

    if (std) {
      const tas = b.tas ? +b.tas : s.tasBase;
      const totalMin = std === 'dep' ? s.stdDepMin : s.stdArrMin;
      const share = leg.dist / (std === 'dep' ? depDist : arrDist);
      rows.push(segRow({
        to: b.name, tas, dist: leg.dist, phase: std, fixedMin: totalMin,
        fixedSec: Math.round(totalMin * 60 * share), ff: s.ffCruise, proc: b.proc || null,
      }));
      prevAlt = alt; prevLabel = altLabel;
      return;
    }

    const cruiseT = b.tas ? +b.tas : cruiseTas(alt ?? 0, s);
    const dAlt = alt != null && prevAlt != null ? alt - prevAlt : 0;
    if (dAlt !== 0) {
      const climbing = dAlt > 0;
      const tasCD = climbing ? s.tasClimb : s.tasDescent;
      const minutes = Math.abs(dAlt) / (climbing ? s.roc : s.rod);
      const gsCD = windTriangle(tcRounded, tasCD, wdir, wspd).gs || tasCD;
      const dCD = roundHalfUp((gsCD * minutes) / 60, 0.5);
      const label = climbing ? 'TOC' : 'TOD';
      const cd = { tas: tasCD, phase: climbing ? 'climb' : 'descent', ff: climbing ? s.ffClimb : s.ffDescent };
      if (dCD >= leg.dist) {
        warnings.push(`${leg.a.name} → ${b.name}: ${label} is not reached before ${b.name} (${dCD} NM needed, leg is ${leg.dist} NM). Whole leg planned as ${climbing ? 'climb' : 'descent'}.`);
        rows.push(segRow({ to: b.name, dist: leg.dist, ...cd }));
      } else if (climbing) {
        // climb at the start of the leg, level off at TOC
        rows.push(segRow({ to: label, dist: dCD, auto: true, ...cd }));
        rows.push(segRow({ from: label, to: b.name, tas: cruiseT, dist: r1(leg.dist - dCD), phase: 'cruise', ff: s.ffCruise }));
      } else {
        // cruise at the old altitude, start descent at TOD to reach the waypoint at the new altitude
        const prevT = cruiseTas(prevAlt ?? 0, s);
        rows.push(segRow({ to: label, alt: prevAlt, altLabel: prevLabel, tas: prevT, dist: r1(leg.dist - dCD), phase: 'cruise', ff: s.ffCruise, auto: true }));
        rows.push(segRow({ from: label, to: b.name, dist: dCD, ...cd }));
      }
    } else {
      rows.push(segRow({ to: b.name, tas: cruiseT, dist: leg.dist, phase: 'cruise', ff: s.ffCruise }));
    }
    prevAlt = alt; prevLabel = altLabel;
  });

  // Distance remaining, fuel remaining.
  const totalDist = r1(rows.reduce((t, r) => t + r.dist, 0));
  let rem = totalDist, fuelRem = +plan.fob || 0, time = 0;
  rows.forEach((r) => {
    rem = r1(rem - r.dist); r.rem = Math.max(0, rem);
    fuelRem = r1(fuelRem - r.fuel); r.fuelRem = fuelRem;
    time += Math.round(r.eteSec); r.cumSec = time;
  });

  const trip = r1(rows.reduce((t, r) => t + r.fuel, 0));
  return {
    rows, warnings,
    totals: { dist: totalDist, timeSec: time, trip },
  };
}

function emptyTotals() { return { dist: 0, timeSec: 0, trip: 0 }; }

/** Fuel policy (SOP fuel calculations): taxi, trip, alternate, contingency, final reserve, extra. */
export function fuelPolicy({ taxi = 0, trip = 0, alternate = 0, extra = 0, fob = 0, localFlight = false, flightMin = 0 }, s = SOP) {
  const contingency = Math.round(trip * s.contingencyPct) / 100; // 5 % of trip, 2 decimals
  const finalReserve = r1((s.finalReserveMin / 60) * s.ffCruise);
  const required = r1(+taxi + trip + alternate + contingency + finalReserve + +extra);
  const out = { taxi: +taxi, trip, alternate, contingency, finalReserve, extra: +extra, required, fob: +fob };
  out.checks = [];
  out.checks.push({ ok: fob >= required, text: `Fuel on board ${fob} L ≥ minimum required ${required} L` });
  if (localFlight && flightMin <= s.localFlightMaxMin) {
    const need = r1((s.localFlightFuelMin / 60) * s.ffCruise);
    out.checks.push({ ok: fob >= need, text: `Local flight ≤ ${s.localFlightMaxMin} min: fuel for ${s.localFlightFuelMin} flight minutes (${need} L)` });
  }
  return out;
}

/** P2008 mass & balance as in the FlyBy M&B sheet. */
export function massBalance({ ac, reg, pilot = 0, copilot = 0, baggage = 0, fobL = 0, tripL = 0, altL = 0 }) {
  const e = ac.regs[reg];
  if (!e) return null;
  const d = ac.fuelDensity, A = ac.arms;
  const fuelKg = fobL * d, tripKg = tripL * d;
  const m = e[0] + +pilot + +copilot + +baggage + fuelKg;
  const mom = e[1] + pilot * A.pilot + copilot * A.copilot + baggage * A.baggage + fuelKg * A.fuel;
  const lm = m - tripKg, lmom = mom - tripKg * A.fuel;
  const lmAlt = lm - altL * d;
  const res = {
    empty: e[0], tom: m, toCg: mom / m, lm, ldgCg: lmom / lm, lmAlt,
    limits: { mtow: ac.mtow, cg: ac.cg },
  };
  res.ok = m <= ac.mtow && res.toCg >= ac.cg[0] && res.toCg <= ac.cg[1] && res.ldgCg >= ac.cg[0] && res.ldgCg <= ac.cg[1];
  return res;
}
