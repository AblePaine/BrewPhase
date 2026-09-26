// Engine 1: brewing liquor builder.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../assets/brewphase.js');

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);

test('ion fractions per salt (hand-computed from the atomic-weight table)', () => {
  close(B.SALTS.gypsum.ions.ca, 40.078 / 172.164, 1e-12);
  close(B.SALTS.gypsum.ions.so4, 96.056 / 172.164, 1e-12);
  close(B.SALTS.calciumChloride.ions.cl, 70.9 / 147.008, 1e-12);
  close(B.SALTS.epsom.ions.mg, 24.305 / 246.466, 1e-12);
  close(B.SALTS.bakingSoda.ions.na, 22.99 / 84.006, 1e-12);
  close(B.SALTS.bakingSoda.alk, 50.043 / 84.006, 1e-12);
  close(B.SALTS.chalk.alk, 1, 1e-12);
});

test('1 g gypsum in 1 L gives 232.8 Ca and 557.9 SO4 mg/L', () => {
  const p = B.profileFromSalts({ gypsum: 1000 });
  close(p.ca, 232.79, 0.01);
  close(p.so4, 557.94, 0.01);
});

test('single-ion targets solve to the expected salt and round-trip', () => {
  // 100 mg/L Cl in 20 L -> CaCl2·2H2O = 100/(70.9/147.008) mg/L * 20 L
  const r = B.buildLiquor({ cl: 100 }, 20);
  close(r.grams.calciumChloride, 100 * 147.008 / 70.9 * 20 / 1000, 1e-9);
  close(r.result.cl, 100, 1e-9);
  close(r.result.ca, 100 * 40.078 / 70.9, 1e-9, 'Ca rides along with Cl');
  assert.equal(r.grams.gypsum, 0);
  assert.equal(r.grams.chalk, 0);
});

test('every solved target is hit exactly (except Ca, which is derived)', () => {
  const t = { ca: 0, mg: 10, na: 20, cl: 80, so4: 120, alk: 60 };
  const r = B.buildLiquor(t, 30);
  for (const k of ['mg', 'na', 'cl', 'so4', 'alk']) close(r.result[k], t[k], 1e-9, k);
  // Ca must equal the sum of what gypsum, CaCl2 and chalk carry.
  const c = r.mgPerL;
  close(r.result.ca, c.gypsum * B.SALTS.gypsum.ions.ca + c.calciumChloride * B.SALTS.calciumChloride.ions.ca + c.chalk * B.SALTS.chalk.ions.ca, 1e-9);
  // Grams scale with volume.
  const r2 = B.buildLiquor(t, 60);
  for (const k of B.SALT_ORDER) close(r2.grams[k], 2 * r.grams[k], 1e-9, k);
});

test('Epsom sulfate overshoot sets gypsum to zero and warns', () => {
  const r = B.buildLiquor({ mg: 30, so4: 10 }, 20);
  assert.equal(r.grams.gypsum, 0);
  assert.ok(r.warnings.some(w => w.code === 'so4-over'));
  close(r.result.so4, 30 * 96.056 / 24.305, 1e-9);
});

test('baking-soda alkalinity overshoot sets chalk to zero and warns', () => {
  const r = B.buildLiquor({ na: 50, alk: 20 }, 20);
  assert.equal(r.grams.chalk, 0);
  assert.ok(r.warnings.some(w => w.code === 'alk-over'));
});

test('calcium gap and chalk caveat warnings', () => {
  const r = B.buildLiquor({ ca: 150, cl: 50, so4: 50, alk: 50 }, 20);
  assert.ok(r.warnings.some(w => w.code === 'ca-gap'));
  assert.ok(r.warnings.some(w => w.code === 'chalk'));
});

test('page presets are self-consistent (Ca matches, no overshoot)', () => {
  const presets = [
    { ca: 83, mg: 5, na: 0, cl: 50, so4: 150, alk: 0 },
    { ca: 65, mg: 5, na: 0, cl: 75, so4: 75, alk: 0 },
    { ca: 69, mg: 5, na: 15, cl: 100, so4: 50, alk: 32 },
    { ca: 61, mg: 10, na: 30, cl: 100, so4: 50, alk: 65 }
  ];
  for (const p of presets) {
    const r = B.buildLiquor(p, 20);
    assert.deepEqual(r.warnings.map(w => w.code), [], JSON.stringify(p));
    close(r.result.ca, p.ca, 1, 'Ca');
  }
});

test('input validation', () => {
  assert.throws(() => B.buildLiquor({ ca: 50 }, 0), />/);
  assert.throws(() => B.buildLiquor({ ca: -1 }, 10), /negative/);
  assert.throws(() => B.buildLiquor({ ca: NaN }, 10), /finite/);
});
