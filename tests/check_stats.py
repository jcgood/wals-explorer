#!/usr/bin/env python3
"""Check js/stats.js against SciPy and an independent Python implementation.

Usage: python3 tests/check_stats.py
"""
import json
import subprocess
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy.stats import chi2, chi2_contingency

ROOT = Path(__file__).resolve().parent.parent
PAIRS = [["69A", "81A"], ["51A", "83A"], ["49A", "87A"], ["30A", "92A"], ["112A", "85A"]]

out = subprocess.run(
    ["node", str(ROOT / "tests" / "stats_node.js"), json.dumps(PAIRS)],
    capture_output=True, text=True, check=True,
).stdout
results = json.loads(out)
fail = 0


def close(a, b, tol=1e-6, what=""):
    global fail
    if a is None or b is None:
        ok = a is None and b is None
    else:
        ok = (np.isnan(a) and np.isnan(b)) or abs(a - b) <= tol * max(1, abs(b))
    if not ok:
        fail += 1
        print(f"  MISMATCH {what}: js={a} python={b}")
    return ok


for res in results[:-1]:
    fa, fb = res["pair"]
    rows, cols = res["rows"], res["cols"]
    recs = res["records"]
    ri = {v: i for i, v in enumerate(rows)}
    ci = {v: i for i, v in enumerate(cols)}
    print(f"{fa} x {fb}: N={len(recs)}")

    # ----- Model 1 -----
    t = np.zeros((len(rows), len(cols)))
    for _, a, b, _, _ in recs:
        t[ri[a], ci[b]] += 1
    assert (t == np.array(res["m1"]["table"])).all(), "table differs"
    tt = t[t.sum(1) > 0][:, t.sum(0) > 0]
    x2, p, df, _ = chi2_contingency(tt, correction=False)
    close(res["m1"]["x2"], x2, what="X2")
    close(res["m1"]["df"], df, what="df")
    close(res["m1"]["p"], p, what="p")
    close(res["m1"]["v"], np.sqrt(x2 / (tt.sum() * (min(tt.shape) - 1))), what="Cramer's V")
    n = t.sum(); rs = t.sum(1); cs = t.sum(0)
    for i in range(len(rows)):
        for j in range(len(cols)):
            r = res["m1"]["residuals"][i][j]
            if rs[i] == 0 or cs[j] == 0:
                assert r is None
                continue
            e = rs[i] * cs[j] / n
            close(r, (t[i, j] - e) / np.sqrt(e * (1 - rs[i] / n) * (1 - cs[j] / n)), what=f"m1 residual[{i}][{j}]")

    # ----- Model 2: pooled within-group residuals, computed independently -----
    groups = defaultdict(list)
    for _, a, b, fam, area in recs:
        groups[(fam, area)].append((a, b))
    usable = [g for g in groups.values()
              if len(g) >= 2 and len({a for a, _ in g}) > 1 and len({b for _, b in g}) > 1]
    O = np.zeros_like(t); E = np.zeros_like(t); V = np.zeros_like(t)
    for g in usable:
        gt = np.zeros_like(t)
        for a, b in g:
            gt[ri[a], ci[b]] += 1
        gn = gt.sum(); grs = gt.sum(1); gcs = gt.sum(0)
        O += gt
        E += np.outer(grs, gcs) / gn
        V += np.outer(grs, gcs) * np.outer(gn - grs, gn - gcs) / (gn * gn * (gn - 1))
    close(res["m2"]["usableLanguages"], sum(len(g) for g in usable), what="usable languages")
    close(res["m2"]["usableGroups"], len(usable), what="usable groups")
    for i in range(len(rows)):
        for j in range(len(cols)):
            close(res["m2"]["observed"][i][j], O[i, j], what=f"m2 observed[{i}][{j}]")
            close(res["m2"]["expected"][i][j], E[i, j], what=f"m2 expected[{i}][{j}]")
            zj = res["m2"]["z"][i][j]
            zp = (O[i, j] - E[i, j]) / np.sqrt(V[i, j]) if V[i, j] > 0 else None
            close(zj, zp, what=f"m2 z[{i}][{j}]")
    assert 0 < res["m2"]["p"] <= 1
    print(f"  Model 1 perm p={res['m1']['permP']:.3g} | Model 2 perm p={res['m2']['p']:.3g} "
          f"({res['m2']['usableLanguages']} languages in {res['m2']['usableGroups']} groups)")

for x, d, pjs in results[-1]["pvals"]:
    close(pjs, chi2.sf(x, d), what=f"chi2.sf({x},{d})")

print("ALL OK" if fail == 0 else f"{fail} MISMATCHES")
raise SystemExit(1 if fail else 0)
