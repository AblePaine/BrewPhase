// Shared constants: atomic weights, molar masses, unit conversions.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../assets/brewphase.js');

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);

test('atomic-weight table matches the family table exactly', () => {
  assert.deepEqual({ ...B.AW }, {
    N: 14.007, O: 15.999, Na: 22.990, K: 39.098, Mg: 24.305,
    Ca: 40.078, S: 32.06, C: 12.011, H: 1.008, Cl: 35.45
  });
  assert.ok(Object.isFrozen(B.AW));
});

test('salt molar masses from the table (hand-computed)', () => {
  close(B.M.H2O, 18.015, 1e-9, 'H2O');
  close(B.M.gypsum, 172.164, 1e-9, 'CaSO4·2H2O');
  close(B.M.calciumChloride, 147.008, 1e-9, 'CaCl2·2H2O');
  close(B.M.epsom, 246.466, 1e-9, 'MgSO4·7H2O');
  close(B.M.bakingSoda, 84.006, 1e-9, 'NaHCO3');
  close(B.M.chalk, 100.086, 1e-9, 'CaCO3');
  close(B.M.SO4, 96.056, 1e-9, 'SO4');
  close(B.M.HCO3, 61.016, 1e-9, 'HCO3');
  close(B.M.CO2, 44.009, 1e-9, 'CO2');
  close(B.M.glucose, 180.156, 1e-9, 'glucose');
  close(B.M.sucrose, 342.297, 1e-9, 'sucrose');
});

test('molarMass rejects unknown elements', () => {
  assert.throws(() => B.molarMass({ Xx: 1 }), /Unknown element/);
});

test('alkalinity equivalent weight and bicarbonate conversion', () => {
  close(B.EQ_CACO3, 50.043, 1e-9);
  close(B.alkToHco3(100), 121.93, 0.01);
  close(B.hco3ToAlk(B.alkToHco3(77)), 77, 1e-9);
});

test('unit conversions', () => {
  close(B.units.galToL(1), 3.785411784, 1e-12);
  close(B.units.lToGal(B.units.galToL(5)), 5, 1e-12);
  close(B.units.lbToKg(1), 0.45359237, 1e-12);
  close(B.units.gToOz(28.349523125), 1, 1e-12);
  close(B.units.cToF(20), 68, 1e-12);
  close(B.units.fToC(212), 100, 1e-12);
  close(B.units.ebcToLovibond(B.units.lovibondToEbc(40)), 40, 1e-9);
});
