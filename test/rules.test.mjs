import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtLevel } from '../js/nav.js';
import { aerodromeOpen, isEuSummer, airspaceCrossings, buildFpl } from '../js/rules.js';

test('Levels above the transition altitude print as FL', () => {
  assert.equal(fmtLevel(6500, null, 6000), 'FL065');
  assert.equal(fmtLevel(5500, null, 6000), '5500');
  assert.equal(fmtLevel(null, 'FL085', 6000), 'FL085');
});

test('LEBG hours from the airport briefing (UTC)', () => {
  // Monday 12 Oct 2026, 17:30 UTC — summer schedule, Monday closes 18:00
  assert.equal(isEuSummer(new Date(Date.UTC(2026, 9, 12, 17, 30))), true);
  assert.equal(aerodromeOpen('LEBG', new Date(Date.UTC(2026, 9, 12, 17, 30))).open, true);
  // Tuesday 13 Oct 2026, 17:30 UTC — Tuesday closes 17:00
  assert.equal(aerodromeOpen('LEBG', new Date(Date.UTC(2026, 9, 13, 17, 30))).open, false);
  // Winter (after 25 Oct 2026), Monday 2 Nov 18:30 UTC — closes 19:00
  assert.equal(aerodromeOpen('LEBG', new Date(Date.UTC(2026, 10, 2, 18, 30))).open, true);
});

test('Route crossing a restricted area is found at the right altitude', () => {
  const sp = [{ type: 'R', id: 'LER99', name: 'TEST', lowerFt: 0, upperFt: 5000, agl: false, rings: [[[42, -4], [42, -3], [43, -3], [43, -4], [42, -4]]] }];
  const legs = [{ a: { lat: 41.8, lon: -3.5 }, b: { lat: 43.2, lon: -3.5 }, alt: 4500, dist: 84, name: 'A → B' }];
  assert.equal(airspaceCrossings(legs, sp).length, 1);
  legs[0].alt = 6500;
  assert.equal(airspaceCrossings(legs, sp).length, 0);
});

test('VFR flight plan draft', () => {
  const fpl = buildFpl({ callsign: 'FBY56Y', reg: 'EC-ODX', dep: 'LEBG', dest: 'LEVT', alts: ['LERJ'], eobt: new Date(Date.UTC(2026, 9, 12, 8, 0)), tas: 101, wps: [{ lat: 42.36, lon: -3.61 }, { lat: 42.5, lon: -3.7 }, { lat: 42.88, lon: -2.72 }], eetMin: 45, dof: '261012' });
  assert.match(fpl, /^\(FPL-FBY56Y-VG/);
  assert.match(fpl, /-LEBG0800/);
  assert.match(fpl, /-N0101VFR DCT 4230N00342W DCT/);
  assert.match(fpl, /-LEVT0045 LERJ/);
});

import { readFileSync } from 'node:fs';
import { mergeAip, procedureFor, adByIcao } from '../js/data.js';
import { aipNotes, NO_REFUEL } from '../js/rules.js';

test('VAC procedures for LEPP, LESO, LEXJ, LEHC, LESA', () => {
  mergeAip(JSON.parse(readFileSync(new URL('../data/aip.json', import.meta.url))));
  assert.equal(adByIcao('LEPP').freq, 'LEPP:118.200');
  assert.deepEqual(procedureFor('LEPP', 'N', 'arr').points, ['N']);
  assert.equal(procedureFor('LEPP', 'E', 'arr').alt, 2500); // 1506 + 1000 AGL max
  assert.deepEqual(procedureFor('LESO', 'W', 'arr').points, ['W', 'W-1']);
  assert.equal(procedureFor('LESO', 'S', 'dep').alt, 1000);
  assert.deepEqual(procedureFor('LEXJ', 'E-1', 'arr').points, ['E-1', 'E-2', 'N-1']);
  assert.deepEqual(procedureFor('LEXJ', 'W-1', 'arr').points, ['W-1', 'S-2']);
  assert.deepEqual(procedureFor('LEHC', 'S-1', 'arr').points, ['S-1', 'S']);
  assert.equal(procedureFor('LEHC', 'W-1', 'arr').alt, 2200); // W route 500 ft AGL max
  assert.equal(procedureFor('LEHC', 'N', 'arr').alt, 2700);
  assert.deepEqual(procedureFor('LESA', 'N', 'arr').points, ['N', 'N-1']);
  assert.equal(procedureFor('LESA', 'E', 'dep').alt, 3500);
});

test('AIP notes: Salamanca weekdays, no AVGAS at Huesca/León', () => {
  const mon = new Date(Date.UTC(2026, 9, 12, 10)), sat = new Date(Date.UTC(2026, 9, 17, 10));
  assert.ok(aipNotes('LESA', 'arr', mon).some((n) => n.level === 'bad'));
  assert.ok(!aipNotes('LESA', 'arr', sat).some((n) => n.level === 'bad'));
  assert.ok(NO_REFUEL.includes('LEHC') && NO_REFUEL.includes('LELN'));
  assert.ok(aipNotes('LEVD', 'arr', mon).some((n) => /PPR/.test(n.text)));
  assert.equal(aerodromeOpen('LEHC', new Date(Date.UTC(2026, 9, 12, 17, 30))).open, false); // summer closes 17:00Z
});
