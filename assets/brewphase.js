/*
 * BrewPhase shared formula module.
 *
 * Every number a calculator page shows comes from a function in this file.
 * The pages only collect inputs and format outputs. Node tests in tests/
 * exercise these functions directly.
 *
 * Conventions
 *   - Ion concentrations are mg/L (== ppm for dilute water).
 *   - "Alkalinity" is total alkalinity expressed as mg/L as CaCO3, the unit
 *     most water reports use. Bicarbonate ppm is derived from it.
 *   - Volumes inside the math are litres; masses are grams; temperatures
 *     inside the priming math are degrees Fahrenheit (the unit the source
 *     fit was published in). Unit helpers below convert.
 *   - Figures that are measured, fitted, or disputed are marked FLAG in the
 *     comments and listed in SPEC.md. Pages footnote them.
 *
 * Works as a browser global (window.BrewPhase) and as a CommonJS module.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BrewPhase = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Shared family atomic-weight table (g/mol). Do not edit per-site.
  // ---------------------------------------------------------------------
  var AW = Object.freeze({
    N: 14.007, O: 15.999, Na: 22.990, K: 39.098, Mg: 24.305,
    Ca: 40.078, S: 32.06, C: 12.011, H: 1.008, Cl: 35.45,
    // P added 2026-11 for engine 6: phosphoric acid's molar mass needs it.
    // This is the one addition to the shared table; see SPEC.md section 6.
    P: 30.974
  });

  // Molar mass from an element-count map, e.g. {Ca:1, S:1, O:4}.
  function molarMass(formula) {
    var m = 0;
    for (var el in formula) {
      if (!Object.prototype.hasOwnProperty.call(formula, el)) continue;
      if (!(el in AW)) throw new Error('Unknown element: ' + el);
      m += AW[el] * formula[el];
    }
    return m;
  }

  var M = {};
  M.H2O = molarMass({ H: 2, O: 1 });                         // 18.015
  M.SO4 = molarMass({ S: 1, O: 4 });                         // 96.056
  M.HCO3 = molarMass({ H: 1, C: 1, O: 3 });                  // 61.016
  M.CO2 = molarMass({ C: 1, O: 2 });                         // 44.009
  M.CaCO3 = molarMass({ Ca: 1, C: 1, O: 3 });                // 100.086
  M.gypsum = molarMass({ Ca: 1, S: 1, O: 4 }) + 2 * M.H2O;   // CaSO4·2H2O  172.164
  M.calciumChloride = molarMass({ Ca: 1, Cl: 2 }) + 2 * M.H2O; // CaCl2·2H2O 147.008
  M.epsom = molarMass({ Mg: 1, S: 1, O: 4 }) + 7 * M.H2O;    // MgSO4·7H2O  246.466
  M.bakingSoda = molarMass({ Na: 1, H: 1, C: 1, O: 3 });     // NaHCO3      84.006
  M.chalk = M.CaCO3;                                         // CaCO3      100.086
  M.glucose = molarMass({ C: 6, H: 12, O: 6 });              // 180.156
  M.glucoseMonohydrate = M.glucose + M.H2O;                  // 198.171
  M.sucrose = molarMass({ C: 12, H: 22, O: 11 });            // 342.297
  // Engine 6 (water solver) additions.
  M.calciumChlorideAnhydrous = molarMass({ Ca: 1, Cl: 2 });  // CaCl2       110.978
  M.sodiumChloride = molarMass({ Na: 1, Cl: 1 });            // NaCl         58.440
  M.slakedLime = molarMass({ Ca: 1, O: 2, H: 2 });           // Ca(OH)2      74.092
  M.lacticAcid = molarMass({ C: 3, H: 6, O: 3 });            // C3H6O3       90.078
  M.phosphoricAcid = molarMass({ H: 3, P: 1, O: 4 });        // H3PO4        97.994
  Object.freeze(M);

  // Alkalinity "as CaCO3" counts equivalents: CaCO3 carries 2 eq/mol, so
  // 1 meq of alkalinity == M(CaCO3)/2 mg of CaCO3 == 50.043 mg.
  var EQ_CACO3 = M.CaCO3 / 2;

  // ---------------------------------------------------------------------
  // Unit helpers
  // ---------------------------------------------------------------------
  var L_PER_USGAL = 3.785411784;     // exact by definition
  var G_PER_OZ = 28.349523125;       // exact (avoirdupois)
  var G_PER_LB = 453.59237;          // exact
  var units = {
    galToL: function (g) { return g * L_PER_USGAL; },
    lToGal: function (l) { return l / L_PER_USGAL; },
    lbToKg: function (lb) { return lb * G_PER_LB / 1000; },
    gToOz: function (g) { return g / G_PER_OZ; },
    cToF: function (c) { return c * 9 / 5 + 32; },
    fToC: function (f) { return (f - 32) * 5 / 9; },
    // Morey (1994): SRM = 1.3546 * °L - 0.76  ->  °L = (SRM + 0.76) / 1.3546
    // EBC = 1.97 * SRM (standard conversion). FLAG: both are approximations
    // that drift for very dark malts; fine for classifying a grist.
    ebcToLovibond: function (ebc) { return (ebc / 1.97 + 0.76) / 1.3546; },
    lovibondToEbc: function (l) { return (1.3546 * l - 0.76) * 1.97; }
  };

  function num(x) { return typeof x === 'number' && isFinite(x); }
  function req(x, name) {
    if (!num(x)) throw new Error(name + ' must be a finite number');
    return x;
  }

  // =====================================================================
  // 1. BREWING LIQUOR BUILDER
  // =====================================================================
  //
  // Each salt, dissolved at 1 mg/L, contributes (ion mass fraction) mg/L of
  // each ion. Mass fraction = (ion molar mass * count) / salt molar mass.
  //
  // Alkalinity contribution (mg/L as CaCO3 per mg/L salt):
  //   NaHCO3: 1 eq/mol  -> EQ_CACO3 / M(NaHCO3)          = 0.5957
  //   CaCO3 : 2 eq/mol  -> 2 * EQ_CACO3 / M(CaCO3)        = 1.0000
  //
  // Five salts, six targets: the system is overdetermined, so the builder
  // solves in a fixed order where each salt is the ONLY source of one ion:
  //   Mg   <- Epsom only            -> Epsom dose fixed by Mg target
  //   Na   <- baking soda only      -> baking soda fixed by Na target
  //   Cl   <- calcium chloride only -> CaCl2 fixed by Cl target
  //   SO4  <- Epsom + gypsum        -> gypsum covers what Epsom left
  //   Alk  <- baking soda + chalk   -> chalk covers what baking soda left
  //   Ca   <- gypsum + CaCl2 + chalk -> RESULT, not solved
  // Calcium is therefore an output: it is whatever the other five targets
  // imply. The page shows the target-vs-result gap instead of hiding it.
  // If a "remaining" amount goes negative the salt is set to zero and the
  // overshoot is reported.
  var SALTS = Object.freeze({
    gypsum: {
      name: 'Gypsum', formula: 'CaSO₄·2H₂O', molarMass: M.gypsum,
      ions: { ca: AW.Ca / M.gypsum, so4: M.SO4 / M.gypsum }, alk: 0
    },
    calciumChloride: {
      name: 'Calcium chloride', formula: 'CaCl₂·2H₂O', molarMass: M.calciumChloride,
      ions: { ca: AW.Ca / M.calciumChloride, cl: 2 * AW.Cl / M.calciumChloride }, alk: 0
    },
    epsom: {
      name: 'Epsom salt', formula: 'MgSO₄·7H₂O', molarMass: M.epsom,
      ions: { mg: AW.Mg / M.epsom, so4: M.SO4 / M.epsom }, alk: 0
    },
    bakingSoda: {
      name: 'Baking soda', formula: 'NaHCO₃', molarMass: M.bakingSoda,
      ions: { na: AW.Na / M.bakingSoda }, alk: EQ_CACO3 / M.bakingSoda
    },
    chalk: {
      name: 'Chalk', formula: 'CaCO₃', molarMass: M.chalk,
      ions: { ca: AW.Ca / M.chalk }, alk: 2 * EQ_CACO3 / M.chalk
    }
  });
  var SALT_ORDER = ['gypsum', 'calciumChloride', 'epsom', 'bakingSoda', 'chalk'];
  var IONS = ['ca', 'mg', 'na', 'cl', 'so4', 'alk'];

  // Bicarbonate ppm from alkalinity as CaCO3. Valid when essentially all
  // alkalinity is bicarbonate, i.e. water pH below ~8.3 (true for brewing
  // liquor built from RO/distilled water plus these salts).
  function alkToHco3(alk) { return alk * M.HCO3 / EQ_CACO3; }
  function hco3ToAlk(hco3) { return hco3 * EQ_CACO3 / M.HCO3; }

  // Resulting profile (mg/L) from salt concentrations in mg/L.
  function profileFromSalts(mgPerL) {
    var p = { ca: 0, mg: 0, na: 0, cl: 0, so4: 0, alk: 0 };
    SALT_ORDER.forEach(function (k) {
      var c = mgPerL[k] || 0, s = SALTS[k];
      for (var ion in s.ions) p[ion] += c * s.ions[ion];
      p.alk += c * s.alk;
    });
    p.hco3 = alkToHco3(p.alk);
    return p;
  }

  function buildLiquor(target, volumeL) {
    req(volumeL, 'volumeL');
    if (volumeL <= 0) throw new Error('volumeL must be > 0');
    var t = {};
    IONS.forEach(function (k) {
      var v = target[k] == null ? 0 : req(target[k], k);
      if (v < 0) throw new Error(k + ' target cannot be negative');
      t[k] = v;
    });
    var warnings = [];
    var c = {}; // mg/L of each salt

    c.epsom = t.mg / SALTS.epsom.ions.mg;
    c.bakingSoda = t.na / SALTS.bakingSoda.ions.na;
    c.calciumChloride = t.cl / SALTS.calciumChloride.ions.cl;

    var so4Left = t.so4 - c.epsom * SALTS.epsom.ions.so4;
    // 1 mg/L slack so rounding in a preset doesn't trigger a warning.
    if (so4Left < -1) {
      warnings.push({ code: 'so4-over', amount: -so4Left,
        text: 'Your magnesium target already supplies ' + (-so4Left).toFixed(0) +
          ' mg/L more sulfate than you asked for (Epsom salt carries both). No gypsum added.' });
    }
    so4Left = Math.max(0, so4Left);
    c.gypsum = so4Left / SALTS.gypsum.ions.so4;

    var alkLeft = t.alk - c.bakingSoda * SALTS.bakingSoda.alk;
    if (alkLeft < -1) {
      warnings.push({ code: 'alk-over', amount: -alkLeft,
        text: 'Your sodium target already supplies ' + (-alkLeft).toFixed(0) +
          ' mg/L more alkalinity than you asked for (baking soda carries both). No chalk added.' });
    }
    alkLeft = Math.max(0, alkLeft);
    c.chalk = alkLeft / SALTS.chalk.alk;

    var result = profileFromSalts(c);
    var caGap = result.ca - t.ca;
    // Tolerance: 5 mg/L or 10 %, whichever is larger. A pure display rule.
    if (Math.abs(caGap) > Math.max(5, 0.1 * t.ca)) {
      warnings.push({ code: 'ca-gap', amount: caGap,
        text: 'Calcium comes out at ' + result.ca.toFixed(0) + ' mg/L, not ' + t.ca.toFixed(0) +
          '. With these five salts, calcium is set by your chloride, sulfate and alkalinity targets. ' +
          'To move calcium, move one of those.' });
    }
    if (c.chalk > 0) {
      warnings.push({ code: 'chalk', amount: c.chalk,
        text: 'Chalk barely dissolves in plain water. Add it straight to the mash, and expect it to ' +
          'deliver less alkalinity than the math says (see footnote).' });
    }

    var grams = {};
    SALT_ORDER.forEach(function (k) { grams[k] = c[k] * volumeL / 1000; });
    return { grams: grams, mgPerL: c, result: result, target: t, warnings: warnings };
  }

  // =====================================================================
  // 2. MASH pH ESTIMATOR  (simplified — an ESTIMATE, never a measurement)
  // =====================================================================
  //
  // Model: each malt behaves like a buffer that, mashed alone in distilled
  // water, settles at its own "distilled-water pH" (pH_DI). The mash settles
  // where the malts' buffering and the water's alkalinity balance:
  //
  //   Σ_i B·m_i·(pH − pH_DI,i) = RA_meq
  //
  // B       buffering capacity, meq per kg per pH unit (same for all malts)
  // m_i     malt mass, kg
  // RA_meq  residual alkalinity of the mash water in meq
  //         = RA (mg/L as CaCO3) / 50.043 × mash water litres
  //
  // Solving:  pH = Σ(m_i·pH_DI,i)/Σm_i  +  RA_meq / (B·Σm_i)
  //
  // Calibration values (FLAG — all approximate; see SPEC.md):
  //  * B = 38 meq/(kg·pH). Derived from Kolbach's rule that residual
  //    alkalinity of 10 °dH (178 mg/L as CaCO3) raises mash pH by ~0.3 at
  //    ~3 L/kg: 178/50.043 × 3 / 0.3 ≈ 36; Troester's measured base-malt
  //    buffering clusters in the high 30s to 40s. 38 splits the difference.
  //  * Base malt pH_DI = 5.80 − 0.028·°L. Pale malt (~2 °L) → 5.74,
  //    Munich (~10 °L) → 5.52, in line with published distilled-water mash
  //    measurements (Troester 2009, Palmer & Kaminski 2013).
  //  * Crystal/caramel pH_DI = 5.22 − 0.00504·°L (Troester's fit across
  //    caramel malts 10–120 °L).
  //  * Roast malt pH_DI = 4.70 regardless of colour. Measured values span
  //    ~4.5–4.9; this is the weakest parameter and the model can read high
  //    for grists heavy in roast.
  // Full models (Bru'n Water, etc.) use per-malt titration data, acid
  // additions, mash thickness effects on buffering, and more.
  var MASH = Object.freeze({
    bufferCapacity: 38,
    baseMaxLovibond: 30,
    targetLow: 5.2,
    targetHigh: 5.6
  });

  function maltDistilledPH(type, lovibond) {
    req(lovibond, 'lovibond');
    if (lovibond < 0) throw new Error('Color cannot be negative');
    if (type === 'base') return 5.80 - 0.028 * lovibond;
    if (type === 'crystal') return 5.22 - 0.00504 * lovibond;
    if (type === 'roast') return 4.70;
    throw new Error('Unknown malt type: ' + type);
  }

  // Kolbach residual alkalinity, ion ppm form:
  //   RA(°dH) = Alk − CaH/3.5 − MgH/7   (all as hardness/alkalinity units)
  // Converting Ca and Mg ppm to "as CaCO3": × M(CaCO3)/AW(Ca|Mg).
  //   Ca: 100.086/40.078/3.5 = 1/1.4016  ->  Ca/1.40
  //   Mg: 100.086/24.305/7   = 1/1.7000  ->  Mg/1.70
  function residualAlkalinity(alk, ca, mg) {
    req(alk, 'alkalinity'); req(ca, 'calcium'); req(mg, 'magnesium');
    return alk - ca * (M.CaCO3 / AW.Ca) / 3.5 - mg * (M.CaCO3 / AW.Mg) / 7;
  }

  function estimateMashPH(opts) {
    var malts = opts.malts || [];
    var ra = req(opts.residualAlkalinity, 'residualAlkalinity');
    var waterL = req(opts.waterL, 'waterL');
    if (waterL <= 0) throw new Error('Mash water volume must be > 0');
    var totalKg = 0, weighted = 0, warnings = [];
    malts.forEach(function (m) {
      req(m.kg, 'malt weight');
      if (m.kg < 0) throw new Error('Malt weight cannot be negative');
      if (m.kg === 0) return;
      if (m.type === 'base' && m.lovibond > MASH.baseMaxLovibond) {
        warnings.push({ code: 'dark-base',
          text: 'A ' + m.lovibond + ' °L base malt is outside the model. Enter it as crystal or roast.' });
      }
      totalKg += m.kg;
      weighted += m.kg * maltDistilledPH(m.type, m.lovibond);
    });
    if (totalKg <= 0) throw new Error('Add at least one malt with weight above zero');
    var grainPH = weighted / totalKg;
    var raMeq = ra / EQ_CACO3 * waterL;
    var shift = raMeq / (MASH.bufferCapacity * totalKg);
    var ph = grainPH + shift;
    var litresPerKg = waterL / totalKg;
    if (litresPerKg < 2 || litresPerKg > 5) {
      warnings.push({ code: 'thickness',
        text: 'Mash thickness of ' + litresPerKg.toFixed(1) + ' L/kg is outside the 2–5 L/kg range ' +
          'the model was calibrated around.' });
    }
    var status = ph < MASH.targetLow ? 'low' : ph > MASH.targetHigh ? 'high' : 'in-range';
    return { ph: ph, grainPH: grainPH, waterShift: shift, raMeq: raMeq,
      totalKg: totalKg, litresPerKg: litresPerKg, status: status, warnings: warnings };
  }

  // =====================================================================
  // 3. CHLORIDE : SULFATE RATIO
  // =====================================================================
  //
  // Ratio = Cl (mg/L) / SO4 (mg/L), by mass, the way homebrew literature
  // quotes it. FLAG: the bands and style ranges below are guidance drawn
  // from common homebrew practice (Palmer & Kaminski, "Water", 2013, and
  // widely circulated charts). Some water authorities (e.g. Brungard)
  // argue absolute levels matter more than the ratio. The ratio says little
  // when both ions are low, so the page warns below LOW_TOTAL.
  var RATIO_BANDS = Object.freeze([
    { max: 0.5, label: 'Very bitter', note: 'Sulfate-forward. Crisp, dry, hop bitterness pushed up front.' },
    { max: 0.77, label: 'Bitter', note: 'Leans toward hop bite and a drier finish.' },
    { max: 1.3, label: 'Balanced', note: 'Neither malt nor hops pushed.' },
    { max: 2.0, label: 'Malty', note: 'Rounder, fuller, softer bitterness.' },
    { max: Infinity, label: 'Very malty', note: 'Chloride-forward. Soft, full, sweet-leaning.' }
  ]);
  var STYLE_RATIOS = Object.freeze([
    { style: 'West Coast / American IPA', low: 0.2, high: 0.5 },
    { style: 'American pale ale', low: 0.4, high: 0.8 },
    { style: 'English bitter / pale ale', low: 0.5, high: 1.0 },
    { style: 'Pilsner / pale lager', low: 0.8, high: 1.5 },
    { style: 'Amber / red ale', low: 0.8, high: 1.5 },
    { style: 'Brown ale / porter', low: 1.0, high: 2.0 },
    { style: 'Stout', low: 1.0, high: 2.0 },
    { style: 'Märzen / bock / malty lager', low: 1.2, high: 2.0 },
    { style: 'Hazy / New England IPA', low: 1.5, high: 3.0 }
  ]);
  var LOW_TOTAL = 50; // mg/L Cl + SO4 below which the ratio is not meaningful

  function chlorideSulfate(cl, so4) {
    req(cl, 'chloride'); req(so4, 'sulfate');
    if (cl < 0 || so4 < 0) throw new Error('Ion values cannot be negative');
    if (so4 === 0 && cl === 0) return { ratio: null, band: null, lowTotal: true };
    var ratio = so4 === 0 ? Infinity : cl / so4;
    var band = null;
    for (var i = 0; i < RATIO_BANDS.length; i++) {
      if (ratio < RATIO_BANDS[i].max || RATIO_BANDS[i].max === Infinity) { band = RATIO_BANDS[i]; break; }
    }
    return { ratio: ratio, band: band, lowTotal: cl + so4 < LOW_TOTAL };
  }

  function styleFit(ratio, style) {
    if (ratio === null) return null;
    if (ratio < style.low) return 'below';
    if (ratio > style.high) return 'above';
    return 'within';
  }

  // =====================================================================
  // 4. WATER BLENDING
  // =====================================================================
  //
  // Concentration is conserved by mass balance. Mixing a fraction f of tap
  // water with (1 − f) of diluent (RO/distilled):
  //   C_mix = f·C_tap + (1 − f)·C_dil
  // Solving for the f that hits a target on one ion:
  //   f = (C_target − C_dil) / (C_tap − C_dil)
  // Valid only for 0 ≤ f ≤ 1: you cannot dilute above the tap value or
  // below the diluent value. The diluent defaults to all zeros (distilled);
  // RO output usually carries a little of everything, so it can be entered.
  var BLEND_IONS = ['ca', 'mg', 'na', 'cl', 'so4', 'alk'];

  function blendProfile(tap, diluent, tapFraction) {
    req(tapFraction, 'tapFraction');
    if (tapFraction < 0 || tapFraction > 1) throw new Error('Tap fraction must be between 0 and 1');
    var out = {};
    BLEND_IONS.forEach(function (k) {
      var a = tap[k] || 0, b = (diluent && diluent[k]) || 0;
      out[k] = tapFraction * a + (1 - tapFraction) * b;
    });
    out.hco3 = alkToHco3(out.alk);
    return out;
  }

  function solveBlend(tapValue, diluentValue, targetValue) {
    req(tapValue, 'tap value'); req(diluentValue, 'diluent value'); req(targetValue, 'target');
    var lo = Math.min(tapValue, diluentValue), hi = Math.max(tapValue, diluentValue);
    if (tapValue === diluentValue) {
      return { ok: targetValue === tapValue, tapFraction: targetValue === tapValue ? 1 : null,
        reason: 'Tap and diluent have the same value for this ion, so blending cannot change it.' };
    }
    if (targetValue < lo || targetValue > hi) {
      return { ok: false, tapFraction: null,
        reason: 'Target must sit between the diluent (' + diluentValue + ') and tap (' + tapValue +
          ') values. Blending can only land in between.' };
    }
    return { ok: true, tapFraction: (targetValue - diluentValue) / (tapValue - diluentValue) };
  }

  // =====================================================================
  // 5. PRIMING SUGAR
  // =====================================================================
  //
  // Step 1 — residual CO2 already dissolved (volumes), from the warmest
  // temperature the beer reached after fermentation finished, at 1 atm:
  //   V = 3.0378 − 0.050062·T + 0.00026555·T²      (T in °F)
  // This quadratic is the fit to CO2 solubility tables that nearly every
  // homebrew priming calculator uses (fit valid ~32–80 °F / 0–27 °C).
  // FLAG: altitude (lower pressure) and the "warmest temperature" rule are
  // both approximations; the page footnotes them.
  //
  // Step 2 — CO2 to add = target − residual (volumes). One "volume" is the
  // beer's own volume of CO2 gas at 0 °C and 1 atm, so
  //   g CO2 per litre per volume = M(CO2) / 22.414 L/mol = 1.9635 g/L
  //
  // Step 3 — fermentation stoichiometry: C6H12O6 → 2 C2H5OH + 2 CO2
  //   g CO2 per g glucose = 2·M(CO2)/M(glucose) = 0.48857
  //   => glucose needed = 1.9635 / 0.48857 = 4.019 g per litre per volume
  // Assumes all sugar goes to ethanol + CO2; yeast divert a few percent to
  // biomass and by-products, which is inside the noise of the other inputs.
  //
  // Step 4 — divide by the sugar's glucose-equivalent factor (g of glucose
  // the yeast actually get per g of product). See SUGARS.
  var MOLAR_VOLUME_STP = 22.414;           // L/mol, ideal gas, 0 °C, 1 atm
  var CO2_G_PER_L_PER_VOL = M.CO2 / MOLAR_VOLUME_STP;
  var CO2_PER_GLUCOSE = 2 * M.CO2 / M.glucose;
  var GLUCOSE_G_PER_L_PER_VOL = CO2_G_PER_L_PER_VOL / CO2_PER_GLUCOSE;

  var PRIMING = Object.freeze({
    warnAbove: 3.5,   // heavy-bottle territory: ordinary bottles risk failure
    refuseAbove: 4.0, // BrewPhase will not compute above this
    fitMinF: 32,
    fitMaxF: 80
  });

  // glucoseEq: grams of fermentable glucose-equivalent per gram of product.
  var SUGARS = Object.freeze({
    dextrose: {
      name: 'Dextrose (corn sugar)',
      // Brewing "corn sugar" is normally dextrose MONOHYDRATE: 1 H2O per
      // glucose, so only M(glucose)/M(monohydrate) of each gram is sugar.
      glucoseEq: M.glucose / M.glucoseMonohydrate, // 0.9091
      flag: false
    },
    dextroseAnhydrous: {
      name: 'Dextrose, anhydrous',
      glucoseEq: 1,
      flag: false
    },
    tableSugar: {
      name: 'Table sugar (sucrose)',
      // Yeast invert sucrose first: C12H22O11 + H2O → 2 C6H12O6, so each
      // gram of sucrose yields 2·M(glucose)/M(sucrose) g of hexose.
      glucoseEq: 2 * M.glucose / M.sucrose,        // 1.0526
      flag: false
    },
    dme: {
      name: 'Dry malt extract (DME)',
      // FLAG: 0.97 solids × 0.68 fermentable × 1.0526 (maltose, like
      // sucrose, gains a water on hydrolysis) = 0.694. Fermentability of
      // DME varies by product and lot, roughly 0.60–0.75 of solids.
      glucoseEq: 0.97 * 0.68 * (2 * M.glucose / M.sucrose),
      flag: true
    },
    honey: {
      name: 'Honey',
      // FLAG: honey is ~17–18 % water; sugars (mostly fructose and glucose,
      // both C6H12O6, glucose-equivalent 1:1) are ~80–82 % and ~95 %
      // fermentable. 0.82 × 0.95 = 0.779. Varies by source and moisture.
      glucoseEq: 0.82 * 0.95,
      flag: true
    }
  });

  function residualCO2(tempF) {
    req(tempF, 'temperature');
    return 3.0378 - 0.050062 * tempF + 0.00026555 * tempF * tempF;
  }

  function primingSugar(opts) {
    var target = req(opts.targetVolumes, 'target CO2 volumes');
    var beerL = req(opts.beerL, 'beer volume');
    var tempF = req(opts.tempF, 'temperature');
    var sugar = SUGARS[opts.sugar];
    if (!sugar) throw new Error('Unknown sugar: ' + opts.sugar);
    if (beerL <= 0) throw new Error('Beer volume must be > 0');
    if (target <= 0) throw new Error('Target CO2 volumes must be > 0');

    var warnings = [];
    if (target > PRIMING.refuseAbove) {
      return { status: 'refused', grams: null, target: target, warnings: [{ code: 'refused',
        text: 'BrewPhase will not calculate above ' + PRIMING.refuseAbove.toFixed(1) +
          ' volumes. That pressure can burst bottles, including many sold as heavy-duty.' }] };
    }
    if (tempF < PRIMING.fitMinF || tempF > PRIMING.fitMaxF) {
      warnings.push({ code: 'temp-range',
        text: 'Temperature is outside the 32–80 °F (0–27 °C) range the residual-CO₂ formula covers. ' +
          'Treat the result with caution.' });
    }
    var residual = residualCO2(tempF);
    var add = target - residual;
    if (add <= 0) {
      return { status: 'none', grams: 0, residual: residual, addVolumes: add, target: target,
        warnings: warnings.concat([{ code: 'already',
          text: 'The beer already holds about ' + residual.toFixed(2) + ' volumes at this temperature. ' +
            'No priming sugar needed for this target.' }]) };
    }
    var glucoseG = add * beerL * GLUCOSE_G_PER_L_PER_VOL;
    var grams = glucoseG / sugar.glucoseEq;
    var status = 'ok';
    if (target > PRIMING.warnAbove) {
      status = 'warn';
      warnings.push({ code: 'high',
        text: 'Above ' + PRIMING.warnAbove.toFixed(1) + ' volumes, standard bottles can fail. Use bottles ' +
          'rated for high carbonation, and store them where a burst cannot hurt anyone.' });
    }
    return { status: status, grams: grams, gramsPerLitre: grams / beerL, residual: residual,
      addVolumes: add, glucoseG: glucoseG, target: target, warnings: warnings };
  }

  // Carbonation guidance by style (volumes CO2). FLAG: tradition and taste,
  // not physics; published ranges differ by a few tenths.
  var CARB_STYLES = Object.freeze([
    { style: 'British cask-style ales', low: 1.5, high: 2.0 },
    { style: 'Porter / stout', low: 1.7, high: 2.3 },
    { style: 'Most American ales', low: 2.2, high: 2.7 },
    { style: 'Lagers', low: 2.4, high: 2.8 },
    { style: 'Belgian ales', low: 2.5, high: 3.5 },
    { style: 'German wheat beer', low: 3.3, high: 4.0 }
  ]);

  // =====================================================================
  // 6. WATER SOLVER — Stage A: report ingest. Stage B: constrained solve.
  // =====================================================================
  //
  // Stage A turns a lab report (Ward-style or a municipal CCR) into a
  // normalized source profile. Reports disagree about units, and the three
  // disagreements that silently wreck a profile are:
  //   * sulfate reported as SO4-S (the sulfur only) instead of as SO4
  //   * alkalinity reported as bicarbonate instead of as CaCO3
  //   * nitrate reported as NO3-N instead of as NO3
  // Each has a form toggle; the conversions below are exact ratios of molar
  // masses from the shared table. Nothing pasted is trusted silently: the
  // parser only fills a grid the user confirms, and the charge-balance gate
  // audits the result — a real water sample is electrically neutral, so a
  // profile whose cations and anions disagree by more than ~10 % has a
  // transcription error or a missing ion somewhere.
  var EQ_WEIGHTS = Object.freeze({
    ca: AW.Ca / 2,              // 20.039 mg/meq
    mg: AW.Mg / 2,              // 12.1525
    na: AW.Na,                  // 22.990
    k: AW.K,                    // 39.098
    so4: M.SO4 / 2,             // 48.028
    cl: AW.Cl,                  // 35.450
    hco3: M.HCO3,               // 61.016
    no3: molarMass({ N: 1, O: 3 }) // 62.004
  });
  var SULFATE_FROM_S = M.SO4 / AW.S;          // 2.9964
  var NITRATE_FROM_N = EQ_WEIGHTS.no3 / AW.N; // 4.4266

  function optNum(x, name) {
    if (x == null) return null;
    req(x, name);
    if (x < 0) throw new Error(name + ' cannot be negative');
    return x;
  }

  // input: { ca, mg, na, cl, k, ph, fe, tds, hardness,
  //          sulfate, sulfateForm: 'so4'|'s',
  //          alkalinity, alkalinityForm: 'caco3'|'hco3',
  //          nitrate, nitrateForm: 'no3'|'n' }   (all values optional)
  // Returns the canonical profile: sulfate as SO4, alkalinity as CaCO3,
  // nitrate as NO3, bicarbonate derived. Missing ions come back null in
  // `present` terms — the profile carries 0 for arithmetic but `given`
  // records which fields the report actually supplied.
  function normalizeReport(input) {
    input = input || {};
    var sulfate = optNum(input.sulfate, 'sulfate');
    if (sulfate != null && input.sulfateForm === 's') sulfate = sulfate * SULFATE_FROM_S;
    var alk = optNum(input.alkalinity, 'alkalinity');
    if (alk != null && input.alkalinityForm === 'hco3') alk = hco3ToAlk(alk);
    var nitrate = optNum(input.nitrate, 'nitrate');
    if (nitrate != null && input.nitrateForm === 'n') nitrate = nitrate * NITRATE_FROM_N;
    var p = {
      ca: optNum(input.ca, 'calcium') || 0,
      mg: optNum(input.mg, 'magnesium') || 0,
      na: optNum(input.na, 'sodium') || 0,
      cl: optNum(input.cl, 'chloride') || 0,
      so4: sulfate || 0,
      alk: alk || 0,
      k: optNum(input.k, 'potassium'),
      no3: nitrate,
      ph: optNum(input.ph, 'pH'),
      fe: optNum(input.fe, 'iron'),
      tds: optNum(input.tds, 'TDS')
    };
    p.hco3 = alkToHco3(p.alk);
    return {
      profile: p,
      hardnessReported: optNum(input.hardness, 'hardness'),
      given: {
        ca: input.ca != null, mg: input.mg != null, na: input.na != null,
        cl: input.cl != null, so4: input.sulfate != null, alk: input.alkalinity != null
      }
    };
  }

  // Charge balance in meq/L. Alkalinity enters as alk / EQ_CACO3 (its meq
  // count is the same whether expressed as CaCO3 or as HCO3). The imbalance
  // denominator is the SUM of cations + anions, per the build brief.
  function chargeBalance(profile) {
    var cations = profile.ca / EQ_WEIGHTS.ca + profile.mg / EQ_WEIGHTS.mg +
      profile.na / EQ_WEIGHTS.na + (profile.k || 0) / EQ_WEIGHTS.k;
    var anions = profile.so4 / EQ_WEIGHTS.so4 + profile.cl / EQ_WEIGHTS.cl +
      profile.alk / EQ_CACO3 + (profile.no3 || 0) / EQ_WEIGHTS.no3;
    var total = cations + anions;
    var imbalancePct = total > 0 ? (cations - anions) / total * 100 : 0;
    // Below 0.5 meq/L of cations there is almost nothing to balance
    // (RO-class water); the percentage is noise, so the gate is skipped.
    var meaningful = cations >= 0.5;
    var verdict = 'skipped';
    if (meaningful) {
      var a = Math.abs(imbalancePct);
      verdict = a <= 5 ? 'balanced' : a <= 10 ? 'caution' : 'does-not-balance';
    }
    return { cations: cations, anions: anions, imbalancePct: imbalancePct,
      verdict: verdict, meaningful: meaningful };
  }

  // Total hardness as CaCO3 from the divalent cations: Ca and Mg ppm each
  // scale by M(CaCO3)/AW(ion) = 2.4973 and 4.1180.
  function computedHardness(ca, mg) {
    req(ca, 'calcium'); req(mg, 'magnesium');
    return ca * (M.CaCO3 / AW.Ca) + mg * (M.CaCO3 / AW.Mg);
  }

  function hardnessCheck(reported, ca, mg) {
    var computed = computedHardness(ca, mg);
    if (reported == null) return { computed: computed, reported: null, delta: null, flagged: false };
    var delta = reported - computed;
    return { computed: computed, reported: reported, delta: delta,
      flagged: Math.abs(delta) > Math.max(10, 0.10 * computed) };
  }

  // Advisory flags: shown, never blocking (same posture as engine 3).
  function reportAdvisories(profile) {
    var out = [];
    if (profile.na > 150) out.push({ code: 'na-high',
      text: 'Sodium above 150 mg/L: high for most styles; blending or RO is the usual fix.' });
    if (profile.alk > 200) out.push({ code: 'alk-high',
      text: 'Alkalinity above 200 mg/L as CaCO₃: pale styles will need dilution or acid.' });
    if (profile.fe != null && profile.fe > 0.1) out.push({ code: 'fe-high',
      text: 'Iron above 0.1 mg/L: a flavour problem (metallic, inky) at quite low levels.' });
    if (profile.so4 > 400) out.push({ code: 'so4-high',
      text: 'Sulfate above 400 mg/L: harsh, dry bitterness territory for most styles.' });
    if (profile.cl > 250) out.push({ code: 'cl-high',
      text: 'Chloride above 250 mg/L: past the point where it just reads as fullness.' });
    return out;
  }

  // Best-effort label matcher for pasted report text. Returns raw grid
  // values plus the form each value arrived in; the page drops them into
  // the editable grid for the user to confirm. Unmatched fields stay out.
  function parseReportText(text) {
    var values = {}, forms = {}, found = [];
    function set(key, v, formKey, formVal) {
      if (values[key] != null) return;
      values[key] = v; found.push(key);
      if (formKey) forms[formKey] = formVal;
    }
    String(text == null ? '' : text).split(/\r?\n/).forEach(function (line) {
      // The value is the LAST number on the line: labels carry their own
      // digits (CaCO3, SO4), and those must not be read as the result.
      var all = line.match(/-?\d+(\.\d+)?/g);
      if (!all) return;
      var v = parseFloat(all[all.length - 1]), L = line.toLowerCase();
      if (/total dissolved solids|\btds\b/.test(L)) set('tds', v);
      else if (/hardness/.test(L)) set('hardness', v);
      else if (/bicarbonate/.test(L)) set('alkalinity', v, 'alkalinityForm', 'hco3');
      else if (/alkalinity/.test(L)) set('alkalinity', v, 'alkalinityForm', 'caco3');
      else if (/sulfur|sulphur|sulfate|so4/.test(L)) set('sulfate', v, 'sulfateForm', /sulfur|sulphur|so4-?s/.test(L) ? 's' : 'so4');
      else if (/nitrate/.test(L)) set('nitrate', v, 'nitrateForm', /no3-?n|nitrate-?n/.test(L) ? 'n' : 'no3');
      else if (/calcium/.test(L)) set('ca', v);
      else if (/magnesium/.test(L)) set('mg', v);
      else if (/sodium/.test(L)) set('na', v);
      else if (/chloride/.test(L)) set('cl', v);
      else if (/potassium/.test(L)) set('k', v);
      else if (/iron/.test(L)) set('fe', v);
      else if (/(^|[^a-z])ph([^a-z]|$)/.test(L)) set('ph', v);
    });
    return { values: values, forms: forms, found: found };
  }

  // ---------------------------------------------------------------------
  // Stage B: the salt shelf, with hydrate forms LOCKED.
  //
  // Calcium chloride is sold as the dihydrate and as the anhydrous salt,
  // and they are not interchangeable: dosing anhydrous salt by dihydrate
  // math overshoots chloride by about 32 % (test B3). So the shelf lists
  // the two forms as separate salts; the user checks the one on their bag,
  // and the math uses that form's molar mass.
  //
  // Chalk is NOT on the shelf (build brief section 3.3): CaCO3 barely
  // dissolves, so its delivered alkalinity is a guess, and a solver that
  // promises per-ion residuals cannot include a guessed salt. Engine 1
  // keeps its own chalk posture (theoretical value + warning); the two
  // engines differ on purpose.
  //
  // tspDensity (g per level tsp) is a FLAGged-approximate constant set,
  // pinned by weighing (see SPEC section 6). A salt not yet weighed has
  // null here and the page prints "weigh it" instead of a spoon figure.
  var TSP_DENSITY = Object.freeze({
    gypsum: null, calciumChlorideDihydrate: null, calciumChlorideAnhydrous: null,
    epsom: null, canningSalt: null, bakingSoda: null, slakedLime: null
  });
  var SALT_FORMS = Object.freeze({
    gypsum: {
      name: 'Gypsum', formula: 'CaSO₄·2H₂O', molarMass: M.gypsum,
      ions: { ca: AW.Ca / M.gypsum, so4: M.SO4 / M.gypsum }, alk: 0,
      tspDensity: TSP_DENSITY.gypsum
    },
    calciumChlorideDihydrate: {
      name: 'Calcium chloride, dihydrate', formula: 'CaCl₂·2H₂O', molarMass: M.calciumChloride,
      ions: { ca: AW.Ca / M.calciumChloride, cl: 2 * AW.Cl / M.calciumChloride }, alk: 0,
      tspDensity: TSP_DENSITY.calciumChlorideDihydrate
    },
    calciumChlorideAnhydrous: {
      name: 'Calcium chloride, anhydrous', formula: 'CaCl₂', molarMass: M.calciumChlorideAnhydrous,
      ions: { ca: AW.Ca / M.calciumChlorideAnhydrous, cl: 2 * AW.Cl / M.calciumChlorideAnhydrous }, alk: 0,
      tspDensity: TSP_DENSITY.calciumChlorideAnhydrous
    },
    epsom: {
      name: 'Epsom salt', formula: 'MgSO₄·7H₂O', molarMass: M.epsom,
      ions: { mg: AW.Mg / M.epsom, so4: M.SO4 / M.epsom }, alk: 0,
      tspDensity: TSP_DENSITY.epsom
    },
    canningSalt: {
      name: 'Canning salt', formula: 'NaCl', molarMass: M.sodiumChloride,
      ions: { na: AW.Na / M.sodiumChloride, cl: AW.Cl / M.sodiumChloride }, alk: 0,
      tspDensity: TSP_DENSITY.canningSalt
    },
    bakingSoda: {
      name: 'Baking soda', formula: 'NaHCO₃', molarMass: M.bakingSoda,
      ions: { na: AW.Na / M.bakingSoda }, alk: EQ_CACO3 / M.bakingSoda,
      tspDensity: TSP_DENSITY.bakingSoda
    },
    slakedLime: {
      name: 'Slaked lime', formula: 'Ca(OH)₂', molarMass: M.slakedLime,
      ions: { ca: AW.Ca / M.slakedLime }, alk: 2 * EQ_CACO3 / M.slakedLime,
      tspDensity: TSP_DENSITY.slakedLime
    }
  });
  var SALT_FORM_ORDER = ['gypsum', 'calciumChlorideDihydrate', 'calciumChlorideAnhydrous',
    'epsom', 'canningSalt', 'bakingSoda', 'slakedLime'];

  // Acids reduce alkalinity only. Dosed in mL, never grams. Strength and
  // density are the labelled commercial products (FLAG: both are product
  // figures; the page footnotes them). Phosphoric is counted as 1 eq/mol:
  // at brewing pH the first proton (to H2PO4-) is the one that lands.
  // meqPerMl = density x strength / molar mass x 1000 x eq/mol.
  var ML_PER_TSP = 4.92892159375; // exact: 1 US tsp in mL
  var ACIDS = Object.freeze({
    lactic88: {
      name: 'Lactic acid, 88%', strength: 0.88, density: 1.209, molarMass: M.lacticAcid,
      eqPerMol: 1, meqPerMl: 1.209 * 0.88 / M.lacticAcid * 1000 // 11.812
    },
    phosphoric85: {
      name: 'Phosphoric acid, 85%', strength: 0.85, density: 1.685, molarMass: M.phosphoricAcid,
      eqPerMol: 1, meqPerMl: 1.685 * 0.85 / M.phosphoricAcid * 1000 // 14.616
    }
  });
  function acidMl(meq, acidKey) {
    var a = ACIDS[acidKey];
    if (!a) throw new Error('Unknown acid: ' + acidKey);
    req(meq, 'acid meq');
    return meq / a.meqPerMl;
  }

  // ---------------------------------------------------------------------
  // Non-negative least squares (Lawson-Hanson active set) with optional
  // per-variable upper bounds handled by an outer clamping loop. The
  // systems here are tiny (6 rows, at most 8 columns); no library, per the
  // house rule. Least squares on the passive set uses normal equations
  // with a whisper of ridge for rank safety.
  function solvePassiveLS(A, b, passive) {
    var cols = [];
    for (var j = 0; j < passive.length; j++) if (passive[j]) cols.push(j);
    var x = new Array(passive.length).fill(0);
    if (!cols.length) return x;
    var n = cols.length, i, r, c1, c2;
    var G = [], h = new Array(n).fill(0);
    for (r = 0; r < n; r++) {
      G.push(new Array(n).fill(0));
      for (c1 = 0; c1 < A.length; c1++) h[r] += A[c1][cols[r]] * b[c1];
      for (c2 = 0; c2 < n; c2++) {
        var s = 0;
        for (i = 0; i < A.length; i++) s += A[i][cols[r]] * A[i][cols[c2]];
        G[r][c2] = s + (r === c2 ? 1e-12 : 0);
      }
    }
    // Gaussian elimination with partial pivoting.
    for (var col = 0, row = 0; col < n && row < n; col++, row++) {
      var piv = row;
      for (var rr = row + 1; rr < n; rr++) if (Math.abs(G[rr][col]) > Math.abs(G[piv][col])) piv = rr;
      if (Math.abs(G[piv][col]) < 1e-14) { row--; continue; }
      var tmp = G[piv]; G[piv] = G[row]; G[row] = tmp;
      var th = h[piv]; h[piv] = h[row]; h[row] = th;
      for (var r2 = row + 1; r2 < n; r2++) {
        var f = G[r2][col] / G[row][col];
        for (var c3 = col; c3 < n; c3++) G[r2][c3] -= f * G[row][c3];
        h[r2] -= f * h[row];
      }
    }
    var sol = new Array(n).fill(0);
    for (var r3 = n - 1; r3 >= 0; r3--) {
      var acc = h[r3];
      for (var c4 = r3 + 1; c4 < n; c4++) acc -= G[r3][c4] * sol[c4];
      sol[r3] = Math.abs(G[r3][r3]) < 1e-14 ? 0 : acc / G[r3][r3];
    }
    cols.forEach(function (j, t) { x[j] = sol[t]; });
    return x;
  }

  function nnls(A, b) {
    var n = A[0].length, m = A.length;
    var x = new Array(n).fill(0);
    var passive = new Array(n).fill(false);
    function gradient() {
      var r = b.slice(), i, j;
      for (j = 0; j < n; j++) if (x[j] !== 0) for (i = 0; i < m; i++) r[i] -= A[i][j] * x[j];
      var w = new Array(n).fill(0);
      for (j = 0; j < n; j++) for (i = 0; i < m; i++) w[j] += A[i][j] * r[i];
      return w;
    }
    var w = gradient();
    for (var iter = 0; iter < 100; iter++) {
      var jBest = -1, wBest = 1e-10;
      for (var j = 0; j < n; j++) if (!passive[j] && w[j] > wBest) { wBest = w[j]; jBest = j; }
      if (jBest < 0) break;
      passive[jBest] = true;
      for (var inner = 0; inner < 100; inner++) {
        var s = solvePassiveLS(A, b, passive);
        var feasible = true;
        for (var k = 0; k < n; k++) if (passive[k] && s[k] <= 0) { feasible = false; break; }
        if (feasible) { x = s; break; }
        var alpha = 1;
        for (var k2 = 0; k2 < n; k2++) if (passive[k2] && s[k2] <= 0) {
          alpha = Math.min(alpha, x[k2] / (x[k2] - s[k2]));
        }
        for (var k3 = 0; k3 < n; k3++) x[k3] += alpha * (s[k3] - x[k3]);
        for (var k4 = 0; k4 < n; k4++) if (passive[k4] && x[k4] <= 1e-12) { x[k4] = 0; passive[k4] = false; }
      }
      w = gradient();
    }
    return x;
  }

  // NNLS with upper bounds: clamp the worst violator, subtract its fixed
  // contribution, and re-solve the rest. Converges in at most n rounds.
  function boundedNnls(A, b, upper) {
    var n = A[0].length;
    var fixed = new Array(n).fill(null);
    var x = new Array(n).fill(0);
    for (var round = 0; round <= n; round++) {
      var free = [], adj = b.slice(), i, j;
      for (j = 0; j < n; j++) {
        if (fixed[j] != null) { for (i = 0; i < A.length; i++) adj[i] -= A[i][j] * fixed[j]; }
        else free.push(j);
      }
      var sub = A.map(function (rowArr) { return free.map(function (jj) { return rowArr[jj]; }); });
      var sx = free.length ? nnls(sub, adj) : [];
      free.forEach(function (jj, t) { x[jj] = sx[t]; });
      for (j = 0; j < n; j++) if (fixed[j] != null) x[j] = fixed[j];
      var worst = -1, worstExcess = 1e-9;
      free.forEach(function (jj) {
        if (x[jj] - upper[jj] > worstExcess) { worstExcess = x[jj] - upper[jj]; worst = jj; }
      });
      if (worst < 0) return x;
      fixed[worst] = upper[worst];
    }
    return x;
  }

  // Per-ion weights for the solver score: Mg counts double because its
  // useful band is narrow in ppm terms (SPEC section 6).
  var SOLVER_WEIGHTS = Object.freeze({ ca: 1, mg: 2, na: 1, cl: 1, so4: 1, alk: 1 });
  var BLOCKER_IONS = ['na', 'mg', 'cl', 'so4']; // ions no addition can reduce

  // opts: { source, target, volumeL, shelf: [saltKeys], maxGrams: {key: g},
  //         allowAcid, allowDilution, diluent, sourceName }
  // A target ion left null/undefined is NOT a target of zero: the solver
  // ignores it and reports where it lands (see SPEC section 6).
  function solveWater(opts) {
    opts = opts || {};
    var volumeL = req(opts.volumeL, 'volumeL');
    if (volumeL <= 0) throw new Error('volumeL must be > 0');
    function profileOf(obj, label) {
      var p = {};
      IONS.forEach(function (k) {
        var v = obj && obj[k] != null ? req(obj[k], label + ' ' + k) : 0;
        if (v < 0) throw new Error(label + ' ' + k + ' cannot be negative');
        p[k] = v;
      });
      return p;
    }
    var source = profileOf(opts.source, 'source');
    var targetGiven = {};
    IONS.forEach(function (k) { targetGiven[k] = !!(opts.target && opts.target[k] != null); });
    var target = profileOf(opts.target, 'target');
    var diluent = profileOf(opts.diluent, 'diluent');
    var shelf = (opts.shelf || SALT_FORM_ORDER.slice()).slice();
    shelf.forEach(function (k) { if (!SALT_FORMS[k]) throw new Error('Unknown salt form: ' + k); });
    var maxGrams = opts.maxGrams || {};
    var allowAcid = !!opts.allowAcid;

    var notes = [];
    var blockers = BLOCKER_IONS.filter(function (k) {
      return targetGiven[k] && source[k] > target[k] + 1e-9;
    });
    if (source.ca > target.ca + 1e-9 && targetGiven.ca) {
      notes.push({ code: 'ca-high',
        text: 'Source calcium (' + source.ca.toFixed(0) + ' mg/L) is already above your target (' +
          target.ca.toFixed(0) + '). No salt can remove calcium; calcium will finish at least that high.' });
    }

    var src = source, dilution = null;
    if (blockers.length) {
      if (!opts.allowDilution) {
        return { ok: false, blockers: blockers, notes: notes, mixes: [],
          sourceUsed: source, target: target, targetGiven: targetGiven, volumeL: volumeL,
          sourceName: opts.sourceName || null, dilution: null };
      }
      var unfixable = blockers.filter(function (k) { return diluent[k] > target[k] + 1e-9; });
      if (unfixable.length) {
        notes.push({ code: 'diluent-high',
          text: 'Even your diluent sits above target for: ' + unfixable.join(', ') +
            '. Blending cannot land below the diluent.' });
        return { ok: false, blockers: unfixable, notes: notes, mixes: [],
          sourceUsed: source, target: target, targetGiven: targetGiven, volumeL: volumeL,
          sourceName: opts.sourceName || null, dilution: null };
      }
      var f = 1;
      blockers.forEach(function (k) {
        f = Math.min(f, (target[k] - diluent[k]) / (source[k] - diluent[k]));
      });
      f = Math.max(0, Math.min(1, f));
      src = {};
      IONS.forEach(function (k) { src[k] = f * source[k] + (1 - f) * diluent[k]; });
      dilution = { tapFraction: f, tapVolumeL: f * volumeL, diluentVolumeL: (1 - f) * volumeL,
        sourceAfter: src };
    }

    function solveVariant(salts, useAcid, ignoreMaxFor) {
      var cols = salts.slice();
      if (useAcid) cols.push('__acid');
      var x = new Array(cols.length).fill(0);
      if (cols.length) {
        var rows = [], d = [];
        IONS.forEach(function (ion) {
          if (!targetGiven[ion]) return;
          var w = Math.sqrt(SOLVER_WEIGHTS[ion]);
          rows.push(cols.map(function (c) {
            if (c === '__acid') return ion === 'alk' ? -EQ_CACO3 * w : 0;
            var s = SALT_FORMS[c];
            return (ion === 'alk' ? s.alk : (s.ions[ion] || 0)) * w;
          }));
          d.push((target[ion] - src[ion]) * w);
        });
        var upper = cols.map(function (c) {
          if (c === '__acid' || ignoreMaxFor === c) return Infinity;
          return maxGrams[c] != null ? maxGrams[c] * 1000 / volumeL : Infinity;
        });
        if (rows.length) x = boundedNnls(rows, d, upper);
      }
      // Rebuild the achieved profile from the doses, unweighted and exact.
      var achieved = {}, doses = {}, acid = null;
      IONS.forEach(function (k) { achieved[k] = src[k]; });
      cols.forEach(function (c, t) {
        if (c === '__acid') {
          var meqPerL = Math.max(0, x[t]);
          if (meqPerL > 0) {
            achieved.alk -= meqPerL * EQ_CACO3;
            var meqTotal = meqPerL * volumeL;
            acid = { meqPerL: meqPerL, meqTotal: meqTotal, options: {
              lactic88: { ml: acidMl(meqTotal, 'lactic88'), tsp: acidMl(meqTotal, 'lactic88') / ML_PER_TSP },
              phosphoric85: { ml: acidMl(meqTotal, 'phosphoric85'), tsp: acidMl(meqTotal, 'phosphoric85') / ML_PER_TSP }
            } };
          }
          return;
        }
        var s2 = SALT_FORMS[c], mgPerL = Math.max(0, x[t]);
        doses[c] = { mgPerL: mgPerL, grams: mgPerL * volumeL / 1000,
          tsp: s2.tspDensity ? mgPerL * volumeL / 1000 / s2.tspDensity : null };
        for (var ion in s2.ions) achieved[ion] += mgPerL * s2.ions[ion];
        achieved.alk += mgPerL * s2.alk;
      });
      achieved.hco3 = alkToHco3(achieved.alk);
      var residuals = {}, within = {}, score = 0;
      IONS.forEach(function (k) {
        if (!targetGiven[k]) { residuals[k] = null; within[k] = null; return; }
        residuals[k] = achieved[k] - target[k];
        within[k] = Math.abs(residuals[k]) <= Math.max(5, 0.10 * target[k]);
        score += SOLVER_WEIGHTS[k] * residuals[k] * residuals[k];
      });
      return { label: '', note: '', score: score, doses: doses, acid: acid,
        achieved: achieved, residuals: residuals, within: within, constrainedBy: [] };
    }

    // Mark mixes whose score a per-salt max is actively worsening.
    function markConstrained(mix, salts, useAcid) {
      salts.forEach(function (k) {
        if (maxGrams[k] == null || !mix.doses[k]) return;
        if (mix.doses[k].grams < maxGrams[k] - 1e-6) return;
        var free = solveVariant(salts, useAcid, k);
        if (free.score < mix.score - Math.max(1e-9, 0.001 * mix.score)) {
          mix.constrainedBy.push(SALT_FORMS[k].name);
        }
      });
    }

    var mixes = [];
    var main = solveVariant(shelf, allowAcid);
    main.label = 'Best from your shelf';
    markConstrained(main, shelf, allowAcid);
    mixes.push(main);

    if (shelf.length > 1) {
      // Only dropping a salt the winning mix actually uses changes
      // anything; dropping an unused salt reproduces mix 1 exactly.
      var best2 = null;
      shelf.forEach(function (drop) {
        if (!main.doses[drop] || main.doses[drop].mgPerL <= 1e-9) return;
        var v = solveVariant(shelf.filter(function (s) { return s !== drop; }), allowAcid);
        if (!best2 || v.score < best2.score) { v.droppedSalt = drop; best2 = v; }
      });
      if (best2) {
        best2.label = 'Without ' + SALT_FORMS[best2.droppedSalt].name;
        best2.note = 'The best your shelf can do with no ' + SALT_FORMS[best2.droppedSalt].name +
          ' — the run-out answer.';
        markConstrained(best2, shelf.filter(function (s) { return s !== best2.droppedSalt; }), allowAcid);
        mixes.push(best2);
      }
    }

    if (allowAcid && main.acid) {
      var noAcid = solveVariant(shelf, false);
      noAcid.label = 'No acid';
      noAcid.note = 'The same shelf with acid left out.';
      markConstrained(noAcid, shelf, false);
      mixes.push(noAcid);
    } else if (!allowAcid) {
      var withAcid = solveVariant(shelf, true);
      if (withAcid.acid) {
        withAcid.label = 'If acid were allowed';
        withAcid.note = 'What an acid addition would buy on this shelf.';
        markConstrained(withAcid, shelf, true);
        mixes.push(withAcid);
      }
    }

    // Ties and near-ties (under 1 % score difference) collapse to one mix.
    var kept = [];
    mixes.forEach(function (mx) {
      var dup = kept.some(function (k) {
        return Math.abs(k.score - mx.score) <= 0.01 * Math.max(k.score, mx.score, 1e-9);
      });
      if (!dup) kept.push(mx);
    });

    return { ok: true, blockers: [], notes: notes, mixes: kept,
      sourceUsed: src, target: target, targetGiven: targetGiven, volumeL: volumeL,
      sourceName: opts.sourceName || null, dilution: dilution };
  }

  return {
    AW: AW, M: M, EQ_CACO3: EQ_CACO3, molarMass: molarMass, units: units,
    // liquor
    SALTS: SALTS, SALT_ORDER: SALT_ORDER, buildLiquor: buildLiquor,
    profileFromSalts: profileFromSalts, alkToHco3: alkToHco3, hco3ToAlk: hco3ToAlk,
    // mash pH
    MASH: MASH, maltDistilledPH: maltDistilledPH, residualAlkalinity: residualAlkalinity,
    estimateMashPH: estimateMashPH,
    // Cl:SO4
    RATIO_BANDS: RATIO_BANDS, STYLE_RATIOS: STYLE_RATIOS, LOW_TOTAL: LOW_TOTAL,
    chlorideSulfate: chlorideSulfate, styleFit: styleFit,
    // blending
    BLEND_IONS: BLEND_IONS, blendProfile: blendProfile, solveBlend: solveBlend,
    // priming
    PRIMING: PRIMING, SUGARS: SUGARS, CARB_STYLES: CARB_STYLES,
    CO2_G_PER_L_PER_VOL: CO2_G_PER_L_PER_VOL, GLUCOSE_G_PER_L_PER_VOL: GLUCOSE_G_PER_L_PER_VOL,
    residualCO2: residualCO2, primingSugar: primingSugar,
    // water solver (engine 6)
    EQ_WEIGHTS: EQ_WEIGHTS, SULFATE_FROM_S: SULFATE_FROM_S, NITRATE_FROM_N: NITRATE_FROM_N,
    normalizeReport: normalizeReport, chargeBalance: chargeBalance,
    computedHardness: computedHardness, hardnessCheck: hardnessCheck,
    reportAdvisories: reportAdvisories, parseReportText: parseReportText,
    SALT_FORMS: SALT_FORMS, SALT_FORM_ORDER: SALT_FORM_ORDER, TSP_DENSITY: TSP_DENSITY,
    ACIDS: ACIDS, ML_PER_TSP: ML_PER_TSP, acidMl: acidMl,
    SOLVER_WEIGHTS: SOLVER_WEIGHTS, solveWater: solveWater
  };
});
