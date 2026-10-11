import test from 'node:test';
import assert from 'node:assert/strict';
import { PERF, performance, phaseDistance } from '../js/perf.js';

test('tables increase with altitude and temperature (catches transcription slips)', () => {
  const tables = [];
  for (const [id, p] of Object.entries(PERF)) {
    if (p.to) tables.push([`${id} to`, p.to]);
    if (p.ldg) tables.push([`${id} ldg`, p.ldg]);
    for (const [w, t] of p.toByWeight || []) tables.push([`${id} to ${w}`, t]);
  }
  const issues = [];
  for (const [name, t] of tables) {
    for (const k of ['gr', 'd50']) {
      const g = t[k];
      assert.equal(g.length, t.alts.length, `${name} ${k} rows`);
      g.forEach((row, i) => {
        assert.equal(row.length, t.temps.length, `${name} ${k} row ${i} columns`);
        row.forEach((v, j) => {
          if (j && v < row[j - 1]) issues.push(`${name} ${k} alt ${t.alts[i]} temp ${t.temps[j]}`);
          if (i && v < g[i - 1][j]) issues.push(`${name} ${k} alt ${t.alts[i]} temp ${t.temps[j]} (vs lower alt)`);
        });
      });
      t.gr.forEach((row, i) => row.forEach((v, j) => { if (v > t.d50[i][j]) issues.push(`${name} GR > 50ft at ${t.alts[i]}/${t.temps[j]}`); }));
    }
  }
  assert.deepEqual(issues, []);
});

test('P2008: table values at the grid points, paved −10 % ground roll', () => {
  const r = performance('P2008', { pa: 0, oat: 25, wind: 0, surface: 'grass' });
  assert.equal(r.to.gr, 224); assert.equal(r.to.d50, 463);
  assert.equal(r.ldg.gr, 179); assert.equal(r.ldg.d50, 388);
  const p = performance('P2008', { pa: 0, oat: 25, wind: 0, surface: 'paved' });
  assert.equal(p.to.gr, 202); assert.equal(p.to.d50, 463);
});

test('P2008: interpolation and wind (headwind −5 m/kt take-off)', () => {
  const r = performance('P2008', { pa: 2962, oat: 12.5, wind: 10, surface: 'grass' });
  // 2000/3000 ft rows, 0/25 °C columns
  const gr = (216 + (267 - 216) / 2) + ((236 + (292 - 236) / 2) - (216 + (267 - 216) / 2)) * 0.962;
  assert.ok(Math.abs(r.to.gr - Math.round(gr - 50)) <= 1, `${r.to.gr}`);
});

test('C172N: 2300 lb, S.L., 20 °C → 835 / 1490 ft; 2200 lb halfway between tables', () => {
  const r = performance('C172', { pa: 0, oat: 20, wind: 0, surface: 'paved', weight: 2300 });
  assert.equal(r.to.gr, 835); assert.equal(r.to.d50, 1490);
  const h = performance('C172', { pa: 0, oat: 20, wind: 0, surface: 'paved', weight: 2200 });
  assert.equal(h.to.gr, Math.round((680 + 835) / 2));
  const g = performance('C172', { pa: 0, oat: 20, wind: 0, surface: 'grass', weight: 2300 });
  assert.equal(g.to.gr, Math.round(835 * 1.15)); assert.equal(g.to.d50, Math.round(1490 + 835 * 0.15));
});

test('P2006 NG uses ISA deviation columns', () => {
  const r = performance('P2006NG', { pa: 0, oat: 15, wind: 0, surface: 'paved' });
  assert.equal(r.to.gr, 292); assert.equal(r.to.d50, 443);
  assert.equal(r.ldg.gr, 252); assert.equal(r.ldg.d50, 448);
  const hot = performance('P2006NG', { pa: 0, oat: 25, wind: 0, surface: 'paved' });
  assert.equal(hot.to.gr, 316);
});

test('P-Mentor landing: grass +20 % ground roll, 6 kt headwind −10 % / −6 %', () => {
  const r = phaseDistance(PERF.PMENTOR.ldg, { pa: 0, oat: 15, wind: 6, surface: 'grass' });
  assert.equal(r.gr, Math.round(178 * 0.9 * 1.2));
  assert.equal(r.d50, Math.round(440 * 0.94));
});

test('PA-28 charts: ground roll read like the printed chart', () => {
  // weight reference line at 2550 lb, no wind: S.L., ~15 °C reads about 1000 ft on the take-off chart
  const r = performance('PA28', { pa: 0, oat: 15, wind: 0, surface: 'paved', weight: 2550 });
  assert.ok(r.to.gr > 850 && r.to.gr < 1150, `take-off ${r.to.gr}`);
  assert.ok(r.ldg.gr > 850 && r.ldg.gr < 1000, `landing ${r.ldg.gr}`);
  const light = performance('PA28', { pa: 0, oat: 15, wind: 0, surface: 'paved', weight: 2050 });
  assert.ok(light.to.gr < r.to.gr * 0.65 && light.to.gr > r.to.gr * 0.55);
  const hw = performance('PA28', { pa: 0, oat: 15, wind: 10, surface: 'paved', weight: 2550 });
  assert.ok(hw.to.gr < r.to.gr);
});
