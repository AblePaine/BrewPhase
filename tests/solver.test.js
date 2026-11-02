// Engine 6, Stage B: constrained salt solver with hydrate-form lock.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../assets/brewphase.js');

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);
const IONS = ['ca', 'mg', 'na', 'cl', 'so4', 'alk'];

test('B1: every shelf fraction equals its atomic-table quotient', () => {
  const F = B.SALT_FORMS;
  close(F.gypsum.ions.ca, 40.078 / 172.164, 1e-9);
  close(F.gypsum.ions.so4, 96.056 / 172.164, 1e-9);
  close(F.calciumChlorideDihydrate.ions.ca, 40.078 / 147.008, 1e-9);
  close(F.calciumChlorideDihydrate.ions.cl, 70.9 / 147.008, 1e-9);
  close(F.calciumChlorideAnhydrous.ions.ca, 40.078 / 110.978, 1e-9);
  close(F.calciumChlorideAnhydrous.ions.cl, 70.9 / 110.978, 1e-9);
  close(F.epsom.ions.mg, 24.305 / 246.466, 1e-9);
  close(F.epsom.ions.so4, 96.056 / 246.466, 1e-9);
  close(F.canningSalt.ions.na, 22.99 / 58.44, 1e-9);
  close(F.canningSalt.ions.cl, 35.45 / 58.44, 1e-9);
  close(F.bakingSoda.ions.na, 22.99 / 84.006, 1e-9);
  close(F.bakingSoda.alk, 50.043 / 84.006, 1e-9);
  close(F.slakedLime.ions.ca, 40.078 / 74.092, 1e-9);
  close(F.slakedLime.alk, 100.086 / 74.092, 1e-9);
});

test('acid strengths: meq per mL from density, strength and molar mass', () => {
  close(B.ACIDS.lactic88.meqPerMl, 11.812, 1e-3);
  close(B.ACIDS.phosphoric85.meqPerMl, 14.616, 1e-3);
});

test('B2: single-salt exact solve from RO', () => {
  const r = B.solveWater({ source: {}, target: { so4: 100 }, volumeL: 20, shelf: ['gypsum'] });
  assert.equal(r.ok, true);
  const m = r.mixes[0];
  close(m.doses.gypsum.mgPerL, 179.2, 0.1, 'gypsum mg/L');
  close(m.doses.gypsum.grams, 3.58, 0.01, 'gypsum grams');
  close(m.achieved.ca, 41.7, 0.1, 'calcium rides along');
  for (const k of Object.keys(m.doses)) if (k !== 'gypsum') assert.equal(m.doses[k].grams, 0);
});

test('B3: the hydrate lock — dihydrate math on anhydrous salt overdoses chloride', () => {
  const di = B.solveWater({ source: {}, target: { cl: 100 }, volumeL: 20, shelf: ['calciumChlorideDihydrate'] });
  close(di.mixes[0].doses.calciumChlorideDihydrate.grams, 4.15, 0.01, 'dihydrate grams');
  close(di.mixes[0].doses.calciumChlorideDihydrate.mgPerL, 207.3, 0.1);
  close(di.mixes[0].achieved.ca, 56.5, 0.1, 'Ca from dihydrate');
  const an = B.solveWater({ source: {}, target: { cl: 100 }, volumeL: 20, shelf: ['calciumChlorideAnhydrous'] });
  close(an.mixes[0].doses.calciumChlorideAnhydrous.grams, 3.13, 0.01, 'anhydrous grams');
  close(an.mixes[0].doses.calciumChlorideAnhydrous.mgPerL, 156.5, 0.1);
  // The bug the lock prevents: weighing out the dihydrate dose (4.15 g)
  // of the anhydrous salt delivers ~132.5 mg/L Cl against a 100 target.
  const overdose = 4.15 * 1000 / 20 * B.SALT_FORMS.calciumChlorideAnhydrous.ions.cl;
  close(overdose, 132.5, 0.5, 'cross-form overdose');
});

test('B4: feasibility refusal names the blocker; dilution solves the fraction first', () => {
  const no = B.solveWater({ source: { na: 80 }, target: { na: 25 }, volumeL: 20, shelf: ['gypsum'], allowDilution: false });
  assert.equal(no.ok, false);
  assert.deepEqual(no.blockers, ['na']);
  assert.equal(no.mixes.length, 0);
  const yes = B.solveWater({ source: { na: 80 }, target: { na: 25 }, volumeL: 20, shelf: ['gypsum'], allowDilution: true });
  assert.equal(yes.ok, true);
  close(yes.dilution.tapFraction, 25 / 80, 1e-9, 'tap fraction = target / source');
  close(yes.sourceUsed.na, 25, 1e-9, 'source scaled before solving');
});

test('B5: acid demand is exact when no alkalinity salt is in the winning mix', () => {
  const shelf = ['gypsum', 'calciumChlorideDihydrate', 'epsom', 'canningSalt'];
  const r = B.solveWater({ source: { alk: 232 }, target: { alk: 60 }, volumeL: 20, shelf, allowAcid: true });
  const m = r.mixes[0];
  assert.ok(m.acid, 'acid is used');
  close(m.acid.meqTotal, 68.74, 0.05, '(232-60)/50.043 x 20 L');
  close(m.acid.options.lactic88.ml, 5.8, 0.05, 'lactic 88% mL');
  close(m.acid.options.lactic88.tsp, 1.18, 0.01, 'lactic tsp');
  close(m.acid.options.phosphoric85.ml, 4.7, 0.05, 'phosphoric 85% mL');
  close(m.achieved.alk, 60, 0.05, 'alkalinity lands on target');
});

