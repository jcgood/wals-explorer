// Candidate fix check: permutation within families (and within family x area)
// under the same family-inherited null as null_family.js, plus how often the
// fix still finds associations in the REAL data (rough power check).
// Usage: node tests/null_family_fix.js 69A 81A 40 0.8
import { readFileSync } from "node:fs";
import { buildRecords, valueLists } from "../js/data.js";
import { permutationP, makeRng } from "../js/stats.js";

const [fa, fb, nRep = "40", keepS = "0.8"] = process.argv.slice(2);
const KEEP = Number(keepS);
const data = JSON.parse(readFileSync(new URL("../data/wals.json", import.meta.url)));
const A = data.features.find(f => f.id === fa), B = data.features.find(f => f.id === fb);
const base = buildRecords(data, A, B);
const { rows, cols } = valueLists(A, B);
const fam = r => data.genusFamily[r.genus];
const pool = base.map(r => r.b);
const rng = makeRng(777);
let fpFam = 0, fpFamArea = 0;
for (let rep = 0; rep < Number(nRep); rep++) {
  const inherited = new Map();
  const recs = base.map(r => {
    const f = fam(r);
    if (!inherited.has(f)) inherited.set(f, pool[Math.floor(rng() * pool.length)]);
    return { ...r, b: rng() < KEEP ? inherited.get(f) : pool[Math.floor(rng() * pool.length)] };
  });
  if (permutationP(recs, rows, cols, { strata: fam, reps: 200, rng: makeRng(rep + 1) }).p < 0.05) fpFam++;
  if (permutationP(recs, rows, cols, { strata: r => `${fam(r)}|${r.area}`, reps: 200, rng: makeRng(rep + 1) }).p < 0.05) fpFamArea++;
}
const real = permutationP(base, rows, cols, { strata: fam, reps: 1000, rng: makeRng(9) }).p;
const realFA = permutationP(base, rows, cols, { strata: r => `${fam(r)}|${r.area}`, reps: 1000, rng: makeRng(9) }).p;
const n = Number(nRep);
console.log(JSON.stringify({
  pair: `${fa}x${fb}`, keep: KEEP,
  falsePositive: { withinFamily: +(fpFam / n).toFixed(2), withinFamilyAndArea: +(fpFamArea / n).toFixed(2) },
  realDataP: { withinFamily: real, withinFamilyAndArea: realFA },
}));
