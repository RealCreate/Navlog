import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMb, insideEnvelope, MB_TYPES } from '../js/mb.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('P2008: same numbers as the existing sheet engine (70 + 70 kg, 90 L, trip 30 L)', () => {
  const m = computeMb('P2008', { reg: 'EC-OKZ', loads: { pilot: 70, copilot: 70 }, fobL: 90, tripL: 30 });
  near(m.to.mass, 430 + 140 + 64.8, 0.01, 'TOM');
  near(m.to.moment, 810.1 + 252 + 64.8 * 2.209, 0.01, 'moment');
  assert.ok(m.ok);
});

test('P2002 SOP example: 400 + 75 + 85 + 60 kg fuel → 620 kg / 1049.8 kgm, in limits', () => {
  // the SOP example enters 60 kg of fuel (83.3 L)
  const m = computeMb('P2002', { reg: 'EC-MOH', empty: [400, 670], loads: { pilot: 75, copilot: 85 }, fobL: 60 / 0.72, tripL: 30 });
  near(m.to.mass, 620, 0.1, 'TOM');
  near(m.to.moment, 1049.8, 0.2, 'moment');
  assert.ok(m.to.massOk && m.to.cgOk, m.issues.join('; '));
});

test('P-Mentor SOP example: 70 + 70 kg, 90 L, trip 30 L → 656.8 kg / 1173.57 kgm', () => {
  const m = computeMb('PMENTOR', { reg: 'EC-OCG', loads: { pilot: 70, copilot: 70 }, fobL: 90, tripL: 30 });
  near(m.to.mass, 656.8, 0.05, 'TOM');
  near(m.to.moment, 1173.57, 0.05, 'moment');
  near(m.ldg.mass, 635.2, 0.05, 'LM');
  near(m.ldg.moment, 1127.37, 0.05, 'LM moment');
  assert.ok(m.ok, m.issues.join('; '));
});

test('PS-28 SOP example (EC-NAO 2022 values): 600 kg, C.G. 481 mm = 32 % MAC', () => {
  const m = computeMb('PS28', { reg: 'EC-NAO', empty: [387, 167329], loads: { pilot: 75, copilot: 85 }, fobL: 53 / 0.72 });
  near(m.to.mass, 600, 0.1, 'TOM');
  near(m.to.moment, 288869, 30, 'moment');
  near(m.to.arm, 481, 0.5, 'CG');
  near(m.pct(m.to.arm), 32, 0.2, '%MAC');
  assert.ok(m.to.cgOk);
});

test('C172N sample: 1454 lb / 57.6, 240 lb fuel, 340 front, 170 rear, 96 baggage → 2300 lb / 103.2', () => {
  const kg = (lb) => lb / 2.20462;
  const m = computeMb('C172', { reg: 'X', empty: [1454, 57600], loads: { pilot: kg(340), pax: kg(170), baggage: kg(96) }, fobL: 40 * 3.78541 });
  near(m.to.mass, 2300, 0.3, 'TOW');
  near(m.to.moment / 1000, 103.2, 0.15, 'moment/1000');
  assert.ok(m.to.cgOk && m.to.massOk, m.issues.join('; '));
});

test('C172RG sample: ramp 2658 lb / 120.3, taxi −8 lb → 2650 lb / 119.9, in limits', () => {
  const kg = (lb) => lb / 2.20462;
  const m = computeMb('C172RG', { empty: [1624, 61600], loads: { pilot: kg(340), pax: kg(340), baggage: kg(90) }, fobL: 44 * 3.78541 });
  near(m.ramp.mass, 2658, 0.3, 'ramp');
  near(m.to.mass, 2650, 0.3, 'TOW');
  near(m.to.moment / 1000, 119.9, 0.15, 'moment');
  assert.ok(m.ok, m.issues.join('; '));
});

test('PA-28 SOP example: 1603 + 330 + 288 lb → 2221 lb, C.G. 86.3 in, in limits', () => {
  const kg = (lb) => lb / 2.20462;
  const m = computeMb('PA28', { reg: 'EC-JFE', loads: { pilot: kg(330) }, fobL: 48 * 3.78541 });
  near(m.to.mass, 2221, 0.3, 'TOW');
  near(m.to.arm, 86.3, 0.1, 'CG'); // the sheet rounds each moment to 0.1 thousand
  assert.ok(m.ok, m.issues.join('; '));
});

test('Envelopes: limits inclusive, outside detected', () => {
  const e = MB_TYPES.C172.envelope;
  assert.ok(insideEnvelope(e, 35.0, 1900));
  assert.ok(!insideEnvelope(e, 35.5, 2300));
  assert.ok(insideEnvelope(e, 38.5, 2300));
  assert.ok(!insideEnvelope(e, 47.5, 2000));
  assert.ok(insideEnvelope(MB_TYPES.P2008.envelope, 1.978, 650));
});

test('P2006: MZFW 1195 kg and per-registration MTOW', () => {
  const m = computeMb('P2006', { reg: 'EC-LIF', loads: { pilot: 90, copilot: 90, pax1: 80, pax2: 80 }, fobL: 150 });
  assert.equal(m.mtow, 1180);
  assert.ok(m.issues.some((i) => /Takeoff mass/.test(i)));
});
