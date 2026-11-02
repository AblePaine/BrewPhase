// Engine 6, Stage A: report ingest, normalization, charge balance.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../assets/brewphase.js');

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);

test('A1: sulfate as SO4-S and alkalinity forms normalize to canonical units', () => {
  const r = B.normalizeReport({ sulfate: 29, sulfateForm: 's', alkalinity: 232, alkalinityForm: 'caco3' });
  close(r.profile.so4, 86.9, 0.05, 'SO4 = S x 96.056/32.06');
  close(r.profile.hco3, 282.9, 0.05, 'HCO3 = alk x 1.2193');
  // Reverse toggles land on the same canonical values.
  const back = B.normalizeReport({ sulfate: 86.9, sulfateForm: 'so4', alkalinity: 282.9, alkalinityForm: 'hco3' });
  close(back.profile.so4, 86.9, 1e-9);
  close(back.profile.alk, 232, 0.05, 'alk = HCO3 / 1.2193');
  // Nitrate as N.
  const n = B.normalizeReport({ nitrate: 10, nitrateForm: 'n' });
  close(n.profile.no3, 44.27, 0.01, 'NO3 = N x 62.004/14.007');
});

test('A2: a balanced Ward-style report passes the gate', () => {
  const { profile } = B.normalizeReport({
    ca: 84, mg: 26, na: 31, cl: 42,
    sulfate: 29, sulfateForm: 's', alkalinity: 232, alkalinityForm: 'caco3', hardness: 318
  });
  const bal = B.chargeBalance(profile);
  close(bal.cations, 7.680, 0.001, 'sum cations');
  close(bal.anions, 7.630, 0.001, 'sum anions');
  close(bal.imbalancePct, 0.3, 0.05, 'imbalance %');
  assert.equal(bal.verdict, 'balanced');
  close(B.residualAlkalinity(profile.alk, profile.ca, profile.mg), 156.8, 0.05, 'RA');
});

test('A3: hardness cross-check agrees, and a doctored value flags', () => {
  const ok = B.hardnessCheck(318, 84, 26);
  close(ok.computed, 316.8, 0.1, '84 x 2.4973 + 26 x 4.1180');
  assert.equal(ok.flagged, false);
  const doctored = B.hardnessCheck(250, 84, 26);
  assert.equal(doctored.flagged, true);
});

test('A4: a badly unbalanced report fails the gate', () => {
  const { profile } = B.normalizeReport({
    ca: 84, mg: 26, na: 31, cl: 120,
    sulfate: 29, sulfateForm: 's', alkalinity: 232, alkalinityForm: 'caco3'
  });
  const bal = B.chargeBalance(profile);
  assert.ok(Math.abs(bal.imbalancePct) > 10, `imbalance ${bal.imbalancePct}`);
  assert.equal(bal.verdict, 'does-not-balance');
});

test('charge balance: caution band and the RO skip', () => {
  const { profile } = B.normalizeReport({
    ca: 84, mg: 26, na: 31, cl: 76,
    sulfate: 29, sulfateForm: 's', alkalinity: 232, alkalinityForm: 'caco3'
  });
  assert.equal(B.chargeBalance(profile).verdict, 'caution');
  const ro = B.chargeBalance({ ca: 0, mg: 0, na: 0, cl: 0, so4: 0, alk: 0 });
  assert.equal(ro.meaningful, false);
  assert.equal(ro.verdict, 'skipped');
});

test('paste parser extracts labelled values and their forms', () => {
  const text = [
    'Calcium (Ca) 84', 'Magnesium (Mg) 26', 'Sodium (Na) 31',
    'Sulfur (S) 29', 'Chloride (Cl) 42', 'Alkalinity as CaCO3 232',
    'Total Hardness as CaCO3 318', 'pH 7.4'
  ].join('\n');
  const parsed = B.parseReportText(text);
  assert.equal(parsed.values.ca, 84);
  assert.equal(parsed.values.sulfate, 29);
  assert.equal(parsed.forms.sulfateForm, 's');
  assert.equal(parsed.values.alkalinity, 232);
  assert.equal(parsed.forms.alkalinityForm, 'caco3');
  assert.equal(parsed.values.hardness, 318);
  assert.equal(parsed.values.ph, 7.4);
  // And the parsed grid normalizes to the A2 profile.
  const { profile } = B.normalizeReport({ ...parsed.values, ...parsed.forms });
  close(profile.so4, 86.9, 0.05);
  assert.equal(B.chargeBalance(profile).verdict, 'balanced');
});

test('advisory flags fire on the stated thresholds only', () => {
  const flags = B.reportAdvisories({ ca: 84, mg: 26, na: 200, cl: 300, so4: 450, alk: 250, fe: 0.2 });
  assert.deepEqual(flags.map(f => f.code), ['na-high', 'alk-high', 'fe-high', 'so4-high', 'cl-high']);
  assert.deepEqual(B.reportAdvisories({ ca: 50, mg: 10, na: 20, cl: 40, so4: 60, alk: 100, fe: 0.05 }), []);
});

test('report input validation', () => {
  assert.throws(() => B.normalizeReport({ ca: -1 }), /negative/);
  assert.throws(() => B.normalizeReport({ sulfate: NaN }), /finite/);
});
