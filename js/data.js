// Joining two WALS features into per-language records.

// Records for languages coded for both features A and B.
export function buildRecords(data, A, B) {
  const aByLang = new Map();
  A.lang.forEach((l, i) => aByLang.set(l, A.val[i]));
  const L = data.languages;
  const out = [];
  B.lang.forEach((l, i) => {
    if (!aByLang.has(l)) return;
    out.push({ lang: l, a: aByLang.get(l), b: B.val[i], genus: L.genus[l], area: L.area[l] });
  });
  return out;
}

// Value numbers in WALS order, for table rows (A) and columns (B).
export function valueLists(A, B) {
  const nums = f => Object.keys(f.values).map(Number).sort((x, y) => x - y);
  return { rows: nums(A), cols: nums(B) };
}
