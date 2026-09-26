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

| N | O | Na | K | Mg | Ca | S | C | H | Cl |
|---|---|---|---|---|---|---|---|---|---|
| 14.007 | 15.999 | 22.990 | 39.098 | 24.305 | 40.078 | 32.06 | 12.011 | 1.008 | 35.45 |

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
