// Engine 5: priming sugar.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../assets/brewphase.js');

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);

test('CO2 constants derive from the atomic-weight table', () => {
  close(B.CO2_G_PER_L_PER_VOL, 44.009 / 22.414, 1e-12);       // 1.9635 g/L
  close(B.GLUCOSE_G_PER_L_PER_VOL, (44.009 / 22.414) / (2 * 44.009 / 180.156), 1e-12);
  close(B.GLUCOSE_G_PER_L_PER_VOL, 4.019, 0.001);
});

test('residual CO2 fit at reference temperatures', () => {
  close(B.residualCO2(68), 0.8615, 0.0005);
  close(B.residualCO2(32), 1.7078, 0.0005);
  close(B.residualCO2(50), 1.1986, 0.0005);
  // Monotonic decreasing across the fit range.
  for (let t = 32; t < 80; t++) assert.ok(B.residualCO2(t + 1) < B.residualCO2(t), `at ${t}°F`);
});

test('sugar glucose-equivalent factors', () => {
  close(B.SUGARS.dextrose.glucoseEq, 180.156 / 198.171, 1e-12);
  assert.equal(B.SUGARS.dextroseAnhydrous.glucoseEq, 1);
  close(B.SUGARS.tableSugar.glucoseEq, 2 * 180.156 / 342.297, 1e-12);
  close(B.SUGARS.dme.glucoseEq, 0.694, 0.001);
  close(B.SUGARS.honey.glucoseEq, 0.779, 0.001);
  assert.equal(B.SUGARS.dme.flag, true);
  assert.equal(B.SUGARS.honey.flag, true);
});

test('reference case: 5 gal, 68 °F, 2.4 vol', () => {
  const beerL = B.units.galToL(5);
  const add = 2.4 - B.residualCO2(68);
  const glucose = add * beerL * B.GLUCOSE_G_PER_L_PER_VOL;
  const dex = B.primingSugar({ targetVolumes: 2.4, beerL, tempF: 68, sugar: 'dextrose' });
  assert.equal(dex.status, 'ok');
  close(dex.glucoseG, glucose, 1e-9);
  close(dex.grams, glucose / (180.156 / 198.171), 1e-9);
  // Sanity against common homebrew figures: ~4 oz corn sugar for 5 gal.
  close(dex.grams, 128.8, 0.5);
  const sucrose = B.primingSugar({ targetVolumes: 2.4, beerL, tempF: 68, sugar: 'tableSugar' });
  close(sucrose.grams, 111.2, 0.5);
  assert.ok(sucrose.grams < dex.grams, 'table sugar needs less than dextrose monohydrate');
});

test('grams scale linearly with volume', () => {
  const a = B.primingSugar({ targetVolumes: 2.5, beerL: 10, tempF: 65, sugar: 'honey' });
  const b = B.primingSugar({ targetVolumes: 2.5, beerL: 20, tempF: 65, sugar: 'honey' });
  close(b.grams, 2 * a.grams, 1e-9);
});

test('warns above 3.5, refuses above 4.0, 4.0 exactly is allowed', () => {
  const base = { beerL: 19, tempF: 68, sugar: 'dextrose' };
  assert.equal(B.primingSugar({ ...base, targetVolumes: 3.5 }).status, 'ok');
  const w = B.primingSugar({ ...base, targetVolumes: 3.6 });
  assert.equal(w.status, 'warn');
  assert.ok(w.warnings.some(x => x.code === 'high'));
  assert.ok(w.grams > 0);
  assert.equal(B.primingSugar({ ...base, targetVolumes: 4.0 }).status, 'warn');
  const r = B.primingSugar({ ...base, targetVolumes: 4.01 });
  assert.equal(r.status, 'refused');
  assert.equal(r.grams, null);
});

test('no sugar when beer already holds the target', () => {
  const r = B.primingSugar({ targetVolumes: 1.5, beerL: 19, tempF: 34, sugar: 'dextrose' });
  assert.equal(r.status, 'none');
  assert.equal(r.grams, 0);
});

test('temperature outside fit range is flagged but still computed', () => {
  const r = B.primingSugar({ targetVolumes: 2.4, beerL: 19, tempF: 90, sugar: 'dextrose' });
  assert.ok(r.warnings.some(w => w.code === 'temp-range'));
  assert.ok(r.grams > 0);
});

test('input validation', () => {
  assert.throws(() => B.primingSugar({ targetVolumes: 2.4, beerL: 0, tempF: 68, sugar: 'dextrose' }), />/);
  assert.throws(() => B.primingSugar({ targetVolumes: 2.4, beerL: 19, tempF: 68, sugar: 'maple' }), /Unknown sugar/);
  assert.throws(() => B.primingSugar({ targetVolumes: NaN, beerL: 19, tempF: 68, sugar: 'dextrose' }), /finite/);
});
