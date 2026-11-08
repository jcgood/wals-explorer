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

MORPH = ["26A", "51A", "49A", "30A", "112A"]
SYN = ["81A", "83A", "87A", "92A", "143A"]
PAIRS = [("26A", "81A"), ("51A", "83A"), ("49A", "87A")]

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
        disabled = page.eval_on_selector("#morph-1 option[value='26A']", "o => o.disabled")
        if not disabled:
            problems.append("duplicate feature not disabled")

        for a, b in PAIRS:
            page.select_option("#pair-a", a)
            page.select_option("#pair-b", b)
            page.click("#pair-form button[type=submit]")
        # Duplicate pair is refused.
        page.select_option("#pair-a", "81A"); page.select_option("#pair-b", "26A")
        page.click("#pair-form button[type=submit]")
        if "already" not in page.inner_text("#pair-error"):
            problems.append("duplicate pair not refused")
        print("pair status:", page.inner_text("#pair-status"))

        t0 = time.time()
        page.click("#pair-list li:nth-child(1) button:has-text('Show results')")
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
        if page.locator("#pair-list li").count() != len(PAIRS):
            problems.append("pairs not restored from link")

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
