import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseBulletin, notamFlags, coordsIn } from '../js/notam.js';

const lines = fs.readFileSync(new URL('./fixtures/icaro-bulletin-sample.txt', import.meta.url), 'utf8').split('\n');
const b = parseBulletin(lines);

test('ICARO bulletin: identifier, MET and NOTAMs per aerodrome', () => {
  assert.equal(b.id, '3123651');
  assert.match(b.ads.LEBG.metar, /^METAR LEBG 111300Z/);
  assert.match(b.ads.LEBG.taf, /PROB30 TEMPO 1202\/1209 3000 BR BCFG$/);
  assert.deepEqual(b.ads.LEBG.notams.map((n) => n.id), ['B8287/26', 'B8288/26', 'B8289/26']);
  assert.equal(b.ads.LERJ.metar, '');
  assert.ok(b.ads.LELN.notams.some((n) => /FOD/.test(n.text)));
  assert.ok(b.areas.find((a) => a.code === 'LER99A'));
  assert.ok(b.areaNotams.find((n) => n.id === 'R3241/26' && n.area === 'RPA LEVT'));
  assert.ok(b.misc.LEVT.notams.find((n) => /CRANE/.test(n.text)));
});

test('Flags: Vitoria training slots, cranes / drones near the route', () => {
  const t = new Date(Date.UTC(2026, 9, 11, 14, 0));
  const legs = [[{ lat: 42.36, lon: -3.61 }, { lat: 42.88, lon: -2.72 }]]; // LEBG → LEVT
  const f = notamFlags(b, { ads: [{ icao: 'LEBG', t }, { icao: 'LEVT', t: new Date(t.getTime() + 3600e3) }], legs });
  assert.ok(f.find((x) => x.level === 'info' && /A6688\/26/.test(x.text) && /not at your time/.test(x.text)), 'training slots, Sunday afternoon');
  assert.ok(f.find((x) => /A5743\/26/.test(x.text)), 'crane at LEVT');
  assert.ok(f.find((x) => /R2613\/26/.test(x.text) && /NM of your route/.test(x.text)), 'drones near the route');
  assert.ok(f.find((x) => /B8287\/26/.test(x.text)), 'LEBG AFIS hours');
  assert.equal(coordsIn('425119N 0024309W').length, 1);
});

import { timeSlots } from '../js/notam.js';
test('Training time slots: inside / outside', () => {
  const txt = 'VFR/IFR TRAINING FLT NOT ALLOWED DURING FOLLOWING TIME SLOTS:\nMON 0000-SR/ SS-2200\nTUE, WED, THU, FRI 0100-SR/ SS-2200\nSUN 2200-2359';
  const sun = { rise: new Date(Date.UTC(2026, 9, 12, 6, 30)), set: new Date(Date.UTC(2026, 9, 12, 17, 40)) };
  assert.equal(timeSlots(txt, new Date(Date.UTC(2026, 9, 11, 14, 0)), sun).inside, false); // Sunday afternoon
  assert.equal(timeSlots(txt, new Date(Date.UTC(2026, 9, 12, 18, 30)), sun).inside, true); // Monday after sunset
  assert.equal(timeSlots(txt, new Date(Date.UTC(2026, 9, 13, 10, 0)), sun).inside, false); // Tuesday day
  assert.equal(timeSlots('RWY 05 CLSD', new Date(), sun), null);
});