test('B6: full solve hits tolerances and the residuals recompute from the grams', () => {
  const source = { ca: 42.0, mg: 13.0, na: 15.5, so4: 43.4, cl: 21.0, alk: 116.0 };
  const target = { ca: 60, mg: 15, na: 16, cl: 55, so4: 80, alk: 70 };
  const r = B.solveWater({ source, target, volumeL: 20, allowAcid: true });
  assert.equal(r.ok, true);
  const m = r.mixes[0];
  for (const k of IONS) {
    const bound = k === 'alk' ? 8 : 6;
    assert.ok(Math.abs(m.residuals[k]) <= bound, `${k} residual ${m.residuals[k]} within ${bound}`);
  }
  for (const k of Object.keys(m.doses)) assert.ok(m.doses[k].grams >= 0, 'no negative doses');
  assert.ok(!('chalk' in m.doses), 'chalk absent');
  // Residuals recompute from the reported grams (and acid meq) exactly.
  for (const k of IONS) {
    let ach = source[k];
    for (const s of Object.keys(m.doses)) {
      const f = B.SALT_FORMS[s];
      ach += (k === 'alk' ? f.alk : (f.ions[k] || 0)) * m.doses[s].grams * 1000 / 20;
    }
    if (k === 'alk' && m.acid) ach -= m.acid.meqTotal / 20 * B.EQ_CACO3;
    close(m.residuals[k], ach - target[k], 0.5, `residual recompute ${k}`);
  }
  // Further mixes differ from mix 1 and score no better.
  assert.ok(r.mixes.length >= 2, 'ranked alternatives exist');
  const sig = mx => JSON.stringify(mx.doses) + '|' + (mx.acid ? mx.acid.meqTotal.toFixed(3) : 'noacid');
  for (const other of r.mixes.slice(1)) {
    assert.notEqual(sig(other), sig(m), 'alternative differs from mix 1');
    assert.ok(other.score >= m.score - 1e-9, 'alternative scores no better');
  }
});

test('B7: chalk is structurally absent from the shelf', () => {
  assert.equal(B.SALT_FORMS.chalk, undefined);
  assert.ok(!B.SALT_FORM_ORDER.some(k => /chalk/i.test(k)));
  const r = B.solveWater({
    source: {}, volumeL: 20, allowAcid: true,
    target: { ca: 100, mg: 10, na: 20, cl: 100, so4: 100, alk: 100 }
  });
  for (const m of r.mixes) assert.ok(!('chalk' in m.doses));
});

test('site standard: engine 1 presets solve from RO without a feasibility refusal', () => {
  const presets = [
    { ca: 83, mg: 5, na: 0, cl: 50, so4: 150, alk: 0 },
    { ca: 65, mg: 5, na: 0, cl: 75, so4: 75, alk: 0 },
    { ca: 69, mg: 5, na: 15, cl: 100, so4: 50, alk: 32 },
    { ca: 61, mg: 10, na: 30, cl: 100, so4: 50, alk: 65 }
  ];
  for (const p of presets) {
    const r = B.solveWater({ source: {}, target: p, volumeL: 20, allowAcid: true });
    assert.equal(r.ok, true, JSON.stringify(p));
    assert.ok(r.mixes.length >= 1);
  }
});

test('per-salt max grams clamp the dose and label the mix constrained', () => {
  const r = B.solveWater({
    source: {}, target: { so4: 100 }, volumeL: 20,
    shelf: ['gypsum'], maxGrams: { gypsum: 2 }
  });
  close(r.mixes[0].doses.gypsum.grams, 2, 1e-9, 'clamped at the max');
  assert.deepEqual(r.mixes[0].constrainedBy, ['Gypsum']);
});

test('an unspecified target ion is ignored, not treated as zero', () => {
  // Only Cl targeted: the solver spends the dihydrate dose on Cl alone and
  // lets calcium land where it lands (reported, not scored).
  const r = B.solveWater({ source: {}, target: { cl: 100 }, volumeL: 20, shelf: ['calciumChlorideDihydrate'] });
  const m = r.mixes[0];
  close(m.residuals.cl, 0, 1e-6);
  assert.equal(m.residuals.ca, null);
  assert.equal(m.within.ca, null);
});

test('solver input validation', () => {
  assert.throws(() => B.solveWater({ source: {}, target: {}, volumeL: 0, shelf: [] }), />/);
  assert.throws(() => B.solveWater({ source: { ca: -1 }, target: {}, volumeL: 20, shelf: [] }), /negative/);
  assert.throws(() => B.solveWater({ source: {}, target: {}, volumeL: 20, shelf: ['chalk'] }), /Unknown salt/);
});

test('dilution ignores do-not-care ions (regression: blank target is not zero)', () => {
  // Only Na and Cl targeted; Mg/SO4 present in the source but not targeted.
  // Before the fix, the zero-filled targets made Mg and SO4 "blockers" with
  // ratio 0 and the dilution collapsed to 100% RO.
  const r = B.solveWater({ source: { ca: 42, mg: 13, na: 80, cl: 21, so4: 43.4, alk: 116 },
    target: { na: 25, cl: 100 }, volumeL: 20, shelf: ['calciumChlorideDihydrate'],
    allowAcid: true, allowDilution: true });
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.dilution.tapFraction - 0.3125) < 1e-9);
  assert.ok(Math.abs(r.dilution.sourceAfter.na - 25) < 1e-9);
  assert.ok(Math.abs(r.dilution.sourceAfter.mg - 13 * 0.3125) < 1e-9);
});
