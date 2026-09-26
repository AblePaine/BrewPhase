// Engine 4: water blending.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../assets/brewphase.js');

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);
const tap = { ca: 80, mg: 15, na: 25, cl: 40, so4: 60, alk: 180 };

test('50/50 with distilled halves every ion', () => {
  const m = B.blendProfile(tap, null, 0.5);
  for (const k of B.BLEND_IONS) close(m[k], tap[k] / 2, 1e-12, k);
  close(m.hco3, B.alkToHco3(90), 1e-9);
});

test('endpoints: 100% tap is tap, 0% tap is diluent', () => {
  const ro = { ca: 2, mg: 0, na: 5, cl: 3, so4: 1, alk: 4 };
  const all = B.blendProfile(tap, ro, 1), none = B.blendProfile(tap, ro, 0);
  for (const k of B.BLEND_IONS) { close(all[k], tap[k], 1e-12); close(none[k], ro[k], 1e-12); }
});

test('solve for a target and round-trip through blendProfile', () => {
  const s = B.solveBlend(180, 0, 45);
  assert.equal(s.ok, true);
  close(s.tapFraction, 0.25, 1e-12);
  close(B.blendProfile(tap, null, s.tapFraction).alk, 45, 1e-9);
  // With a non-zero RO diluent.
  const s2 = B.solveBlend(180, 10, 95);
  close(s2.tapFraction, 0.5, 1e-12);
});

test('unreachable targets are refused, not clamped', () => {
  assert.equal(B.solveBlend(180, 0, 200).ok, false);
  assert.equal(B.solveBlend(180, 10, 5).ok, false);
  assert.equal(B.solveBlend(50, 50, 40).ok, false);
  assert.equal(B.solveBlend(50, 50, 50).ok, true);
});

test('fraction out of range throws', () => {
  assert.throws(() => B.blendProfile(tap, null, 1.2), /between 0 and 1/);
  assert.throws(() => B.blendProfile(tap, null, -0.1), /between 0 and 1/);
});
