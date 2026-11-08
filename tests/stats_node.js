// Runs js/stats.js on the given feature pairs and prints JSON for
// tests/check_stats.py to compare against SciPy / an independent Python
// implementation.
import { readFileSync } from "node:fs";
import { buildRecords, valueLists } from "../js/data.js";
import { modelAllLanguages, modelControlled, chiSquareP } from "../js/stats.js";

const data = JSON.parse(readFileSync(new URL("../data/wals.json", import.meta.url)));
const pairs = JSON.parse(process.argv[2]);
const out = [];
for (const [fa, fb] of pairs) {
  const A = data.features.find(f => f.id === fa);
  const B = data.features.find(f => f.id === fb);
  const records = buildRecords(data, A, B);
  const { rows, cols } = valueLists(A, B);
  const m1 = modelAllLanguages(records, rows, cols, { reps: 200 });
  const m2 = modelControlled(records, rows, cols, r => `${data.genusFamily[r.genus]}|${r.area}`, { reps: 200 });
  out.push({
    pair: [fa, fb],
    records: records.map(r => [r.lang, r.a, r.b, data.genusFamily[r.genus], r.area]),
    rows, cols,
    m1: { table: m1.table, x2: m1.test.x2, df: m1.test.df, p: m1.test.p, v: m1.test.cramersV,
          residuals: m1.test.residuals, permP: m1.permP },
    m2: { p: m2.p, z: m2.z, observed: m2.observed, expected: m2.expected,
          usableLanguages: m2.usableLanguages, usableGroups: m2.usableGroups },
  });
}
out.push({ pvals: [[3.84, 1], [10, 4], [100, 20], [0.5, 3], [250, 30]].map(([x, d]) => [x, d, chiSquareP(x, d)]) });
console.log(JSON.stringify(out));
