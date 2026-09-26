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
    Ca: 40.078, S: 32.06, C: 12.011, H: 1.008, Cl: 35.45
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
    residualCO2: residualCO2, primingSugar: primingSugar
  };
});
