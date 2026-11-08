#!/usr/bin/env python3
"""Check js/stats.js against SciPy on real WALS feature pairs.

Usage: python3 tests/check_stats.py
"""
import json
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from scipy.stats import chi2, chi2_contingency

ROOT = Path(__file__).resolve().parent.parent
PAIRS = [["26A", "81A"], ["51A", "83A"], ["49A", "87A"], ["30A", "92A"], ["112A", "143A"]]

out = subprocess.run(
    ["node", str(ROOT / "tests" / "stats_node.js"), json.dumps(PAIRS)],
    capture_output=True, text=True, check=True,
).stdout
results = json.loads(out)
fail = 0


def close(a, b, tol=1e-6, what=""):
    global fail
    ok = (np.isnan(a) and np.isnan(b)) or abs(a - b) <= tol * max(1, abs(b))
    if not ok:
        fail += 1
        print(f"  MISMATCH {what}: js={a} scipy={b}")
    return ok


def scipy_test(t):
    t = np.array(t, dtype=float)
    t = t[t.sum(1) > 0][:, t.sum(0) > 0]
    if min(t.shape) < 2:
        return None
    x2, p, df, exp = chi2_contingency(t, correction=False)
    return x2, p, df, exp, t


for res in results[:-1]:
    fa, fb = res["pair"]
    rows, cols = res["rows"], res["cols"]
    recs = res["records"]
    print(f"{fa} x {fb}: N={len(recs)}")

    # Table from raw records, independently of the JS.
    ri = {v: i for i, v in enumerate(rows)}
    ci = {v: i for i, v in enumerate(cols)}
    t = np.zeros((len(rows), len(cols)))
    for _, a, b, _, _ in recs:
        t[ri[a], ci[b]] += 1
    assert (t == np.array(res["m1"]["table"])).all(), "table differs"

    x2, p, df, exp, tt = scipy_test(t)
    close(res["m1"]["x2"], x2, what="X2")
    close(res["m1"]["df"], df, what="df")
    close(res["m1"]["p"], p, tol=1e-6, what="p")
    k = min(tt.shape) - 1
    close(res["m1"]["v"], np.sqrt(x2 / (tt.sum() * k)), what="Cramer's V")

    # Adjusted residuals, computed from scratch.
    n = t.sum(); rs = t.sum(1); cs = t.sum(0)
    for i in range(len(rows)):
        for j in range(len(cols)):
            r = res["m1"]["residuals"][i][j]
            if rs[i] == 0 or cs[j] == 0:
                assert r is None
                continue
            e = rs[i] * cs[j] / n
            adj = (t[i, j] - e) / np.sqrt(e * (1 - rs[i] / n) * (1 - cs[j] / n))
            close(r, adj, what=f"residual[{i}][{j}]")

    # Genus-weighted table.
    gsize = Counter(g for *_, g, _ in recs)
    w = np.zeros_like(t)
    for _, a, b, g, _ in recs:
        w[ri[a], ci[b]] += 1 / gsize[g]
    assert np.allclose(w, np.array(res["m2"]["weighted"])), "weighted table differs"
    assert res["m2"]["genera"] == len(gsize)

    # Stratified chi-square (sum over areas).
    by_area = defaultdict(lambda: np.zeros_like(t))
    for _, a, b, _, ar in recs:
        by_area[ar][ri[a], ci[b]] += 1
    sx2 = sdf = 0
    for tab in by_area.values():
        r = scipy_test(tab)
        if r:
            sx2 += r[0]; sdf += r[2]
    close(res["m3"]["x2"], sx2, what="stratified X2")
    close(res["m3"]["df"], sdf, what="stratified df")
    close(res["m3"]["p"], chi2.sf(sx2, sdf), what="stratified p")
    print(f"  X2={x2:.2f} df={df} p={p:.3g} | perm p={res['m1']['permP']:.3g} | "
          f"areal X2={sx2:.2f} df={sdf} perm p={res['m3']['permP']:.3g}")

for x, d, pjs in results[-1]["pvals"]:
    close(pjs, chi2.sf(x, d), what=f"chi2.sf({x},{d})")

print("ALL OK" if fail == 0 else f"{fail} MISMATCHES")
raise SystemExit(1 if fail else 0)
