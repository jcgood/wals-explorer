# Next Prompt

Start a session with "Read NextPrompt.md and carry on." This file points to
where things stand; it holds no facts of its own beyond the current thread.

## Now

**2026-11-08:** Prototype built and tested locally for Jeff to try (see
README for what it does and how to run it). The repo is on GitHub as a
PRIVATE repo; GitHub Pages is not enabled. Next: Jeff tries it locally and
decides (a) whether to use it for Homework 10, (b) whether to make it public
and turn on Pages. Don't publish without his say-so.

The Homework 10 assignment text lives in the morphology repo's
git-ignored content (`Morphology/2026/Homeworks/10-MorphologyHomework.tex`);
its "NEXT TIME?" notes are what motivated this tool.

## Things that will bite

- Opening `index.html` as a file fails (the data fetch is blocked); serve it.
- `data/wals.json` is generated; rebuild it with `scripts/build_data.py`,
  don't edit it by hand.
- The assignment design is built in (2026-11-08, Jeff): 3 morphological +
  3 syntactic features; pairs are generated automatically (3 morph×morph,
  9 morph×syn); syntactic list is "A" features only (`inList` in
  `js/app.js`). `SLOTS` sets the number per list. Features need >= 250
  languages (`MIN_LANGS`; chosen from the overlap analysis in the commit
  message) and pairs under 100 shared languages get a warning (`SMALL_PAIR`).
- Excluded features and their reasons are in `EXCLUDED` in `js/app.js`
  (Jeff's calls, 2026-11-08: all derivative features; 30A over 31A/32A,
  78A over 77A, 114A over 113A, 37A over 38A; 143A/144A dropped in favour
  of 112A; 82A, 84A dropped; person marking 100A/102A/104A kept). Don't
  re-litigate these. 66 features offered (38 morph list, 28 syntax list,
  15 mixed in both).
- After any change to `js/stats.js`, run `tests/check_stats.py`; after UI
  changes, run `tests/e2e.py` against a local server.
