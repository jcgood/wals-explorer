// Calibration: features A and B unrelated, but B is inherited within
// FAMILIES (as many WALS features are). A keeps its real values (which also
// cluster by family and area). Each family gets one "inherited" B value,
// kept by each language with probability KEEP, otherwise a random B value.
// Counts how often each test reports p < 0.05 (false positives); an honest
// test should be near 0.05.
// Usage: node tests/null_family.js 69A 81A 40 0.8
import { readFileSync } from "node:fs";
import { buildRecords, valueLists } from "../js/data.js";
import { modelAllLanguages, modelControlled, permutationP, makeRng } from "../js/stats.js";

const [fa, fb, nRep = "40", keepS = "0.8"] = process.argv.slice(2);
const KEEP = Number(keepS);
const data = JSON.parse(readFileSync(new URL("../data/wals.json", import.meta.url)));
const A = data.features.find(f => f.id === fa), B = data.features.find(f => f.id === fb);
const base = buildRecords(data, A, B);
const { rows, cols } = valueLists(A, B);
const fam = r => data.genusFamily[r.genus];
const pool = base.map(r => r.b);
const rng = makeRng(777);
let fp1 = 0, fpArea = 0, fp2 = 0;
for (let rep = 0; rep < Number(nRep); rep++) {
  const inherited = new Map();
  const recs = base.map(r => {
    const f = fam(r);
    if (!inherited.has(f)) inherited.set(f, pool[Math.floor(rng() * pool.length)]);
    return { ...r, b: rng() < KEEP ? inherited.get(f) : pool[Math.floor(rng() * pool.length)] };
  });
  if (modelAllLanguages(recs, rows, cols, { reps: 200, seed: rep + 1 }).permP < 0.05) fp1++;
  if (permutationP(recs, rows, cols, { strata: r => r.area, reps: 200, rng: makeRng(rep + 1) }).p < 0.05) fpArea++;
  if (modelControlled(recs, rows, cols, r => `${fam(r)}|${r.area}`, { reps: 200, seed: rep + 1 }).p < 0.05) fp2++;
}
const n = Number(nRep);
console.log(JSON.stringify({
  pair: `${fa}x${fb}`, keep: KEEP, runs: n,
  falsePositive: {
    model1_allLanguages: +(fp1 / n).toFixed(2),
    withinAreaOnly_old: +(fpArea / n).toFixed(2),
    model2_familyAndArea: +(fp2 / n).toFixed(2),
  },
}));
