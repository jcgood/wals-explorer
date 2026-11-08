#!/usr/bin/env python3
"""Build data/wals.json for the site from a WALS CLDF release.

Usage:
    python3 scripts/build_data.py /path/to/wals/cldf

Get the CLDF release with:
    git clone --depth 1 https://github.com/cldf-datasets/wals.git

Only features from the WALS areas relevant to morphology and syntax are
kept (see AREA_CLASS). Every language that has feature data in WALS has a
genus, family, macroarea and coordinates, so no imputation is needed; the
script checks this and stops if a future release breaks it.
"""
import csv
import json
import subprocess
import sys
from pathlib import Path

# WALS area -> class used by the site. "mixed" features are offered in
# both the morphological and the syntactic lists.
AREA_CLASS = {
    "Morphology": "morph",
    "Nominal Categories": "morph",
    "Verbal Categories": "morph",
    "Nominal Syntax": "mixed",
    "Simple Clauses": "mixed",
    "Word Order": "syn",
    "Complex Sentences": "syn",
}
MACROAREAS = ["Africa", "Eurasia", "Papunesia", "Australia", "North America", "South America"]


def read(d: Path, name: str):
    with open(d / name, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main() -> None:
    cldf = Path(sys.argv[1])
    out = Path(__file__).resolve().parent.parent / "data" / "wals.json"

    areas = {a["ID"]: a["Name"] for a in read(cldf, "areas.csv")}
    chapters = {c["ID"]: c for c in read(cldf, "chapters.csv")}
    params = read(cldf, "parameters.csv")
    codes = read(cldf, "codes.csv")
    values = read(cldf, "values.csv")
    langs_all = {l["ID"]: l for l in read(cldf, "languages.csv")}

    feats = []
    for p in params:
        area = areas[chapters[p["Chapter_ID"]]["Area_ID"]]
        if area in AREA_CLASS:
            feats.append((p, area))
    keep_ids = {p["ID"] for p, _ in feats}

    used_langs = sorted({v["Language_ID"] for v in values if v["Parameter_ID"] in keep_ids})
    for lid in used_langs:
        l = langs_all[lid]
        if not (l["Genus"] and l["Family"] and l["Macroarea"] and l["Latitude"] and l["Longitude"]):
            raise SystemExit(f"Language {lid} lacks genus/family/area/coordinates -- update this script.")
        if l["Macroarea"] not in MACROAREAS:
            raise SystemExit(f"Unknown macroarea {l['Macroarea']!r} for {lid}.")

    families = sorted({langs_all[i]["Family"] for i in used_langs})
    genera = sorted({(langs_all[i]["Family"], langs_all[i]["Genus"]) for i in used_langs})
    fam_idx = {f: n for n, f in enumerate(families)}
    gen_idx = {g: n for n, g in enumerate(genera)}
    lang_idx = {lid: n for n, lid in enumerate(used_langs)}

    languages = {
        "id": used_langs,
        "name": [langs_all[i]["Name"] for i in used_langs],
        "lat": [round(float(langs_all[i]["Latitude"]), 3) for i in used_langs],
        "lon": [round(float(langs_all[i]["Longitude"]), 3) for i in used_langs],
        "area": [MACROAREAS.index(langs_all[i]["Macroarea"]) for i in used_langs],
        "genus": [gen_idx[(langs_all[i]["Family"], langs_all[i]["Genus"])] for i in used_langs],
    }

    labels = {}
    for c in codes:
        labels.setdefault(c["Parameter_ID"], {})[c["Number"]] = c["Name"]

    by_param = {}
    for v in values:
        if v["Parameter_ID"] in keep_ids:
            by_param.setdefault(v["Parameter_ID"], []).append((lang_idx[v["Language_ID"]], int(v["Value"])))

    features = []
    for p, area in feats:
        rows = sorted(by_param.get(p["ID"], []))
        features.append({
            "id": p["ID"],
            "name": p["Name"],
            "area": area,
            "cls": AREA_CLASS[area],
            "chapter": p["Chapter_ID"],
            "values": {int(k): v for k, v in sorted(labels[p["ID"]].items(), key=lambda kv: int(kv[0]))},
            "lang": [r[0] for r in rows],
            "val": [r[1] for r in rows],
        })
    features.sort(key=lambda f: (int("".join(ch for ch in f["id"] if ch.isdigit())), f["id"]))

    version = subprocess.run(
        ["git", "-C", str(cldf.parent), "describe", "--tags", "--always"],
        capture_output=True, text=True,
    ).stdout.strip() or "unknown"

    data = {
        "version": f"WALS Online {version} (CLDF)",
        "citation": "Dryer, Matthew S. & Haspelmath, Martin (eds.) 2013. The World Atlas of "
                    "Language Structures Online. Leipzig: Max Planck Institute for Evolutionary "
                    "Anthropology. https://wals.info",
        "license": "CC BY 4.0",
        "macroareas": MACROAREAS,
        "families": families,
        "genera": [g for _, g in genera],
        "genusFamily": [fam_idx[f] for f, _ in genera],
        "languages": languages,
        "features": features,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {out} ({out.stat().st_size // 1024} KB): {len(features)} features, "
          f"{len(used_langs)} languages, {len(genera)} genera, {len(families)} families.")


if __name__ == "__main__":
    main()
