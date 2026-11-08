# WALS Feature Explorer

A browser tool for LIN 410/510 (Morphology, University at Buffalo) Homework 10.
Students choose three morphological and three syntactic features from the
[World Atlas of Language Structures](https://wals.info) (WALS). The tool
pairs the morphological features with each other (3 pairs) and each
morphological feature with each syntactic one (9 pairs). The syntactic list
offers only the "A" feature of chapters that WALS splits into several
features (81A but not 81B). For each pair, students get:

1. **A combined map** of languages coloured by their combination of values,
   with a filter for single combinations and a link to the same combination
   on wals.info.
2. **Descriptive statistics**: counts, row and column percentages, and the
   number of languages, genera, families and languages per area.
3. **Model 1, all languages** (uncontrolled baseline): a permutation
   p-value (2,000 shuffles of one feature's values; the statistic is
   Pearson's chi-square), strength of association (Cramér's V, with
   strength words scaled to table size), and adjusted residuals.
4. **Model 2, controlling for family and area**: languages are grouped by
   family within WALS macroarea, and one feature's values are shuffled only
   within groups (a stratified permutation test of conditional
   independence). Per-cell "stand out" values are pooled
   (Mantel–Haenszel-style) within-group residuals. Groups that can't vary
   are left out; typically about half the languages count.

Cells with fewer than one expected language aren't highlighted in either
"stand out" table. Pairs that overlap by definition (49A/51A, 50A/51A,
102A/103A) carry a warning.

**How good is the control?** The simulation scripts in `tests/`
(`null_family.js`, `null_family_fix.js`, `fix_checks.js`) measured
false-positive rates on WALS data. With features inherited within
families, the uncontrolled test was wrong up to 97% of the time; the
family-and-area test 5–7%. With features spread
locally by contact, it was about 10% (uncontrolled: up to 47%). So Model 2
is approximate, and the page says so. Proper control would need a
statistical model with phylogeny and geography built in, which is out of
scope for a teaching tool.

Only permutation p-values are shown, to keep things simple for students
and because the chi-square approximation is unreliable for the sparse
tables WALS pairs often produce. A **Save as PDF** button prints just the
current pair's results (about five pages) through the browser's print
dialog, which keeps real, selectable text.

Everything runs in the browser. There is no server, no build step and no
dependencies apart from [Leaflet](https://leafletjs.com) for the map.

## Running it locally

```sh
python3 -m http.server 8765
```

Then open <http://127.0.0.1:8765/>. Opening `index.html` directly as a
file does not work, because browsers block loading the data file that way.

## Files

- `index.html`, `css/style.css`, `js/app.js`: the page.
- `js/stats.js`: the statistics (seeded random numbers, so results are
  reproducible).
- `js/data.js`: joins two features into per-language records.
- `data/wals.json`: WALS data prepared by `scripts/build_data.py`.
- `tests/check_stats.py`: checks `js/stats.js` against SciPy on real
  feature pairs (needs Node and SciPy).
- `tests/e2e.py`: drives the site in a headless browser and runs the axe-core
  accessibility checker in light and dark mode (needs Playwright and a
  running local server).

## Updating the data

```sh
git clone --depth 1 https://github.com/cldf-datasets/wals.git /tmp/wals
python3 scripts/build_data.py /tmp/wals/cldf
python3 tests/check_stats.py
```

The current file was built from the CLDF release tagged `v2020.6`.

## Accessibility

The tables are the primary output; the map is a visual aid with the same
information in the tables and in a downloadable language list. All controls
are native form elements with labels, results are announced to screen
readers, focus moves to the results when a pair is shown, residuals are
marked with signs and words as well as colour, and the page supports dark
mode, zoom and phone-width screens. `tests/e2e.py` reports zero axe-core
violations.

## Data and credit

WALS data: Dryer, Matthew S. & Haspelmath, Martin (eds.) 2013. *The World
Atlas of Language Structures Online.* Leipzig: Max Planck Institute for
Evolutionary Anthropology. <https://wals.info>. Licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Map tiles ©
OpenStreetMap contributors.
