// Engine 2: mash pH estimator (simplified model).
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../assets/brewphase.js');

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);

test('malt distilled-water pH by class and colour', () => {
  close(B.maltDistilledPH('base', 2), 5.744, 1e-9);
  close(B.maltDistilledPH('base', 10), 5.52, 1e-9);
  close(B.maltDistilledPH('crystal', 40), 5.22 - 0.2016, 1e-9);
  close(B.maltDistilledPH('crystal', 120), 5.22 - 0.6048, 1e-9);
  assert.equal(B.maltDistilledPH('roast', 300), 4.70);
  assert.equal(B.maltDistilledPH('roast', 550), 4.70);
  assert.throws(() => B.maltDistilledPH('smoked', 5), /Unknown/);
});

test('residual alkalinity (Kolbach) divisors derive to 1.40 and 1.70', () => {
  close(B.residualAlkalinity(0, 1.4016, 0), -1, 1e-3);
  close(B.residualAlkalinity(0, 0, 1.7000), -1, 1e-3);
  close(B.residualAlkalinity(100, 50, 10), 100 - 50 / 1.4016 - 10 / 1.7000, 1e-2);
});

test('single pale malt in distilled water returns that malt\'s pH', () => {
  const r = B.estimateMashPH({ malts: [{ type: 'base', kg: 5, lovibond: 2 }], residualAlkalinity: 0, waterL: 15 });
  close(r.ph, 5.744, 1e-9);
  assert.equal(r.status, 'high');
});

test('mass-weighted grist pH', () => {
  const malts = [
    { type: 'base', kg: 4, lovibond: 2 },
    { type: 'crystal', kg: 0.3, lovibond: 60 },
    { type: 'roast', kg: 0.5, lovibond: 500 }
  ];
  const expected = (4 * 5.744 + 0.3 * (5.22 - 0.3024) + 0.5 * 4.70) / 4.8;
  const r = B.estimateMashPH({ malts, residualAlkalinity: 0, waterL: 14 });
  close(r.grainPH, expected, 1e-9);
  assert.equal(r.status, 'in-range');
});

test('water shift = RA(meq) / (B × kg)', () => {
  const r = B.estimateMashPH({ malts: [{ type: 'base', kg: 5, lovibond: 2 }], residualAlkalinity: 100, waterL: 15 });
  const shift = (100 / 50.043 * 15) / (38 * 5);
  close(r.waterShift, shift, 1e-9);
  close(r.ph, 5.744 + shift, 1e-9);
  // Negative RA pulls pH down.
  const neg = B.estimateMashPH({ malts: [{ type: 'base', kg: 5, lovibond: 2 }], residualAlkalinity: -100, waterL: 15 });
  close(neg.ph, 5.744 - shift, 1e-9);
});

test('Kolbach anchor: 178 mg/L RA at 3 L/kg shifts about 0.3', () => {
  const r = B.estimateMashPH({ malts: [{ type: 'base', kg: 5, lovibond: 2 }], residualAlkalinity: 178, waterL: 15 });
  close(r.waterShift, 0.28, 0.03);
});

test('warnings: dark base malt and odd mash thickness', () => {
  const r = B.estimateMashPH({ malts: [{ type: 'base', kg: 5, lovibond: 40 }], residualAlkalinity: 0, waterL: 40 });
  assert.ok(r.warnings.some(w => w.code === 'dark-base'));
  assert.ok(r.warnings.some(w => w.code === 'thickness'));
});

test('zero-weight malts are ignored; empty grist throws', () => {
  const r = B.estimateMashPH({ malts: [{ type: 'base', kg: 5, lovibond: 2 }, { type: 'roast', kg: 0, lovibond: 500 }], residualAlkalinity: 0, waterL: 15 });
  close(r.ph, 5.744, 1e-9);
  assert.throws(() => B.estimateMashPH({ malts: [], residualAlkalinity: 0, waterL: 15 }), /at least one malt/);
  assert.throws(() => B.estimateMashPH({ malts: [{ type: 'base', kg: 5, lovibond: 2 }], residualAlkalinity: 0, waterL: 0 }), />/);
});
