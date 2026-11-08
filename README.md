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
3. **Model 1, all languages**: a permutation p-value (2,000 shuffles of
   one feature's values; the statistic shuffled is Pearson's chi-square),
   strength of association (Cramér's V), and adjusted residuals.
4. **Model 2, one language per genus**: 100 random samples with one
   language per WALS genus, each with its own permutation p-value (200
   shuffles); reports the share of samples with p < 0.05, plus a
   genus-weighted table.
5. **Model 3, areal control**: a permutation p-value that shuffles only
   within WALS's six macroareas (a test of association within areas), and
   a Dryer-style count of the areas in which each combination is
   over-represented (genera weighted equally).

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
