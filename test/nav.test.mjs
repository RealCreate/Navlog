// Run with: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { windTriangle, cruiseTas, computeNavlog, fuelPolicy, massBalance, fmtMMSS, parseAlt, trueCourse, distanceNm } from '../js/nav.js';
import { AERODROMES, POINTS, FLEET } from '../js/data.js';

test('SOP TAS rule: 90 kt + 2 kt per 1000 ft', () => {
  assert.equal(cruiseTas(4500), 99); // SOP example
  assert.equal(cruiseTas(8500), 107); // SOP example
  assert.equal(cruiseTas(6500), 103); // matches the Excel navlog
  assert.equal(cruiseTas(5500), 101);
});

// The SOP example reads 5° R off the CRP; the exact triangle gives 4.4° → 4° R.
test('SOP wind example: TC 331, W/V 350/25, TAS 107 → 4° R, crosswind 8 kt', () => {
  const w = windTriangle(331, 107, 350, 25);
  assert.equal(w.wca, 4);
  assert.equal(Math.round(w.xw), 8);
  assert.ok(w.hw > 0, 'positive = headwind');
  assert.equal(w.gs, 83);
});

test('Tailwind increases GS, headwind reduces it', () => {
  assert.equal(windTriangle(360, 100, 180, 10).gs, 110);
  assert.equal(windTriangle(360, 100, 360, 10).gs, 90);
});

test('ETE formatting and FL parsing', () => {
  assert.equal(fmtMMSS(200), '3:20');
  assert.equal(parseAlt('FL085'), 8500);
  assert.equal(parseAlt('5500'), 5500);
});

test('Fuel: 20 min standard departure at 18 L/h = 6 L; arrival 15 min = 4.5 L', () => {
  const lebg = POINTS.find((p) => p.key === 'LEBG');
  const w = POINTS.find((p) => p.key === 'LEBG-W');
  const n = POINTS.find((p) => p.key === 'LEBG-N');
  const plan = {
    stdDep: true, stdArr: true, fob: 120,
    waypoints: [
      { name: 'LEBG', ...lebg },
      { name: 'W', ...w, alt: 5000, var: 1 },
      { name: 'N', ...n, alt: 6500, var: 1 },
      { name: 'LEBG', ...lebg, alt: 4000, var: 1 },
    ],
  };
  const nl = computeNavlog(plan);
  assert.equal(nl.rows[0].fuel, 6);
  assert.equal(nl.rows[0].eteSec, 1200);
  assert.equal(nl.rows.at(-1).fuel, 4.5);
  assert.equal(nl.rows.at(-1).eteSec, 900);
  // climb 5000 → 6500 = 3 min at 500 fpm, inserted as TOC
  assert.equal(nl.rows[1].to, 'TOC');
  assert.equal(nl.rows[1].tas, 75);
  assert.equal(nl.rows[1].ff, 23);
  // MC = TC − 1°E
  assert.equal(nl.rows[0].mc, (nl.rows[0].tc - 1 + 360) % 360 || 360);
  // fuel remaining
  assert.equal(nl.rows[0].fuelRem, 114);
  const sum = nl.rows.reduce((t, r) => t + r.fuel, 0);
  assert.ok(Math.abs(sum - nl.totals.trip) < 0.05);
});

test('Fuel policy: contingency 5 % trip, final reserve 45 min', () => {
  const f = fuelPolicy({ trip: 24, alternate: 12.2, fob: 120 });
  assert.equal(f.contingency, 1.2);
  assert.equal(f.finalReserve, 13.5);
  assert.equal(f.required, 50.9);
});

test('M&B matches the Excel sheet (EC-ODX, 73 + 69.6 kg, 120 L, trip 24 L)', () => {
  const r = massBalance({ ac: FLEET.P2008, reg: 'EC-ODX', pilot: 73, copilot: 69.6, fobL: 120, tripL: 24 });
  assert.equal(Math.round(r.tom * 100) / 100, 650);
  assert.equal(Math.round(r.lm * 100) / 100, 632.72);
  assert.equal(Math.round(r.toCg * 1e4) / 1e4, 1.8798);
});

test('LEBG W VRP is roughly 10 NM west of the field (Excel leg 1 = 10 NM)', () => {
  const ad = AERODROMES[0];
  const w = ad.vrps.find((v) => v.id === 'W');
  const d = distanceNm(ad, w);
  assert.ok(d > 9 && d < 11, `got ${d}`);
  const tc = trueCourse(ad, w);
  // Direct line; the Excel used 265 because it follows the published FIZ route.
  assert.ok(Math.abs(tc - 275) < 3, `TC ${tc}`);
});
