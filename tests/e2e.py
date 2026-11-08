#!/usr/bin/env python3
"""End-to-end check: drive the site like a student and run axe-core.

Usage (with the site served at the URL below, e.g. `python3 -m http.server 8765`):
    python3 tests/e2e.py [http://127.0.0.1:8765/] [screenshot-dir]
"""
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/"
SHOTS = Path(sys.argv[2]) if len(sys.argv) > 2 else None
AXE = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.8.4/axe.min.js"

MORPH = ["69A", "51A", "49A"]
EXCLUDED = ["26A", "95A", "96A", "97A", "31A", "32A", "77A", "113A", "143A", "144A", "38A", "82A", "84A"]
SYN = ["81A", "87A", "85A"]
N_PAIRS = 3 + 9

problems = []


def axe(page, label):
    page.add_script_tag(url=AXE)
    res = page.evaluate("async () => (await axe.run(document, {resultTypes: ['violations']})).violations"
                        ".map(v => ({id: v.id, impact: v.impact, help: v.help, n: v.nodes.length,"
                        " target: v.nodes.slice(0,3).map(n => n.target.join(' '))}))")
    print(f"axe ({label}): {len(res)} violation types")
    for v in res:
        print(f"  [{v['impact']}] {v['id']}: {v['help']} x{v['n']} {v['target']}")
    return res


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel="chrome")
    for scheme in ["light", "dark"]:
        ctx = browser.new_context(viewport={"width": 1280, "height": 900}, color_scheme=scheme)
        page = ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL)
        page.wait_for_selector("#morph-0")

        for i, f in enumerate(MORPH):
            page.select_option(f"#morph-{i}", f)
        for i, f in enumerate(SYN):
            page.select_option(f"#syn-{i}", f)
        # A feature chosen in one slot is disabled in the others.
        disabled = page.eval_on_selector("#morph-1 option[value='69A']", "o => o.disabled")
        offered = page.eval_on_selector_all("#morph-0 option, #syn-0 option", "os => os.map(o => o.value)")
        leaked = [x for x in EXCLUDED if x in offered]
        if leaked:
            problems.append(f"excluded features offered: {leaked}")
        if page.locator("#excluded-list li").count() != len(EXCLUDED):
            problems.append("excluded-features list incomplete")
        if not disabled:
            problems.append("duplicate feature not disabled")
        # Syntactic list offers only "A" features.
        non_a = page.eval_on_selector_all("#syn-0 option", "os => os.map(o => o.value).filter(v => v && !v.endsWith('A'))")
        if non_a:
            problems.append(f"non-A features in syntactic list: {non_a[:5]}")
        morph_non_a = page.eval_on_selector_all("#morph-0 option", "os => os.map(o => o.value).filter(v => v && !v.endsWith('A'))")
        print("morph list keeps non-A features:", len(morph_non_a))
        # Features below the language-count threshold are not offered.
        counts = page.eval_on_selector_all(
            "#morph-0 option, #syn-0 option",
            "os => os.filter(o => o.value).map(o => +((o.textContent.match(/\\((\\d+) languages\\)/) || [])[1]))")
        print("options offered (morph+syn):", len(counts), "smallest:", min(counts))
        if min(counts) < 250:
            problems.append(f"feature under 250 languages offered ({min(counts)})")

        print("pair status:", page.inner_text("#pair-status"))
        n_buttons = page.locator(".pair-list button:has-text('Show results')").count()
        if n_buttons != N_PAIRS:
            problems.append(f"expected {N_PAIRS} pairs, got {n_buttons}")

        t0 = time.time()
        page.click("#pair-list-ms li:nth-child(1) button:has-text('Show results')")
        page.wait_for_selector("#sec-m3")
        print(f"results rendered in {time.time() - t0:.2f}s")
        focused = page.evaluate("document.activeElement && document.activeElement.id")
        if focused != "res-title":
            problems.append(f"focus not moved to results (got {focused!r})")
        page.wait_for_timeout(1500)  # map tiles

        print("model 1:", page.inner_text("#sec-m1 + p + dl").replace("\n", " | "))
        page.click("text=List of all")
        page.select_option("#map-filter", "0")
        page.click("#view-row")

        if SHOTS:
            SHOTS.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(SHOTS / f"full-{scheme}.png"), full_page=True)
        axe(page, f"{scheme}, results shown")

        # Reload: the hash restores the analysis.
        page.reload()
        page.wait_for_selector("#sec-m3")
        if page.locator(".pair-list button:has-text('Show results')").count() != N_PAIRS:
            problems.append("pairs not restored from link")
        if "69A" not in page.inner_text("#res-title") or "81A" not in page.inner_text("#res-title"):
            problems.append("shown pair not restored from link")

        # Removing a feature leaves its pairs pending and clears results.
        page.select_option("#syn-0", "")
        if page.locator("#pair-list-ms li.pending").count() != 3:
            problems.append("pending pairs not shown after clearing a feature")
        if page.locator("#sec-m1").count():
            problems.append("results not cleared when their pair became incomplete")
        page.select_option("#syn-0", "81A")

        # "Clear all choices" empties everything, including the saved link.
        page.click("#clear-all")
        chosen = page.eval_on_selector_all("#features-section select", "ss => ss.filter(s => s.value).length")
        if chosen or page.locator(".pair-list button").count():
            problems.append("clear all left choices or pairs behind")
        page.reload()
        page.wait_for_selector("#morph-0")
        if page.eval_on_selector_all("#features-section select", "ss => ss.filter(s => s.value).length"):
            problems.append("cleared choices came back after reload")
        # A pair with few shared languages carries a warning.
        page.goto(URL + "#m=34A,54A,&s=,,&show=34A~54A")
        page.reload()
        page.wait_for_selector("#sec-m3")
        if "Only 78 languages" not in page.inner_text("#results"):
            problems.append("small-pair warning missing for 34A x 54A")
        page.goto(URL + "#m=69A,51A,49A&s=81A,87A,85A&show=69A~81A")
        page.reload()
        page.wait_for_selector("#sec-m3")

        # Narrow (phone) layout: no horizontal page scroll.
        page.set_viewport_size({"width": 375, "height": 800})
        page.wait_for_timeout(300)
        overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        if overflow > 1:
            problems.append(f"horizontal overflow at 375px: {overflow}px")
        if SHOTS and scheme == "light":
            page.screenshot(path=str(SHOTS / "phone.png"), full_page=False)

        if errors:
            problems.append(f"console errors ({scheme}): {errors[:5]}")
        ctx.close()
    browser.close()

print("PROBLEMS:" if problems else "No problems found.")
for pr in problems:
    print(" -", pr)
raise SystemExit(1 if problems else 0)
