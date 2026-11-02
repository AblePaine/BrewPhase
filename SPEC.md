# BrewPhase — Engine Specification

BrewPhase (brewphase.com) is the family's homebrew beer water-chemistry site. This file specifies every formula the calculators use and lists every figure that is measured, fitted, or disputed. Code lives in `assets/brewphase.js`, which has the derivations as comments. Tests live in `tests/`.

**House principle:** zero guesswork. You enter what you know and get an exact answer. When the answer depends on a figure the brewing literature disputes, the page says so in a footnote. It never picks a side quietly.

## Layout

```
index.html                 hub
priming-sugar.html         engine 5 (the traffic page)
liquor-builder.html        engine 1
mash-ph.html               engine 2
chloride-sulfate.html      engine 3
water-blending.html        engine 4
water-solver.html          engine 6 (report ingest + constrained solver)
assets/brewphase.js        shared formula module (browser global + CommonJS)
assets/site.css            shared styles, mobile-first, light/dark
tests/*.test.js            node:test suite — `npm test` (Node ≥ 18, no dependencies)
```

This is a static site. There is no framework, no build step, and no runtime dependencies. Each page works on its own and loads only the two shared assets. Pages link to each other with query strings (`chloride-sulfate.html?cl=&so4=` and `mash-ph.html?ra=`).

## Conventions

- Ions are in mg/L, which equals ppm for dilute water.
- **Alkalinity** means total alkalinity in mg/L as CaCO₃. One meq of alkalinity equals `M(CaCO₃)/2` = 50.043 mg as CaCO₃.
- Bicarbonate is `HCO₃⁻ = alk × M(HCO₃)/50.043 = alk × 1.2193`. This holds when water pH is below about 8.3.
- Inside the math, volumes are in litres, masses in grams, and priming temperatures in °F. The pages convert units.
- US gallon = 3.785411784 L. oz = 28.349523125 g. lb = 453.59237 g. All three are exact by definition.
- Malt colour: SRM = 1.3546·°L − 0.76 (Morey) and EBC = 1.97·SRM. These are approximations, used only to classify malts.

### Atomic weights (shared family table — do not change per site)

| N | O | Na | K | Mg | Ca | S | C | H | Cl | P |
|---|---|---|---|---|---|---|---|---|---|---|
| 14.007 | 15.999 | 22.990 | 39.098 | 24.305 | 40.078 | 32.06 | 12.011 | 1.008 | 35.45 | 30.974 |

*(P added 2026-11 for engine 6 — phosphoric acid's molar mass cannot be stated without it. It is the table's only addition; nothing else in the row changed. See §6.)*

### Molar masses computed from the table (g/mol)

| Species | Formula | M |
|---|---|---|
| Water | H₂O | 18.015 |
| Sulfate | SO₄ | 96.056 |
| Bicarbonate | HCO₃ | 61.016 |
| Carbon dioxide | CO₂ | 44.009 |
| Gypsum | CaSO₄·2H₂O | 172.164 |
| Calcium chloride | CaCl₂·2H₂O | 147.008 |
| Epsom salt | MgSO₄·7H₂O | 246.466 |
| Baking soda | NaHCO₃ | 84.006 |
| Chalk | CaCO₃ | 100.086 |
| Glucose | C₆H₁₂O₆ | 180.156 |
| Dextrose monohydrate | C₆H₁₂O₆·H₂O | 198.171 |
| Sucrose | C₁₂H₂₂O₁₁ | 342.297 |
| Calcium chloride, anhydrous | CaCl₂ | 110.978 |
| Canning salt | NaCl | 58.440 |
| Slaked lime | Ca(OH)₂ | 74.092 |
| Lactic acid | C₃H₆O₃ | 90.078 |
| Phosphoric acid | H₃PO₄ | 97.994 |

---

## 1. Brewing liquor builder

**Inputs:** target Ca, Mg, Na, Cl, SO₄ and alkalinity (mg/L), plus batch volume. The base water is distilled or RO, taken as zero for every ion.

**Contribution per salt.** 1 mg/L of salt adds `(ion molar mass × count) / salt molar mass` mg/L of each of its ions. It also adds alkalinity:

