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

// ---------- the two models ----------

// Model 1: every language counts once.
export function modelAllLanguages(records, rows, cols, { reps = 2000, seed = 1 } = {}) {
  const table = crossTable(records, rows, cols);
  const test = chiSquareTest(table);
  const perm = test.testable
    ? permutationP(records, rows, cols, { reps, rng: makeRng(seed) })
    : null;
  return { table, test, permP: perm ? perm.p : NaN, reps };
}

// Model 2: controlling for family and area. Languages are grouped by
// family within macroarea; the p-value shuffles feature-B values only within
// each group, so each group's overall mix of values is held fixed and only
// within-group pairings count as evidence. Groups that cannot vary (one
// language, or one value of either feature) are left out: they add nothing.
// Simulations (tests/null_family*.js, tests/fix_checks.js) put its false-
// positive rate at about 5% when features are inherited within families and
// about 10% when they spread locally by contact; it is approximate.
//
// Per cell, a pooled (Mantel-Haenszel) residual: observed count summed over
// groups, minus the within-group expected counts summed, divided by the
// square root of the summed within-group (hypergeometric) variances.
export function modelControlled(records, rows, cols, groupKey, { reps = 2000, seed = 2 } = {}) {
  const groups = new Map();
  for (const r of records) {
    const k = groupKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const usable = [...groups.values()].filter(g =>
    g.length >= 2 && new Set(g.map(r => r.a)).size > 1 && new Set(g.map(r => r.b)).size > 1);
  const usableRecords = usable.flat();

  const O = rows.map(() => cols.map(() => 0));
  const E = rows.map(() => cols.map(() => 0));
  const V = rows.map(() => cols.map(() => 0));
  for (const g of usable) {
    const t = crossTable(g, rows, cols);
    const { rowSums, colSums, n } = margins(t);
    t.forEach((row, i) => row.forEach((o, j) => {
      const r = rowSums[i], c = colSums[j];
      O[i][j] += o;
      E[i][j] += r * c / n;
      V[i][j] += r * c * (n - r) * (n - c) / (n * n * (n - 1));
    }));
  }
  const z = O.map((row, i) => row.map((o, j) => (V[i][j] > 0 ? (o - E[i][j]) / Math.sqrt(V[i][j]) : null)));

  const groupOf = new Map();
  usable.forEach((g, k) => g.forEach(r => groupOf.set(r, k)));
  const p = usable.length
    ? permutationP(usableRecords, rows, cols, { strata: r => groupOf.get(r), reps, rng: makeRng(seed) }).p
    : NaN;

  return {
    p, reps,
    groups: groups.size,
    usableGroups: usable.length,
    usableLanguages: usableRecords.length,
    usableShare: records.length ? usableRecords.length / records.length : 0,
    usable: new Set(usableRecords),
    observed: O, expected: E, z,
  };
}

// Counts per macroarea, for the descriptive tables.
export function areaTables(records, rows, cols, nAreas) {
  const perArea = Array.from({ length: nAreas }, () => []);
  for (const r of records) perArea[r.area].push(r);
  return perArea.map((rs, k) => ({
    area: k,
    n: rs.length,
    genera: new Set(rs.map(r => r.genus)).size,
    table: crossTable(rs, rows, cols),
  }));
}
