// Checks for the proposed within-family permutation fix.
// (a) Contact null: B spreads by contact. Languages are grouped into
//     10-degree latitude/longitude cells; each cell gets one "shared" B value,
//     kept with probability KEEP. A keeps its real values. Count false positives.
// (b) Real data: over a random sample of allowed pairs, how often each test
//     gives p < 0.05, and what share of languages sit in families that can
//     contribute (2+ languages in the pair, both features varying).
// Usage: node tests/fix_checks.js [nPairs=120]
import { readFileSync } from "node:fs";
import { buildRecords, valueLists } from "../js/data.js";
import { permutationP, makeRng } from "../js/stats.js";

const nPairs = Number(process.argv[2] || 120);
const data = JSON.parse(readFileSync(new URL("../data/wals.json", import.meta.url)));
const F = id => data.features.find(f => f.id === id);
const fam = r => data.genusFamily[r.genus];
const famArea = r => `${fam(r)}|${r.area}`;
const L = data.languages;
const cell = r => `${Math.floor(L.lat[r.lang] / 10)}|${Math.floor(L.lon[r.lang] / 10)}`;

function contactNull(fa, fb, runs, keep) {
  const A = F(fa), B = F(fb);
  const base = buildRecords(data, A, B);
  const { rows, cols } = valueLists(A, B);
  const pool = base.map(r => r.b);
  const rng = makeRng(4242);
  const fp = { all: 0, area: 0, family: 0, familyArea: 0 };
  for (let k = 0; k < runs; k++) {
    const shared = new Map();
    const recs = base.map(r => {
      const c = cell(r);
      if (!shared.has(c)) shared.set(c, pool[Math.floor(rng() * pool.length)]);
      return { ...r, b: rng() < keep ? shared.get(c) : pool[Math.floor(rng() * pool.length)] };
    });
    const t = (strata) => permutationP(recs, rows, cols, { strata, reps: 200, rng: makeRng(k + 1) }).p < 0.05;
    if (t(null)) fp.all++;
    if (t(r => r.area)) fp.area++;
    if (t(fam)) fp.family++;
    if (t(famArea)) fp.familyArea++;
  }
  for (const k of Object.keys(fp)) fp[k] = +(fp[k] / runs).toFixed(2);
  return { pair: `${fa}x${fb}`, keep, runs, falsePositive: fp };
}

console.log(JSON.stringify(contactNull("69A", "81A", 30, 0.8)));
console.log(JSON.stringify(contactNull("49A", "51A", 30, 0.8)));

// (b) Real data over a random sample of allowed pairs.
const EXCL = new Set(["26A", "95A", "96A", "97A", "31A", "32A", "77A", "113A", "143A", "144A", "38A", "82A", "84A"]);
const ok = f => f.lang.length >= 250 && !EXCL.has(f.id) && f.id.endsWith("A");
const morph = data.features.filter(f => ok(f) && (f.cls === "morph" || f.cls === "mixed"));
const syn = data.features.filter(f => ok(f) && (f.cls === "syn" || f.cls === "mixed"));
const pairs = [];
for (let i = 0; i < morph.length; i++) {
  for (let j = i + 1; j < morph.length; j++) pairs.push([morph[i], morph[j]]);
  for (const s of syn) if (s.id !== morph[i].id) pairs.push([morph[i], s]);
}
const rng = makeRng(99);
const sample = [];
const seen = new Set();
while (sample.length < Math.min(nPairs, pairs.length)) {
  const k = Math.floor(rng() * pairs.length);
  if (!seen.has(k)) { seen.add(k); sample.push(pairs[k]); }
}
const sig = { all: 0, area: 0, family: 0, familyArea: 0 };
let used = 0, informativeShare = 0, informativeFA = 0;
for (const [A, B] of sample) {
  const recs = buildRecords(data, A, B);
  if (recs.length < 30) continue;
  used++;
  const { rows, cols } = valueLists(A, B);
  const t = (strata) => permutationP(recs, rows, cols, { strata, reps: 200, rng: makeRng(used) }).p < 0.05;
  if (t(null)) sig.all++;
  if (t(r => r.area)) sig.area++;
  if (t(fam)) sig.family++;
  if (t(famArea)) sig.familyArea++;
  const share = key => {
    const g = new Map();
    for (const r of recs) { const k = key(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
    let n = 0;
    for (const rs of g.values()) {
      if (rs.length >= 2 && new Set(rs.map(r => r.a)).size > 1 && new Set(rs.map(r => r.b)).size > 1) n += rs.length;
    }
    return n / recs.length;
  };
  informativeShare += share(fam);
  informativeFA += share(famArea);
}
for (const k of Object.keys(sig)) sig[k] = +(sig[k] / used).toFixed(2);
console.log(JSON.stringify({
  realPairsSampled: used,
  shareSignificant: sig,
  languagesInUsableStrata: { family: +(informativeShare / used).toFixed(2), familyArea: +(informativeFA / used).toFixed(2) },
}));