| Salt | Ca | Mg | Na | Cl | SO₄ | Alkalinity (as CaCO₃) |
|---|---|---|---|---|---|---|
| Gypsum | 0.2328 | | | | 0.5579 | |
| CaCl₂·2H₂O | 0.2726 | | | 0.4823 | | |
| Epsom | | 0.0986 | | | 0.3897 | |
| Baking soda | | | 0.2737 | | | 50.043/84.006 = 0.5957 |
| Chalk | 0.4004 | | | | | 2·50.043/100.086 = 1.0000 |

**Solve order.** There are six targets and five salts, so the system has more targets than it can hit. Three salts are each the only source of one ion, so they are fixed directly:

1. Epsom = Mg ÷ 0.0986
2. Baking soda = Na ÷ 0.2737
3. CaCl₂ = Cl ÷ 0.4823
4. Gypsum = (SO₄ − Epsom's SO₄) ÷ 0.5579
5. Chalk = (Alk − baking soda's alkalinity) ÷ 1.000
6. **Calcium is an output.** It equals gypsum·0.2328 + CaCl₂·0.2726 + chalk·0.4004.

If step 4 or 5 comes out negative, that salt is set to 0. A warning fires when the overshoot is more than 1 mg/L. The Ca target is shown next to the Ca result. A warning fires when they differ by more than max(5 mg/L, 10 %).

**Output:** grams per batch = mg/L × litres ÷ 1000. The page also shows the full resulting profile, bicarbonate, residual alkalinity, and the Cl:SO₄ ratio.

**Flags**
- **Chalk dissolution (contested).** CaCO₃ barely dissolves in plain water. Added to the mash, it delivers less alkalinity than stoichiometry predicts, and published estimates of how much less vary widely. BrewPhase reports the theoretical value, warns whenever chalk is above 0, and footnotes it.
- **Presets** (Pale & hoppy, Balanced, Amber & malty, Dark & roasty) are common homebrew starting points, not standards. Each preset's Ca value is set to what its other targets produce, so presets solve without warnings. A test enforces this.

---

## 2. Mash pH estimator — ESTIMATE ONLY

The page labels this as an estimate in every place it appears. It always tells the user to verify with a pH meter, and it footnotes that full models (Bru'n Water and similar) use more inputs.

**Model.** Each malt is a buffer that settles at its own distilled-water pH (pH_DI) when mashed alone. The mash settles where the malts' buffering balances the water's residual alkalinity:

```
Σ B·mᵢ·(pH − pH_DI,i) = RA_meq
pH = Σ(mᵢ·pH_DI,i)/Σmᵢ + RA_meq/(B·Σmᵢ)
RA_meq = RA (mg/L as CaCO₃) / 50.043 × mash water litres
```

**Residual alkalinity (Kolbach).** `RA = Alk − CaH/3.5 − MgH/7`, with hardness as CaCO₃. Using ion ppm:

- Ca factor = 100.086/40.078/3.5 = 1/1.4016
- Mg factor = 100.086/24.305/7 = 1/1.7000

So **RA = Alk − Ca/1.40 − Mg/1.70**.

**Calibration values — all FLAGGED as approximate:**

| Parameter | Value | Basis |
|---|---|---|
| Buffer capacity B | 38 meq/(kg·pH), all malts | Kolbach: 10 °dH RA (178 mg/L) raises pH about 0.3 at about 3 L/kg, which gives about 36. Troester's base-malt measurements run in the high 30s to 40s. |
| Base malt pH_DI | 5.80 − 0.028·°L (valid to 30 °L) | Pale (2 °L) gives 5.74 and Munich (10 °L) gives 5.52. Consistent with published distilled-water mash data. |
| Crystal pH_DI | 5.22 − 0.00504·°L | Troester's fit across caramel malts. |
| Roast pH_DI | 4.70 (any colour) | Measured values run about 4.5–4.9. **This is the weakest parameter.** The model may read high for dark grists. |
| Target range | 5.2–5.6 | Room-temperature sample. |

**Warnings:** a base malt above 30 °L (enter it as crystal or roast instead), and mash thickness outside 2–5 L/kg.

**Known limitations.** The model does not account for acid malt, acid additions, per-malt titration data, how mash thickness changes buffering, or differences between maltsters. It predicts room-temperature pH. A sample read hot shows about 0.2–0.3 lower; the size of that offset is disputed, and the page footnotes it.

---

## 3. Chloride : sulfate ratio

`ratio = Cl / SO₄` (mg/L ÷ mg/L). If SO₄ = 0 and Cl > 0, the ratio is ∞. If both are 0, there is no ratio.

**Interpretation bands (FLAG — guidance):**

| Ratio | Label |
|---|---|
| < 0.5 | Very bitter |
| 0.5 – < 0.77 | Bitter |
| 0.77 – < 1.3 | Balanced |
| 1.3 – < 2.0 | Malty |
| ≥ 2.0 | Very malty |

**Style ranges (FLAG — guidance, footnoted as not law):**

| Style | Range |
|---|---|
| West Coast / American IPA | 0.2–0.5 |
| American pale ale | 0.4–0.8 |
| English bitter / pale ale | 0.5–1.0 |
| Pilsner / pale lager | 0.8–1.5 |
| Amber / red ale | 0.8–1.5 |
| Brown ale / porter | 1.0–2.0 |
| Stout | 1.0–2.0 |
| Märzen / bock / malty lager | 1.2–2.0 |
| Hazy / NEIPA | 1.5–3.0 |

**Contested.** Some water specialists argue that absolute levels matter more than the ratio. The page warns that the ratio means little when Cl + SO₄ < 50 mg/L. It also gives guidance warnings when SO₄ > 400 or Cl > 200 mg/L.

---

## 4. Water blending

Blending is a mass balance, which is exact:

```
C_mix = f·C_tap + (1 − f)·C_dil          (f = tap fraction, 0 ≤ f ≤ 1)
f     = (C_target − C_dil) / (C_tap − C_dil)
```

- The diluent defaults to distilled (all zeros). RO readings can be entered.
- A target outside [C_dil, C_tap] is **refused, not clamped**. So is a target where tap = diluent but target ≠ tap.
- Outputs: the tap/diluent split in percent and volume, the full blended profile, bicarbonate, and residual alkalinity.

**Flags:** utility reports are often annual averages, and RO output is not truly zero. Both are footnoted.

---

## 5. Priming sugar

1. **Residual CO₂** comes from the warmest temperature the beer reached after fermentation finished, at 1 atm, with T in °F:
   `V = 3.0378 − 0.050062·T + 0.00026555·T²`
   This fit is valid for about 32–80 °F. The page warns outside that range but still computes.
2. **CO₂ to add** = target − residual. If this is ≤ 0, the page returns "no sugar needed".
3. **One volume** of CO₂ = M(CO₂) / 22.414 L/mol = **1.9635 g CO₂ per litre**.
4. **Stoichiometry:** C₆H₁₂O₆ → 2 C₂H₅OH + 2 CO₂. That gives 2·44.009/180.156 = 0.48857 g CO₂ per g glucose. So each volume needs **4.019 g glucose per litre**.
5. **Grams of product** = glucose needed ÷ the sugar's glucose-equivalent factor:

| Sugar | Factor | Derivation | Flag |
|---|---|---|---|
| Dextrose (corn sugar) | 0.9091 | Monohydrate: 180.156/198.171 | Monohydrate vs anhydrous — see note |
| Dextrose, anhydrous | 1.0000 | — | |
| Table sugar (sucrose) | 1.0526 | Hydrolysis: 2·180.156/342.297 | |
| DME | 0.694 | 0.97 solids × 0.68 fermentable × 1.0526 | **FLAG:** fermentability varies by product, about 0.60–0.75 |
| Honey | 0.779 | 0.82 sugars × 0.95 fermentable | **FLAG:** moisture and sugar mix vary by source |

**Safety limits**
- Target above **3.5 vol**: the result is shown with a prominent heavy-bottle warning.
- Target above **4.0 vol**: **refused**. No number is shown. Exactly 4.0 is still allowed, with the warning.

**Reference case.** 5 US gal at 68 °F, target 2.4 vol: residual 0.86, add 1.54 vol, 117.2 g glucose. That is **128.8 g dextrose monohydrate** (about 4.5 oz, in line with the traditional "about ¾ cup / 4 oz corn sugar") or **111.2 g table sugar**.

**Other flags:**
- Yeast send a few percent of sugar to biomass rather than CO₂. The formula ignores this.
- Altitude (lower pressure) is ignored.
- The "warmest temperature" rule is standard practice but an approximation.
- Carbonation-by-style ranges are tradition, not physics.
- Dextrose form (contested): most brewing corn sugar is sold as monohydrate, and many calculators treat it as pure glucose. BrewPhase defaults to monohydrate and offers anhydrous as its own option. The difference is about 10 %.

---

## 6. Water solver (report ingest + constrained salt solver)

One page, two stages. **Stage A** turns a water report into a normalized source profile and audits it. **Stage B** solves salt additions against a source that is *not* assumed to be zero, using only the salts the user owns, each in the hydrate form they own it in.

This is a different engine from §1, for a different problem, and the two are not to be "unified": §1's fixed solve order is followable by hand (open question 4) and assumes a distilled base and a full shelf; §6's least-squares fit exists precisely where those assumptions fail. Each page states its own method.

### Stage A — ingest, normalization, the gate

Reports state the same water in different units. The three disagreements that silently wreck a profile, and the exact conversions (ratios of the molar masses above):

| Quantity | Report form | Canonical |
|---|---|---|
| Sulfate | as SO₄-S | SO₄ = S × 96.056/32.06 = S × 2.9964 |
| Alkalinity | as HCO₃ | alk (as CaCO₃) = HCO₃ ÷ 1.2193 |
| Nitrate | as NO₃-N | NO₃ = N × 62.004/14.007 = N × 4.4266 |
| Hardness (check only) | as CaCO₃ | computed = Ca × 2.4973 + Mg × 4.1180 |

Pasted text is matched by label into an editable grid — **nothing parsed is accepted silently**; the user confirms every value. Unmatched fields stay blank; that is a fallback, never an error state.

**Charge balance (the gate).** A real sample is electrically neutral. With equivalent weights Ca 20.039, Mg 12.1525, Na 22.990, K 39.098, SO₄ 48.028, Cl 35.450, HCO₃ 61.016, NO₃ 62.004 mg/meq:

```
imbalance % = (Σcations − Σanions) / (Σcations + Σanions) × 100
```

|imbalance| ≤ 5 % → **Balanced**. 5–10 % → **Caution** (usable; a missing minor ion or a rounded lab value). > 10 % → **Does not balance** (the report or the transcription is wrong somewhere; the profile is still shown, flagged). Below 0.5 meq/L of cations the gate is skipped — there is almost nothing to balance in RO-class water. The hardness cross-check flags when |reported − computed| > max(10 mg/L, 10 %).

**Advisory flags** (shown, never blocking): Na > 150, alkalinity > 200, Fe > 0.1, SO₄ > 400, Cl > 250 mg/L.

### Stage B — the shelf, with hydrate forms locked

Fractions are mg of ion per mg of salt, from the molar-mass table. The two calcium chloride forms are separate shelf entries on purpose: the forms are **not interchangeable** — dosing anhydrous salt by dihydrate math overshoots chloride by about 32 % (test B3: the 4.15 g dihydrate dose, weighed as anhydrous, delivers 132.5 mg/L Cl against a 100 target). The user declares the form on their bag once; the form is printed on the brew-day card.

| Salt | Formula | M | Ca | Mg | Na | Cl | SO₄ | Alk |
|---|---|---|---|---|---|---|---|---|
| Gypsum | CaSO₄·2H₂O | 172.164 | 0.2328 | | | | 0.5579 | |
| Calcium chloride, dihydrate | CaCl₂·2H₂O | 147.008 | 0.2726 | | | 0.4823 | | |
| Calcium chloride, anhydrous | CaCl₂ | 110.978 | 0.3611 | | | 0.6389 | | |
| Epsom salt | MgSO₄·7H₂O | 246.466 | | 0.0986 | | | 0.3897 | |
| Canning salt | NaCl | 58.440 | | | 0.3934 | 0.6066 | | |
| Baking soda | NaHCO₃ | 84.006 | | | 0.2737 | | | 0.5957 |
| Slaked lime | Ca(OH)₂ | 74.092 | 0.5409 | | | | | 1.3508 |

Epsom's anhydrous form (MgSO₄, M 120.361) exists but is rarely the bag on a shelf; the shelf assumes the heptahydrate and the page footnotes that.

**No chalk.** Chalk is excluded from the shelf entirely — not offered, not solved for. CaCO₃ barely dissolves and delivers an unpredictable fraction of its theoretical alkalinity (§1's contested figure); a solver that promises per-ion residuals cannot include a salt whose contribution is a guess. Alkalinity + calcium routes to slaked lime; alkalinity alone, to baking soda. §1 keeps its own chalk posture (theoretical value + warning) — unchanged.

**Acids** reduce alkalinity only, dosed in mL. **FLAG — product figures:** lactic acid 88 % (density 1.209 g/mL) = **11.812 meq/mL**; phosphoric acid 85 % (density 1.685 g/mL) = **14.616 meq/mL**, counting phosphoric as 1 eq/mol — at brewing pH the first proton (to H₂PO₄⁻) is the one that lands. These acids neutralize *water* alkalinity toward the target profile; acid dosed to the mash is §2's territory and stays out. The lactate/phosphate the acid itself adds is footnoted on the card, not tracked as an ion.

### Feasibility before solving

Salts only add; acid only removes alkalinity. Where source > target for Na, Mg, Cl or SO₄, no addition can fix it: with RO dilution off, the solver refuses and names the blocking ions. With it on, the blend fraction comes first — f = target ÷ source on the worst blocker (engine 4's mass balance, diluent = RO zeros) — the split is stated in percent and volume, the whole source profile is scaled, and only then does the solver run. Calcium above target is never a hard blocker; it is reported, and rides into the residuals. An ion pushed above target by a salt needed for another ion is a soft overshoot: allowed, shown as a positive residual, counted in the score.

### Solve method

Weighted non-negative least squares (active-set, no library) over the checked shelf plus an acid column acting on alkalinity. **Weights: Ca 1, Mg 2, Na 1, Cl 1, SO₄ 1, Alk 1** — Mg counts double because its useful band is narrow in ppm terms. Score = Σ wᵢ·(residualᵢ)², residuals in mg/L against the target.

A target ion left blank is **not a target of zero**: the solver ignores it and reports where it lands. (The acceptance case B2 pins this: with only sulfate targeted, gypsum doses to the sulfate figure exactly and calcium is a reported landing, not a scored miss.)

Output is up to three ranked mixes: the best from the checked shelf; the best with any one *used* salt dropped (the run-out answer); and the acid flipped (no-acid if the winner used acid, with-acid if acid was off). Ties and near-ties — under 1 % score difference — collapse to one. A per-salt max-grams entry clamps that salt's dose; a mix the clamp makes worse is labelled "constrained by your max on ⟨salt⟩".

**Outputs (the brew-day card).** Grams are primary (batch total, 0.1 g resolution); mg/L alongside. Per-ion achieved vs target with the **residual Δ in mg/L**, ✓ inside ±max(5 mg/L, 10 %) of target, ⚠ outside. The card prints its source ("from: Ward report, balanced ✓" / "RO" / the dilution split), the volume, and every hydrate form used — the card is what travels to brew day.

### Kitchen densities (FLAG — approximate, currently unmeasured)

Teaspoon figures are a convenience, never the spec. The density table (g per level tsp, 0.01 g scale, 3 reps) is pinned by weighing at build time; **no salt in the table below has been weighed yet**, so every tsp cell on the card reads "weigh it — grams above" rather than inventing a density.

| Salt | g/tsp | Status |
|---|---|---|
| Gypsum | — | not yet weighed |
| Calcium chloride, dihydrate | — | not yet weighed |
| Calcium chloride, anhydrous | — | not yet weighed |
| Epsom salt | — | not yet weighed |
| Canning salt | — | not yet weighed |
| Baking soda | — | not yet weighed |
| Slaked lime | — | not yet weighed |

Acid teaspoons use the exact US teaspoon (4.92892159375 mL) on a measured mL figure, so acid tsp values are shown.

## Posture

- Homebrewing beer is federally legal for personal use in the US. Every page carries a "check your state and local laws" footnote.
- The mash pH page never presents its estimate as a substitute for a meter reading.
- Product-agnostic throughout: generic ingredient names only, no brands or SKUs.
- Every page has one short "why" paragraph. The pages are not a textbook.

## Open questions for review

1. **Mash pH calibration.** B = 38 and roast pH_DI = 4.70 are the least certain numbers in the project. If the family has measured malt data, it should replace these.
2. **DME and honey factors.** 0.694 and 0.779 are middle-of-range figures. We could expose a "fermentability" override instead.
3. **Chalk.** We could apply an effective-dissolution factor (for example 50 %) instead of the theoretical value. Left at the theoretical value and footnoted, because published estimates don't agree.
4. **Liquor builder.** Ca is treated as an output of the other targets. Another option is a least-squares fit across all six targets. The fixed order was chosen because a first-time brewer can follow it and check it by hand.
