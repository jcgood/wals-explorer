// Statistics for two-feature WALS comparisons. No dependencies, so it runs
// in the browser and in Node (for tests).

// ---------- random numbers (seeded, so results are reproducible) ----------

export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ---------- chi-square distribution ----------

function logGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

// Regularized upper incomplete gamma Q(a, x).
function gammaQ(a, x) {
  if (x <= 0) return 1;
  const gln = logGamma(a);
  if (x < a + 1) {
    let sum = 1 / a, del = sum, ap = a;
    for (let n = 0; n < 1000; n++) {
      ap += 1; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return Math.max(0, 1 - sum * Math.exp(-x + a * Math.log(x) - gln));
  }
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h;
}

export function chiSquareP(x2, df) {
  if (df <= 0) return NaN;
  return gammaQ(df / 2, x2 / 2);
}

// ---------- tables ----------

// records: [{lang, a, b, genus, area}], rows/cols: arrays of value numbers.
// weight(record) defaults to 1.
export function crossTable(records, rows, cols, weight = () => 1) {
  const ri = new Map(rows.map((v, i) => [v, i]));
  const ci = new Map(cols.map((v, i) => [v, i]));
  const t = rows.map(() => cols.map(() => 0));
  for (const r of records) t[ri.get(r.a)][ci.get(r.b)] += weight(r);
  return t;
}

function margins(t) {
  const rowSums = t.map(r => r.reduce((s, x) => s + x, 0));
  const colSums = t[0] ? t[0].map((_, j) => t.reduce((s, r) => s + r[j], 0)) : [];
  const n = rowSums.reduce((s, x) => s + x, 0);
  return { rowSums, colSums, n };
}

// Pearson chi-square test of independence on one table. Empty rows and
// columns are ignored when counting degrees of freedom.
export function chiSquareTest(t) {
  const { rowSums, colSums, n } = margins(t);
  const R = rowSums.filter(x => x > 0).length;
  const C = colSums.filter(x => x > 0).length;
  const expected = t.map((r, i) => r.map((_, j) => (n > 0 ? rowSums[i] * colSums[j] / n : 0)));
  let x2 = 0, small = 0, cells = 0, minExp = Infinity;
  const residuals = t.map((r, i) => r.map((o, j) => {
    const e = expected[i][j];
    if (rowSums[i] === 0 || colSums[j] === 0) return null;
    cells++;
    if (e < 5) small++;
    minExp = Math.min(minExp, e);
    x2 += (o - e) ** 2 / e;
    const v = e * (1 - rowSums[i] / n) * (1 - colSums[j] / n);
    return v > 0 ? (o - e) / Math.sqrt(v) : 0;
  }));
  const df = (R - 1) * (C - 1);
  const k = Math.min(R, C) - 1;
  return {
    n, df, x2,
    p: df > 0 ? chiSquareP(x2, df) : NaN,
    cramersV: df > 0 && n > 0 ? Math.sqrt(x2 / (n * k)) : NaN,
    expected, residuals, rowSums, colSums,
    smallExpectedShare: cells ? small / cells : 0,
    minExpected: cells ? minExp : NaN,
    testable: df > 0,
  };
}

// Sum of per-stratum Pearson chi-squares: a test of independence of A and
// B within strata (conditional independence given stratum).
export function stratifiedChiSquare(tables) {
  let x2 = 0, df = 0;
  const per = tables.map(t => {
    const r = chiSquareTest(t);
    if (r.testable) { x2 += r.x2; df += r.df; }
    return r;
  });
  return { x2, df, p: df > 0 ? chiSquareP(x2, df) : NaN, per, testable: df > 0 };
}

// Permutation (Monte Carlo) p-value: shuffle feature-B values among
// languages (within each stratum if strata are given) and recompute.
export function permutationP(records, rows, cols, { strata = null, reps = 2000, rng }) {
  const groups = new Map();
  for (const r of records) {
    const k = strata ? strata(r) : 0;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const groupList = [...groups.values()];
  const stat = recs => stratifiedChiSquare(groupList.map(g => crossTable(g, rows, cols))).x2;
  const observed = stat();
  let atLeast = 0;
  const work = groupList.map(g => ({ g, bs: g.map(r => r.b) }));
  for (let rep = 0; rep < reps; rep++) {
    let x2 = 0;
    for (const { g, bs } of work) {
      shuffleInPlace(bs, rng);
      const shuffled = g.map((r, i) => ({ a: r.a, b: bs[i] }));
      const res = chiSquareTest(crossTable(shuffled, rows, cols));
      if (res.testable) x2 += res.x2;
    }
    if (x2 >= observed - 1e-9) atLeast++;
  }
  return { observed, p: (atLeast + 1) / (reps + 1), reps };
}

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// ---------- the three models ----------

// Model 1: every language counts once.
export function modelAllLanguages(records, rows, cols, { reps = 2000, seed = 1 } = {}) {
  const table = crossTable(records, rows, cols);
  const test = chiSquareTest(table);
  const perm = test.testable
    ? permutationP(records, rows, cols, { reps, rng: makeRng(seed) })
    : null;
  return { table, test, permP: perm ? perm.p : NaN, reps };
}

// Model 2: genealogical control. (a) Genus-weighted table: each genus
// counts once in total, split evenly among its languages. (b) Repeated
// random samples of one language per genus, each tested separately.
export function modelGenusSampling(records, rows, cols, { draws = 1000, seed = 2 } = {}) {
  const byGenus = new Map();
  for (const r of records) {
    if (!byGenus.has(r.genus)) byGenus.set(r.genus, []);
    byGenus.get(r.genus).push(r);
  }
  const genera = [...byGenus.values()];
  const weighted = crossTable(records, rows, cols, r => 1 / byGenus.get(r.genus).length);
  const rng = makeRng(seed);
  const x2s = [], ps = [], vs = [];
  let sig = 0, tested = 0;
  for (let d = 0; d < draws; d++) {
    const sample = genera.map(g => g[Math.floor(rng() * g.length)]);
    const res = chiSquareTest(crossTable(sample, rows, cols));
    if (!res.testable) continue;
    tested++;
    x2s.push(res.x2); ps.push(res.p); vs.push(res.cramersV);
    if (res.p < 0.05) sig++;
  }
  x2s.sort((a, b) => a - b); ps.sort((a, b) => a - b); vs.sort((a, b) => a - b);
  const sampleSize = genera.length;
  const df = chiSquareTest(weighted).df;
  return {
    genera: sampleSize,
    weighted,
    weightedTest: chiSquareTest(weighted),
    draws, tested, df,
    medianX2: quantile(x2s, 0.5),
    medianP: quantile(ps, 0.5),
    pQuartiles: [quantile(ps, 0.25), quantile(ps, 0.75)],
    medianV: quantile(vs, 0.5),
    shareSignificant: tested ? sig / tested : NaN,
  };
}

// Model 3: areal control. Tests whether A and B are associated within
// macroareas (conditional independence given area), with a stratified
// permutation p-value. Also reports, per cell, in how many areas the
// combination is more common than expected when genera are weighted
// equally (Dryer-style areal consistency).
export function modelArealControl(records, rows, cols, nAreas, { reps = 2000, seed = 3 } = {}) {
  const perArea = Array.from({ length: nAreas }, () => []);
  for (const r of records) perArea[r.area].push(r);
  const tables = perArea.map(rs => crossTable(rs, rows, cols));
  const strat = stratifiedChiSquare(tables);
  const perm = strat.testable
    ? permutationP(records, rows, cols, { strata: r => r.area, reps, rng: makeRng(seed) })
    : null;

  const consistency = rows.map(() => cols.map(() => ({ over: 0, possible: 0 })));
  perArea.forEach(rs => {
    if (!rs.length) return;
    const genusCount = new Map();
    for (const r of rs) genusCount.set(r.genus, (genusCount.get(r.genus) || 0) + 1);
    const w = crossTable(rs, rows, cols, r => 1 / genusCount.get(r.genus));
    const { rowSums, colSums, n } = margins(w);
    w.forEach((row, i) => row.forEach((o, j) => {
      if (rowSums[i] === 0 || colSums[j] === 0) return;
      const e = rowSums[i] * colSums[j] / n;
      consistency[i][j].possible++;
      if (o > e + 1e-9) consistency[i][j].over++;
    }));
  });

  const areaSummaries = perArea.map((rs, k) => ({
    area: k,
    n: rs.length,
    genera: new Set(rs.map(r => r.genus)).size,
    table: tables[k],
    test: strat.per[k],
  }));
  return { strat, permP: perm ? perm.p : NaN, reps, consistency, areaSummaries };
}
