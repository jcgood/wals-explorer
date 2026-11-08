// Runs js/stats.js on the given feature pairs and prints JSON for
// tests/check_stats.py to compare against SciPy.
import { readFileSync } from "node:fs";
import { buildRecords, valueLists } from "../js/data.js";
import { modelAllLanguages, modelGenusSampling, modelArealControl, chiSquareP } from "../js/stats.js";

const data = JSON.parse(readFileSync(new URL("../data/wals.json", import.meta.url)));
const pairs = JSON.parse(process.argv[2]);
const out = [];
for (const [fa, fb] of pairs) {
  const A = data.features.find(f => f.id === fa);
  const B = data.features.find(f => f.id === fb);
  const records = buildRecords(data, A, B);
  const { rows, cols } = valueLists(A, B);
  const m1 = modelAllLanguages(records, rows, cols, { reps: 200 });
  const m2 = modelGenusSampling(records, rows, cols, { draws: 50 });
  const m3 = modelArealControl(records, rows, cols, data.macroareas.length, { reps: 200 });
  out.push({
    pair: [fa, fb],
    records: records.map(r => [r.lang, r.a, r.b, r.genus, r.area]),
    rows, cols,
    m1: { table: m1.table, x2: m1.test.x2, df: m1.test.df, p: m1.test.p, v: m1.test.cramersV,
          residuals: m1.test.residuals, permP: m1.permP },
    m2: { weighted: m2.weighted, genera: m2.genera },
    m3: { x2: m3.strat.x2, df: m3.strat.df, p: m3.strat.p, permP: m3.permP },
  });
}
out.push({ pvals: [[3.84, 1], [10, 4], [100, 20], [0.5, 3], [250, 30]].map(([x, d]) => [x, d, chiSquareP(x, d)]) });
console.log(JSON.stringify(out));
