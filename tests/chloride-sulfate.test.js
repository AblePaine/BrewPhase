// Engine 3: chloride:sulfate ratio.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../assets/brewphase.js');

test('ratio is Cl / SO4 by mass', () => {
  assert.equal(B.chlorideSulfate(50, 100).ratio, 0.5);
  assert.equal(B.chlorideSulfate(150, 50).ratio, 3);
});

test('interpretation bands at and around boundaries', () => {
  const band = (cl, so4) => B.chlorideSulfate(cl, so4).band.label;
  assert.equal(band(40, 100), 'Very bitter');   // 0.40
  assert.equal(band(50, 100), 'Bitter');        // 0.50 (boundary goes up)
  assert.equal(band(76, 100), 'Bitter');        // 0.76
  assert.equal(band(100, 100), 'Balanced');     // 1.00
  assert.equal(band(130, 100), 'Malty');        // 1.30
  assert.equal(band(199, 100), 'Malty');
  assert.equal(band(200, 100), 'Very malty');   // 2.00
});

test('edge cases: zero sulfate, both zero, low totals', () => {
  const inf = B.chlorideSulfate(50, 0);
  assert.equal(inf.ratio, Infinity);
  assert.equal(inf.band.label, 'Very malty');
  const none = B.chlorideSulfate(0, 0);
  assert.equal(none.ratio, null);
  assert.equal(B.chlorideSulfate(10, 20).lowTotal, true);
  assert.equal(B.chlorideSulfate(50, 50).lowTotal, false);
  assert.throws(() => B.chlorideSulfate(-1, 5), /negative/);
});

test('style fit', () => {
  const ipa = B.STYLE_RATIOS.find(s => /West Coast/.test(s.style));
  assert.equal(B.styleFit(0.3, ipa), 'within');
  assert.equal(B.styleFit(0.1, ipa), 'below');
  assert.equal(B.styleFit(1.0, ipa), 'above');
  assert.equal(B.styleFit(null, ipa), null);
  for (const s of B.STYLE_RATIOS) assert.ok(s.low < s.high, s.style);
});
