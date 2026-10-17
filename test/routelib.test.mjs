import test from 'node:test';
import assert from 'node:assert/strict';
import { bestRoute, avoidAreas, crossesArea, nm, MAX_LEG_NM } from '../js/routelib.js';

// A line of towns every ~10 NM east of the start, and a restricted area across the direct line.
const towns = [];
for (let i = 1; i < 12; i++) towns.push([`T${i}`, 42.0, -4.0 + i * 0.22, 1]);
for (let i = 1; i < 12; i++) towns.push([`N${i}`, 42.25, -4.0 + i * 0.22, 1]);
const exits = [{ id: 'X', lat: 42.0, lon: -4.0, cost: 4 }];
const entries = [{ id: 'Y', lat: 42.0, lon: -1.4, cost: 4 }];

test('every leg is within the school limit', () => {
  const r = bestRoute(exits, entries, towns, [], []);
  assert.ok(r, 'route found');
  const pts = [exits[0], ...r.points, entries[0]];
  for (let i = 1; i < pts.length; i++) assert.ok(nm(pts[i - 1], pts[i]) <= MAX_LEG_NM, `leg ${i} ${nm(pts[i - 1], pts[i]).toFixed(1)} NM`);
});

test('keeps out of a restricted area when there is a way round', () => {
  const box = (s, w, n, e) => [[s, w], [s, e], [n, e], [n, w], [s, w]];
  const areas = avoidAreas([{ type: 'R', lowerFt: 0, rings: [box(41.9, -3.2, 42.12, -2.9)] }], []);
  const r = bestRoute(exits, entries, towns, areas, []);
  const pts = [exits[0], ...r.points, entries[0]];
  for (let i = 1; i < pts.length; i++) assert.equal(crossesArea(pts[i - 1], pts[i], areas[0]), false, `leg ${i} enters the area`);
});

test('no route when the towns are too far apart', () => {
  const r = bestRoute(exits, entries, [['Far', 42.0, -2.7, 1]], [], []);
  assert.equal(r, null);
});
