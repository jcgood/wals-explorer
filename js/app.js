import { buildRecords, valueLists } from "./data.js";
import { modelAllLanguages, modelControlled, areaTables } from "./stats.js";

// ---------- settings ----------

const SLOTS = 3;                 // features per list
const MIN_LANGS = 250;           // features coded for fewer languages aren't offered
const SMALL_PAIR = 100;          // pairs sharing fewer languages get a warning
const PERM_REPS = 2000;

// Pairs where one feature's "no ..." value largely forces the other's
// (found in the 2026-11-08 statistics review), so an association is
// partly built into the coding.
const DEFINITIONAL = [
  ["49A", "51A", "“no morphological case” (49A) nearly always goes with “no case affixes” (51A)"],
  ["50A", "51A", "“no case-marking” (50A) nearly always goes with “no case affixes” (51A)"],
  ["102A", "103A", "languages with no verbal person marking (102A) are always coded “no person marking” in 103A"],
];
const STORAGE_KEY = "wals-explorer-v1";

const MORPH_AREAS = ["Morphology", "Nominal Categories", "Verbal Categories"];
const SYN_AREAS = ["Word Order", "Complex Sentences"];
const MIXED_AREAS = ["Nominal Syntax", "Simple Clauses"];

// Okabe–Ito colours, then Tol colours; "other" is grey.
const COLORS = ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00",
  "#CC79A7", "#882255", "#44AA99", "#332288", "#DDCC77"];
const OTHER_COLOR = "#9a9a9a";

// ---------- state ----------

let DATA = null;
const FEAT = new Map();
let state = { morph: Array(SLOTS).fill(""), syn: Array(SLOTS).fill(""), show: null };
let map = null;
let renderToken = 0;

// ---------- small helpers ----------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const $ = id => document.getElementById(id);
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "—");
const pct = x => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : "—");

function fmtP(p) {
  if (!Number.isFinite(p)) return "—";
  if (p < 0.001) return "< 0.001";
  return p.toFixed(3);
}

// Strength words scaled to table size (Cohen's guidelines for Cramér's V:
// small/medium/large = 0.1/0.3/0.5 divided by the square root of
// min(rows, columns) - 1), so bigger tables aren't all labelled "weak".
function sizeWord(v, k = 1) {
  if (!Number.isFinite(v)) return "";
  const s = Math.sqrt(Math.max(1, k));
  if (v < 0.1 / s) return "very weak";
  if (v < 0.3 / s) return "weak";
  if (v < 0.5 / s) return "moderate";
  return "strong";
}

function featureLabel(f) {
  return `${f.id} ${f.name}`;
}

const CLASS_WORD = { morph: "morphological", syn: "syntactic" };

const pairKey = (a, b) => `${a}~${b}`;

// Features left out on purpose (Jeff, 2026-11-08): derivative features, and
// in clusters of overlapping features all but the one that carries the
// most distinctions. Reasons are shown on the page.
const EXCLUDED = {
  "26A": "computed from the affix-position features of other chapters (e.g. 33A, 51A, 57A, 69A, 112A)",
  "95A": "combines 83A Order of Object and Verb with 85A Order of Adposition and Noun Phrase",
  "96A": "combines 83A Order of Object and Verb with 90A Order of Relative Clause and Noun",
  "97A": "combines 83A Order of Object and Verb with 87A Order of Adjective and Noun",
  "31A": "largely predictable from 30A Number of Genders, which draws more distinctions",
  "32A": "largely predictable from 30A Number of Genders, which draws more distinctions",
  "77A": "largely predictable from 78A Coding of Evidentiality, which draws more distinctions",
  "113A": "largely predictable from 114A Subtypes of Asymmetric Standard Negation, which draws more distinctions",
  "143A": "its values partly encode whether the negator is an affix or a word, which is what 112A Negative Morphemes measures",
  "144A": "its values partly encode whether the negator is an affix or a word, which is what 112A Negative Morphemes measures",
  "38A": "overlaps heavily with 37A Definite Articles (they share the value “no definite or indefinite article”)",
  "82A": "largely predictable from 81A Order of Subject, Object and Verb",
  "84A": "largely predictable from 83A Order of Object and Verb",
};

// Features need at least MIN_LANGS languages and must not be excluded; the
// syntactic list offers only the "A" feature of each WALS chapter.
const inList = (f, cls) =>
  f.lang.length >= MIN_LANGS && !EXCLUDED[f.id] && (cls === "morph" || f.id.endsWith("A"));

// Pairs are fixed by the design: morphology × morphology (each morphological
// feature with the others) and morphology × syntax (each with each).
function derivedPairs(s = state) {
  const m = s.morph.map((id, i) => ({ id, slot: i + 1 }));
  const mm = [], ms = [];
  for (let i = 0; i < SLOTS; i++) {
    for (let j = i + 1; j < SLOTS; j++) mm.push({ a: m[i], b: m[j] });
    for (let j = 0; j < SLOTS; j++) ms.push({ a: m[i], b: { id: s.syn[j], slot: j + 1 } });
  }
  return { mm, ms };
}

const readyPairs = (s = state) => {
  const { mm, ms } = derivedPairs(s);
  return [...mm, ...ms].filter(p => p.a.id && p.b.id).map(p => pairKey(p.a.id, p.b.id));
};

// ---------- saving and restoring ----------

function saveState() {
  const hash = new URLSearchParams();
  hash.set("m", state.morph.join(","));
  hash.set("s", state.syn.join(","));
  if (state.show) hash.set("show", state.show);
  history.replaceState(null, "", `#${hash.toString()}`);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
}

function restoreState() {
  const valid = (id, cls) => (FEAT.has(id) && inList(FEAT.get(id), cls) ? id : "");
  const clean = s => {
    const seen = new Set();
    const pick = (list, cls) => Array.from({ length: SLOTS }, (_, i) => {
      const id = valid((list || [])[i] || "", cls);
      if (!id || seen.has(id)) return "";
      seen.add(id);
      return id;
    });
    const morph = pick(s.morph, "morph");
    const syn = pick(s.syn, "syn");
    const show = readyPairs({ morph, syn }).includes(s.show) ? s.show : null;
    return { morph, syn, show };
  };
  if (location.hash.length > 1) {
    const h = new URLSearchParams(location.hash.slice(1));
    const split = k => (h.get(k) || "").split(",");
    state = clean({ morph: split("m"), syn: split("s"), show: h.get("show") });
    return;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved) state = clean(saved);
  } catch (e) { /* storage unavailable */ }
}

// ---------- step 1: features ----------

function buildFeatureSelect(cls, index) {
  const id = `${cls}-${index}`;
  const select = el("select", { id, "aria-describedby": `${id}-hint` });
  select.append(el("option", { value: "", text: "— Choose a feature —" }));
  const areas = cls === "morph" ? [...MORPH_AREAS, ...MIXED_AREAS] : [...SYN_AREAS, ...MIXED_AREAS];
  for (const area of areas) {
    const mixed = MIXED_AREAS.includes(area);
    const group = el("optgroup", { label: mixed ? `${area} (mixed)` : area });
    for (const f of DATA.features.filter(f => f.area === area && inList(f, cls))) {
      group.append(el("option", { value: f.id, text: `${featureLabel(f)} (${f.lang.length} languages)` }));
    }
    select.append(group);
  }
  select.value = state[cls][index];
  select.addEventListener("change", () => onFeatureChange(cls, index, select.value));
  const word = CLASS_WORD[cls];
  return el("div", { class: "field" },
    el("label", { for: id, text: `${word[0].toUpperCase()}${word.slice(1)} feature ${index + 1}` }),
    select,
    el("span", { class: "hint", id: `${id}-hint` }));
}

function updateFeatureHints() {
  const chosen = new Set([...state.morph, ...state.syn].filter(Boolean));
  for (const cls of ["morph", "syn"]) {
    state[cls].forEach((fid, i) => {
      const select = $(`${cls}-${i}`);
      for (const opt of select.querySelectorAll("option")) {
        opt.disabled = opt.value !== "" && opt.value !== fid && chosen.has(opt.value);
      }
      const hint = $(`${cls}-${i}-hint`);
      hint.replaceChildren();
      if (fid) {
        const f = FEAT.get(fid);
        const mixed = f.cls === "mixed" ? ` WALS area: ${f.area} (mixed).` : "";
        hint.append(`${f.lang.length} languages.${mixed} `,
          el("a", { href: `https://wals.info/chapter/${f.chapter}`, target: "_blank", rel: "noopener",
            text: `WALS chapter ${f.chapter}` }),
          el("span", { class: "visually-hidden", text: " (opens in a new tab)" }));
      }
    });
  }
  const nm = state.morph.filter(Boolean).length, ns = state.syn.filter(Boolean).length;
  $("feature-status").textContent =
    `You have chosen ${nm} of ${SLOTS} morphological and ${ns} of ${SLOTS} syntactic features. ` +
    "Features already chosen are unavailable in the other lists.";
}

function onFeatureChange(cls, index, value) {
  state[cls][index] = value;
  if (state.show && !readyPairs().includes(state.show)) {
    state.show = null;
    renderResults();
  }
  updateFeatureHints();
  renderPairs();
  saveState();
}

function clearAll() {
  state = { morph: Array(SLOTS).fill(""), syn: Array(SLOTS).fill(""), show: null };
  for (const cls of ["morph", "syn"]) {
    for (let i = 0; i < SLOTS; i++) $(`${cls}-${i}`).value = "";
  }
  updateFeatureHints();
  renderPairs();
  renderResults();
  saveState();
  $("feature-status").textContent = "All choices cleared. " + $("feature-status").textContent;
  $("morph-0").focus();
}

// ---------- step 2: pairs ----------

function renderPairList(list, pairs, aWord, bWord) {
  list.replaceChildren();
  for (const { a, b } of pairs) {
    const slotName = `${aWord} feature ${a.slot} × ${bWord} feature ${b.slot}`;
    if (!a.id || !b.id) {
      list.append(el("li", { class: "pending" }, el("div", { class: "pair-row" },
        el("span", { class: "pair-name" }, `${slotName}: not ready yet (choose both features above)`))));
      continue;
    }
    const name = `${featureLabel(FEAT.get(a.id))} × ${featureLabel(FEAT.get(b.id))}`;
    const current = state.show === pairKey(a.id, b.id);
    list.append(el("li", { class: current ? "current" : "" },
      el("div", { class: "pair-row" },
        el("span", { class: "pair-name", text: name }),
        el("button", {
          type: "button", class: "button small primary",
          "aria-label": `Show results for ${name}`,
          "aria-current": current ? "true" : null,
          onclick: () => showPair(a.id, b.id),
        }, "Show results"))));
  }
}

function renderPairs() {
  const { mm, ms } = derivedPairs();
  renderPairList($("pair-list-mm"), mm, "Morphological", "morphological");
  renderPairList($("pair-list-ms"), ms, "Morphological", "syntactic");
  const ready = p => p.a.id && p.b.id;
  const nmm = mm.filter(ready).length, nms = ms.filter(ready).length;
  $("pair-status").textContent =
    `${nmm} of ${mm.length} morphology–morphology pairs and ${nms} of ${ms.length} morphology–syntax pairs are ready.`;
}

function showPair(a, b) {
  state.show = pairKey(a, b);
  saveState();
  renderPairs();
  renderResults({ focus: true });
}

// ---------- step 3: results ----------

function nonEmpty(table) {
  const rows = table.map((r, i) => (r.some(x => x > 0) ? i : -1)).filter(i => i >= 0);
  const cols = table[0].map((_, j) => (table.some(r => r[j] > 0) ? j : -1)).filter(j => j >= 0);
  return { rows, cols };
}

// Generic matrix table. cell(i, j) returns {text, sub, cls}.
// Colour keys shown under shaded tables, so colour is never the only cue.
const KEY = {
  "pos strong": "Dark blue: clearly more languages than expected",
  "pos": "Light blue: somewhat more than expected",
  "neg strong": "Dark orange: clearly fewer languages than expected",
  "neg": "Light orange: somewhat fewer than expected",
};

function colorKey(entries) {
  return el("ul", { class: "color-key", "aria-label": "Colour key for the table above" },
    entries.map(([cls, text]) => el("li", {},
      el("span", { class: `key-swatch ${cls}`, "aria-hidden": "true" }), text)));
}

// `pick` (optional) makes nonzero cells clickable: pick.records(i, j)
// returns that cell's languages and pick.showOnMap(i, j) filters the map.
function matrixTable({ caption, A, B, rowVals, colVals, use, cell, totals, key, pick }) {
  const panel = el("div", { class: "lang-panel", hidden: true });
  const thead = el("thead", {}, el("tr", {},
    el("th", { scope: "col" }, `${A.name} × ${B.name}`),
    use.cols.map(j => el("th", { scope: "col", class: "num" }, B.values[colVals[j]])),
    totals ? el("th", { scope: "col", class: "num total" }, "Total") : null));
  const tbody = el("tbody", {}, use.rows.map(i => el("tr", {},
    el("th", { scope: "row" }, A.values[rowVals[i]]),
    use.cols.map(j => {
      const c = cell(i, j);
      const n = pick ? pick.records(i, j).length : 0;
      const combo = `${A.values[rowVals[i]]} + ${B.values[colVals[j]]}`;
      const main = n > 0
        ? el("button", {
          type: "button", class: "cell-btn", title: `List the ${n} language${n > 1 ? "s" : ""} with ${combo}`,
          "aria-label": `${c.text}. List the ${n} language${n > 1 ? "s" : ""} with ${combo}`,
          onclick: () => showLanguagePanel(panel, `${combo}${pick.suffix || ""}`, pick.records(i, j), () => pick.showOnMap(i, j)),
        }, c.text)
        : c.text;
      return el("td", { class: `num ${c.cls || ""}` }, main, c.sub ? el("span", { class: "cell-sub" }, c.sub) : null);
    }),
    totals ? el("td", { class: "num total" }, totals.row(i)) : null)));
  if (totals) {
    tbody.append(el("tr", { class: "total" },
      el("th", { scope: "row" }, "Total"),
      use.cols.map(j => el("td", { class: "num" }, totals.col(j))),
      el("td", { class: "num" }, totals.all())));
  }
  const scroll = el("div", { class: "table-scroll", tabindex: "0", role: "group", "aria-label": caption },
    el("table", {}, el("caption", { text: caption }), thead, tbody));
  if (!key && !pick) return scroll;
  return el("div", { class: "table-block" }, scroll, key ? colorKey(key) : null,
    pick ? el("p", { class: "status no-print" }, "Select a number to list the languages behind it.") : null, panel);
}

// List a cell's languages under its table, grouped by family and area.
function showLanguagePanel(panel, combo, recs, showOnMap) {
  const L = DATA.languages;
  const groups = new Map();
  for (const r of recs) {
    const k = `${DATA.families[DATA.genusFamily[r.genus]]} (${DATA.macroareas[r.area]})`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const sorted = [...groups].sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0]));
  const heading = el("h4", { tabindex: "-1" }, `${combo}: ${recs.length} language${recs.length > 1 ? "s" : ""}`);
  panel.replaceChildren(
    heading,
    el("p", { class: "status" }, `Grouped by family and area, largest group first (${sorted.length} group${sorted.length > 1 ? "s" : ""}). `,
      "If most languages come from one or two groups, the pattern may reflect shared history rather than a general tendency."),
    el("div", { class: "toolbar" },
      el("button", { type: "button", class: "button small", onclick: showOnMap }, "Show these on the map"),
      el("button", { type: "button", class: "button small", onclick: () => { panel.hidden = true; } }, "Close list")),
    el("ul", { class: "lang-groups" }, sorted.map(([k, rs]) => el("li", {},
      el("strong", {}, `${k}: ${rs.length}`), " — ",
      rs.map(r => L.name[r.lang]).sort((x, y) => x.localeCompare(y)).join(", ")))));
  panel.hidden = false;
  heading.focus();
}

// Cells where fewer than MIN_EXPECTED languages are expected aren't
// highlighted: one or two languages can produce huge residuals there.
const MIN_EXPECTED = 1;

function residualCell(r, o, e) {
  if (r === null || r === undefined) return { text: "—" };
  if (e < MIN_EXPECTED) {
    return { text: "—", sub: `observed ${fmt(o, 0)}, expected ${fmt(e, 1)}: too few to judge` };
  }
  const strong = Math.abs(r) >= 2;
  const word = strong ? (r > 0 ? " more" : " fewer") : "";
  return {
    text: Math.abs(r) < 0.05 ? "0.0" : `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}${word}`,
    sub: `observed ${fmt(o, Number.isInteger(o) ? 0 : 1)}, expected ${fmt(e, 1)}`,
    cls: r > 0 ? `pos${strong ? " strong" : ""}` : r < 0 ? `neg${strong ? " strong" : ""}` : "",
  };
}

function facts(entries) {
  return el("dl", { class: "facts" }, entries.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]));
}

function sectionHeading(id, text) {
  return el("h3", { id, tabindex: "-1" }, text);
}

function downloadFile(name, text, type = "text/csv") {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = v => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvLine = arr => arr.map(csvCell).join(",");

function renderResults({ focus = false } = {}) {
  const out = $("results");
  if (map) { map.remove(); map = null; }
  out.replaceChildren();
  $("results-placeholder").hidden = !!state.show;
  if (!state.show) { renderToken++; $("results-status").textContent = ""; return; }

  const [a, b] = state.show.split("~");
  const A = FEAT.get(a), B = FEAT.get(b);
  const title = `${featureLabel(A)} × ${featureLabel(B)}`;
  $("results-status").textContent = `Computing results for ${title}…`;

  // Let the status message paint before the heavier computation. The
  // token stops an older request from rendering after a newer one.
  const token = ++renderToken;
  setTimeout(() => {
    if (token !== renderToken) return;
    const records = buildRecords(DATA, A, B);
    const { rows, cols } = valueLists(A, B);
    out.append(el("h3", { id: "res-title", tabindex: "-1" }, title));
    if (!records.length) {
      out.append(el("p", {}, "No language in WALS is coded for both of these features, so they cannot be compared. Try a different pair."));
      $("results-status").textContent = `No languages are coded for both ${a} and ${b}.`;
      if (focus) $("res-title").focus();
      return;
    }
    const m1 = modelAllLanguages(records, rows, cols, { reps: PERM_REPS });
    const m2 = modelControlled(records, rows, cols, r => `${DATA.genusFamily[r.genus]}|${r.area}`, { reps: PERM_REPS });
    const areas = areaTables(records, rows, cols, DATA.macroareas.length);
    renderPairResults(out, { A, B, records, rows, cols, m1, m2, areas });
    $("results-status").textContent = `Results ready for ${title}.`;
    if (focus) $("res-title").focus();
  }, 30);
}

function renderPairResults(out, ctx) {
  const { A, B, records, rows, cols, m1 } = ctx;
  const L = DATA.languages;
  const generaN = new Set(records.map(r => r.genus)).size;
  const familiesN = new Set(records.map(r => DATA.genusFamily[r.genus])).size;

  out.append(el("p", {},
    `${records.length} languages are coded for both features (WALS codes ${A.lang.length} languages for ${A.id} and ${B.lang.length} for ${B.id}). ` +
    `They belong to ${generaN} genera in ${familiesN} families. Rows are values of ${A.id}; columns are values of ${B.id}.`));

  if (records.length < SMALL_PAIR) {
    out.append(el("p", { class: "warning" },
      `Only ${records.length} languages are coded for both features. With so few, the tables are sparse and the results are fragile, `,
      "especially for Model 2 (controlling for family and area). Treat any pattern here as tentative."));
  }

  const defn = DEFINITIONAL.find(([x, y]) => (x === A.id && y === B.id) || (x === B.id && y === A.id));
  if (defn) {
    out.append(el("p", { class: "warning" },
      `These two features overlap by definition: ${defn[2]}. Part of any association between them is built into how WALS codes them, `,
      "so focus on the other combinations of values."));
  }

  if (A.chapter === B.chapter) {
    out.append(el("p", { class: "warning" },
      `Both features come from WALS chapter ${A.chapter}. Features from the same chapter are often defined in terms of each other, ` +
      "so a strong association between them may be built into the coding rather than being a discovery about languages."));
  }

  // Toolbar
  const csvLanguages = () => {
    const lines = [csvLine(["wals_code", "language", "genus", "family", "macroarea", "latitude", "longitude",
      `${A.id}_value`, `${A.id}_label`, `${B.id}_value`, `${B.id}_label`])];
    for (const r of [...records].sort((x, y) => L.name[x.lang].localeCompare(L.name[y.lang]))) {
      lines.push(csvLine([L.id[r.lang], L.name[r.lang], DATA.genera[r.genus], DATA.families[DATA.genusFamily[r.genus]],
        DATA.macroareas[r.area], L.lat[r.lang], L.lon[r.lang], r.a, A.values[r.a], r.b, B.values[r.b]]));
    }
    downloadFile(`${A.id}-${B.id}-languages.csv`, lines.join("\n"));
  };
  const csvTables = () => downloadFile(`${A.id}-${B.id}-tables.csv`, tablesCsv(ctx));
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      $("results-status").textContent = "Link copied. Pasting it opens this analysis with your features and pairs.";
    } catch (e) {
      $("results-status").textContent = "Couldn't copy automatically; copy the address from your browser's address bar instead.";
    }
  };
  const savePdf = () => {
    const opened = [...out.querySelectorAll("details.print-open")].filter(d => !d.open);
    opened.forEach(d => { d.open = true; });
    const oldTitle = document.title;
    document.title = `WALS ${A.id} x ${B.id} results`;
    document.body.classList.add("printing");
    if (map) map.invalidateSize(false);
    const restore = () => {
      opened.forEach(d => { d.open = false; });
      document.title = oldTitle;
      document.body.classList.remove("printing");
      if (map) map.invalidateSize(false);
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    setTimeout(() => window.print(), 400);
  };
  out.prepend(el("div", { class: "print-only print-header" },
    el("p", {}, el("strong", {}, "WALS Feature Explorer"), ` · ${new Date().toLocaleDateString()} · ${DATA.version}`),
    el("p", {}, `Link to this analysis: ${location.href}`)));
  out.append(el("div", { class: "toolbar" },
    el("button", { type: "button", class: "button primary", onclick: savePdf,
      "aria-describedby": "pdf-hint" }, "Save as PDF (for your homework)"),
    el("a", { class: "button", href: `https://wals.info/combinations/${A.id}_${B.id}`, target: "_blank", rel: "noopener" },
      "Open this combination on WALS", el("span", { class: "visually-hidden" }, " (opens in a new tab)")),
    el("button", { type: "button", class: "button", onclick: csvLanguages }, "Download language list (CSV)"),
    el("button", { type: "button", class: "button", onclick: csvTables }, "Download tables (CSV)"),
    el("button", { type: "button", class: "button", onclick: copyLink }, "Copy link to this analysis")));
  out.append(el("p", { class: "status", id: "pdf-hint" },
    "“Save as PDF” opens your browser's print window with just these results laid out for paper. ",
    "Choose “Save as PDF” (or “Microsoft Print to PDF”) as the destination."));

  out.append(el("nav", { class: "results-nav", "aria-label": "Sections of these results" },
    el("ul", {}, [
      ["sec-map", "Map"], ["sec-desc", "Descriptive statistics"], ["sec-m1", "Model 1: all languages"],
      ["sec-m2", "Model 2: controlling for family and area"], ["sec-help", "How to read these results"],
    ].map(([id, t]) => el("li", {}, el("a", { href: `#${id}`, onclick: e => { e.preventDefault(); $(id).focus(); $(id).scrollIntoView(); } }, t))))));

  const byCell = new Map();
  for (const r of records) {
    const k = `${r.a}|${r.b}`;
    if (!byCell.has(k)) byCell.set(k, []);
    byCell.get(k).push(r);
  }
  ctx.pick = {
    records: (i, j) => byCell.get(`${rows[i]}|${cols[j]}`) || [],
    showOnMap: (i, j) => ctx.showOnMap && ctx.showOnMap(rows[i], cols[j]),
  };

  renderMap(out, ctx);
  renderDescriptive(out, ctx);
  renderModel1(out, ctx);
  renderModel2(out, ctx);
  renderHelp(out);
}

// ----- map -----

function renderMap(out, ctx) {
  const { A, B, records, rows, cols, m1 } = ctx;
  out.append(sectionHeading("sec-map", "Map of value combinations"));
  const combos = [];
  m1.table.forEach((r, i) => r.forEach((n, j) => { if (n > 0) combos.push({ i, j, n }); }));
  combos.sort((x, y) => y.n - x.n);
  combos.forEach((c, k) => {
    c.label = `${A.values[rows[c.i]]} + ${B.values[cols[c.j]]}`;
    c.color = k < COLORS.length ? COLORS[k] : OTHER_COLOR;
  });
  const comboOf = new Map(combos.map(c => [`${rows[c.i]}|${cols[c.j]}`, c]));
  const nOther = combos.filter(c => c.color === OTHER_COLOR).reduce((s, c) => s + c.n, 0);

  out.append(el("p", { class: "note" },
    "Each dot is one language, coloured by its combination of values. The map shows the same information as the tables ",
    "below and the downloadable language list; it is a visual aid, not the only way to get the data. ",
    "Use the map's + and − buttons or your keyboard's arrow keys and +/− after selecting the map to pan and zoom; click a dot for details."));

  const filterId = "map-filter";
  const filter = el("select", { id: filterId, class: "no-print" },
    el("option", { value: "", text: `All combinations (${records.length} languages)` }),
    combos.map((c, k) => el("option", { value: String(k), text: `${c.label} (${c.n})` })));
  out.append(el("div", { class: "field no-print" }, el("label", { for: filterId, text: "Show on the map" }), filter));

  // Used by the clickable table cells: show one combination on the map.
  ctx.showOnMap = (a, b) => {
    const k = combos.findIndex(c => rows[c.i] === a && cols[c.j] === b);
    filter.value = k >= 0 ? String(k) : "";
    filter.dispatchEvent(new Event("change"));
    $("sec-map").scrollIntoView();
    filter.focus();
  };

  const mapDiv = el("div", { id: "map", role: "region", "aria-label": `Map of ${records.length} languages coloured by their combination of ${A.id} and ${B.id} values. The same data is in the tables below.` });
  out.append(mapDiv);

  const legend = el("ul", { class: "legend", "aria-label": "Map legend" },
    combos.filter(c => c.color !== OTHER_COLOR).map(c =>
      el("li", {}, el("span", { class: "swatch", style: `background:${c.color}`, "aria-hidden": "true" }), `${c.label}: ${c.n}`)),
    nOther ? el("li", {}, el("span", { class: "swatch", style: `background:${OTHER_COLOR}`, "aria-hidden": "true" }),
      `Other, less common combinations: ${nOther}`) : null);
  out.append(legend);

  if (!window.L) {
    mapDiv.replaceChildren(el("p", { class: "warning" }, "The map library couldn't be loaded (perhaps you are offline). Everything else on this page still works."));
    return;
  }
  const Lf = window.L;
  map = Lf.map(mapDiv, { worldCopyJump: true, minZoom: 1, preferCanvas: true }).setView([15, 20], 2);
  Lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 8,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors; data &copy; WALS',
  }).addTo(map);
  const L = DATA.languages;
  const markers = records.map(r => {
    const c = comboOf.get(`${r.a}|${r.b}`);
    const popup = el("div", {},
      el("strong", {}, L.name[r.lang]), el("br"),
      `${DATA.genera[r.genus]} (${DATA.families[DATA.genusFamily[r.genus]]}), ${DATA.macroareas[r.area]}`, el("br"),
      `${A.id}: ${A.values[r.a]}`, el("br"), `${B.id}: ${B.values[r.b]}`);
    const m = Lf.circleMarker([L.lat[r.lang], L.lon[r.lang]], {
      radius: 5, weight: 1, color: "#222", fillColor: c.color, fillOpacity: 0.9,
    }).bindPopup(popup);
    m.combo = c;
    return m;
  });
  const layer = Lf.layerGroup(markers).addTo(map);
  filter.addEventListener("change", () => {
    layer.clearLayers();
    const k = filter.value;
    const keep = k === "" ? markers : markers.filter(m => m.combo === combos[Number(k)]);
    keep.forEach(m => layer.addLayer(m));
    $("results-status").textContent = k === "" ? `Map shows all ${records.length} languages.`
      : `Map shows ${keep.length} languages with ${combos[Number(k)].label}.`;
  });

  // Full language list, built only when opened.
  const details = el("details", {}, el("summary", {}, `List of all ${records.length} languages`));
  details.addEventListener("toggle", () => {
    if (!details.open || details.querySelector("table")) return;
    const sorted = [...records].sort((x, y) => L.name[x.lang].localeCompare(L.name[y.lang]));
    details.append(el("div", { class: "table-scroll", tabindex: "0", role: "group", "aria-label": "List of languages" },
      el("table", {},
        el("caption", {}, `Languages coded for both ${A.id} and ${B.id}`),
        el("thead", {}, el("tr", {}, ["Language", "Genus", "Family", "Area", A.id, B.id].map(h => el("th", { scope: "col" }, h)))),
        el("tbody", {}, sorted.map(r => el("tr", {},
          el("th", { scope: "row" }, L.name[r.lang]),
          el("td", {}, DATA.genera[r.genus]),
          el("td", {}, DATA.families[DATA.genusFamily[r.genus]]),
          el("td", {}, DATA.macroareas[r.area]),
          el("td", {}, A.values[r.a]),
          el("td", {}, B.values[r.b])))))));
  });
  out.append(details);
}

// ----- descriptive statistics -----

function renderDescriptive(out, { A, B, records, rows, cols, m1, areas, pick }) {
  out.append(sectionHeading("sec-desc", "Descriptive statistics"));
  const byArea = DATA.macroareas.map((name, k) => [name, records.filter(r => r.area === k).length]);
  out.append(facts([
    ["Languages", String(records.length)],
    ["Genera", String(new Set(records.map(r => r.genus)).size)],
    ["Families", String(new Set(records.map(r => DATA.genusFamily[r.genus])).size)],
    ["Languages per area", byArea.map(([n, c]) => `${n} ${c}`).join(", ")],
  ]));

  const t = m1.table;
  const use = nonEmpty(t);
  const { rowSums, colSums, n } = { rowSums: m1.test.rowSums, colSums: m1.test.colSums, n: m1.test.n };
  const holder = el("div");
  const views = {
    counts: () => matrixTable({
      caption: `Number of languages with each combination (rows: ${A.id}; columns: ${B.id})`,
      A, B, rowVals: rows, colVals: cols, use, pick,
      cell: (i, j) => ({ text: String(t[i][j]) }),
      totals: { row: i => String(rowSums[i]), col: j => String(colSums[j]), all: () => String(n) },
    }),
    row: () => matrixTable({
      caption: `Row percentages: of the languages with each ${A.id} value, the share with each ${B.id} value`,
      A, B, rowVals: rows, colVals: cols, use, pick,
      cell: (i, j) => ({ text: pct(t[i][j] / rowSums[i]) }),
      totals: { row: i => `100% (${rowSums[i]})`, col: j => pct(colSums[j] / n), all: () => `100% (${n})` },
    }),
    col: () => matrixTable({
      caption: `Column percentages: of the languages with each ${B.id} value, the share with each ${A.id} value`,
      A, B, rowVals: rows, colVals: cols, use, pick,
      cell: (i, j) => ({ text: pct(t[i][j] / colSums[j]) }),
      totals: { row: i => pct(rowSums[i] / n), col: j => `100% (${colSums[j]})`, all: () => `100% (${n})` },
    }),
  };
  const toggle = el("fieldset", { class: "view-toggle" }, el("legend", {}, "Show the table as"));
  [["counts", "Counts"], ["row", "Row percentages"], ["col", "Column percentages"]].forEach(([v, label], k) => {
    const id = `view-${v}`;
    toggle.append(el("span", {},
      el("input", { type: "radio", name: "desc-view", id, value: v, checked: k === 0,
        onchange: () => holder.replaceChildren(views[v]()) }),
      " ", el("label", { for: id }, label)));
  });
  holder.append(views.counts());
  out.append(toggle, holder);

  const hidden = (t.length - use.rows.length) + (t[0].length - use.cols.length);
  if (hidden) out.append(el("p", { class: "status" }, `${hidden} value${hidden > 1 ? "s" : ""} with no languages in this comparison ${hidden > 1 ? "are" : "is"} left out of the tables.`));

  const details = el("details", {}, el("summary", {}, "Show the table for each area"));
  areas.forEach(s => {
    const name = DATA.macroareas[s.area];
    details.append(el("h4", {}, `${name}: ${s.n} languages in ${s.genera} genera`));
    if (!s.n) { details.append(el("p", {}, "No languages in this area are coded for both features.")); return; }
    details.append(matrixTable({
      caption: `${name}: number of languages with each combination`,
      A, B, rowVals: rows, colVals: cols, use: nonEmpty(s.table),
      cell: (i, j) => ({ text: String(s.table[i][j]) }),
    }));
  });
  out.append(details);
}

// ----- model 1 -----

function verdict(p, what) {
  if (!Number.isFinite(p)) return "No test is possible: at least one feature has only one value among these languages.";
  return p < 0.05
    ? `By this measure the two features are associated ${what}: their values combine differently from what you would expect if they were independent.`
    : `By this measure there is no clear evidence that the two features are associated ${what}.`;
}

function renderModel1(out, { A, B, rows, cols, m1, pick }) {
  out.append(sectionHeading("sec-m1", "Model 1: all languages counted"));
  out.append(el("p", {}, "Every language counts once. ",
    `To get the p-value, the tool shuffles the ${B.id} values among the languages ${m1.reps.toLocaleString()} times, which breaks any real connection between the two features, `,
    "and counts how often a shuffled version looks as strongly associated as the real data. ",
    "This model treats every language as independent, which they are not: related and neighbouring languages tend to resemble each other, ",
    "so it often finds associations that are really just shared history. Use it as a starting point; Model 2 is the more trustworthy test."));
  const T = m1.test;
  const u = nonEmpty(m1.table);
  const k = Math.min(u.rows.length, u.cols.length) - 1;
  out.append(facts([
    ["p-value", fmtP(m1.permP)],
    ["Strength of association (0 to 1)", T.testable ? `${fmt(T.cramersV)} (${sizeWord(T.cramersV, k)} for a table this size)` : "—"],
  ]));
  out.append(el("p", {}, verdict(m1.permP, "across all languages")));
  out.append(matrixTable({
    caption: "Which combinations stand out: each number (an adjusted residual) shows how far a combination is from what you would expect if the features were unrelated. Values beyond ±2 (in bold, marked “more” or “fewer”) stand out.",
    key: RESIDUAL_KEY,
    A, B, rowVals: rows, colVals: cols, use: nonEmpty(m1.table),
    pick,
    cell: (i, j) => residualCell(T.residuals[i][j], m1.table[i][j], T.expected[i][j]),
  }));
}

const RESIDUAL_KEY = [
  ["pos strong", `${KEY["pos strong"]} (+2 or higher)`],
  ["pos", `${KEY.pos} (between 0 and +2)`],
  ["neg", `${KEY.neg} (between 0 and −2)`],
  ["neg strong", `${KEY["neg strong"]} (−2 or lower)`],
  ["", `No shading, “—”: fewer than ${MIN_EXPECTED} language expected, too few to judge`],
];

// ----- model 2 -----

function renderModel2(out, { A, B, rows, cols, m1, m2, pick }) {
  out.append(sectionHeading("sec-m2", "Model 2: controlling for family and area"));
  out.append(el("p", {}, "Related languages share features because they inherited them, and neighbouring languages share features through contact. ",
    "This model groups the languages by family within each of WALS's six large areas (for example, Bantu languages in Africa). ",
    `It then shuffles the ${B.id} values only among languages of the same group, ${m2.reps.toLocaleString()} times. `,
    "Each group keeps its own mix of values, so an association only counts if, within groups, languages with one value tend to have the other. ",
    "This is the more trustworthy of the two tests, but it is still approximate: neighbouring relatives that borrowed from each other can still look like evidence."));
  out.append(facts([
    ["p-value", fmtP(m2.p)],
    ["Languages that count", `${m2.usableLanguages} of ${m1.table.flat().reduce((s, x) => s + x, 0)} (${pct(m2.usableShare)}), in ${m2.usableGroups} groups`],
  ]));
  out.append(el("p", { class: "status" },
    "Languages that are the only member of their group, or in a group where everyone has the same value of a feature, can't be shuffled, so they don't count here."));
  out.append(el("p", {}, verdict(m2.p, "once family and area are taken into account")));
  out.append(matrixTable({
    caption: "Which combinations stand out within groups: each number compares a combination's count with what you would expect if, inside each family-and-area group, the features were unrelated. Values beyond ±2 (in bold, marked “more” or “fewer”) stand out.",
    key: RESIDUAL_KEY,
    A, B, rowVals: rows, colVals: cols, use: nonEmpty(m1.table),
    pick: {
      records: (i, j) => pick.records(i, j).filter(r => m2.usable.has(r)),
      showOnMap: pick.showOnMap,
      suffix: " (only the languages that count in Model 2)",
    },
    cell: (i, j) => residualCell(m2.z[i][j], m2.observed[i][j], m2.expected[i][j]),
  }));
}

// ----- help -----

function renderHelp(out) {
  out.append(el("h3", { id: "sec-help", tabindex: "-1", class: "no-print" }, "How to read these results"));
  const items = [
    ["What is a p-value?", "Imagine the two features had nothing to do with each other. The tool simulates that by shuffling one feature's values among the languages many times. The p-value is the share of shuffles that look at least as associated as the real data. A small p-value (by convention, below 0.05) means the real pattern would be surprising if the features were unrelated. A p-value does not tell you how strong or how interesting an association is; with many languages even weak associations get small p-values."],
    ["What do the numbers in the “which combinations stand out” tables mean?", "Each one compares how many languages have that combination with how many you would expect if the features were unrelated (statisticians call these residuals). Positive means more languages than expected; negative means fewer. Values beyond about ±2 stand out. They tell you which combinations make up the pattern. Cells where fewer than one language is expected show “—”: a single language there can look dramatic without meaning much."],
    ["What does “strength of association” mean?", "A number from 0 (no association) to 1 (each value of one feature predicts the other perfectly). Statisticians call it Cramér's V. Tables with many values naturally give smaller numbers, so the word next to it (very weak, weak, moderate, strong) takes the table's size into account. These words are rough guides only."],
    ["Why two models?", "Languages are not independent observations: related languages share features by inheritance and neighbouring languages share them by contact. Model 1 ignores this and so often finds associations that are really shared history. Model 2 only counts patterns that show up within families in the same area. An association that holds up in Model 2 is much more convincing than one that appears only in Model 1."],
    ["Testing several pairs", "Each test has about a 1 in 20 chance of coming out “significant” even when the features are unrelated. If you test six pairs, it would not be surprising for one of them to come out that way by chance, so look at the size and shape of a pattern, not just the p-value."],
    ["Things to keep in mind", "WALS's languages are not a random sample of the world's languages, and different features were coded for different sets of languages. Some features overlap by definition (for example, a language with no case at all has no case affixes either); the page warns you about these. A statistical association says nothing by itself about why the features go together; that is for you to think about."],
  ];
  out.append(el("div", { class: "help-block" },
    items.map(([q, a]) => el("details", {}, el("summary", {}, q), el("p", {}, a)))));
}

// ----- CSV of all tables -----

function tablesCsv({ A, B, rows, cols, m1, m2 }) {
  const lines = [];
  const header = [`${A.id} × ${B.id}`, ...cols.map(c => B.values[c])];
  const block = (title, f) => {
    lines.push(csvLine([title]));
    lines.push(csvLine(header));
    rows.forEach((r, i) => lines.push(csvLine([A.values[r], ...cols.map((_, j) => f(i, j))])));
    lines.push("");
  };
  block("Counts", (i, j) => m1.table[i][j]);
  block("Expected counts (Model 1)", (i, j) => fmt(m1.test.expected[i][j], 3));
  block("Adjusted residuals (Model 1)", (i, j) => (m1.test.residuals[i][j] === null ? "" : fmt(m1.test.residuals[i][j], 3)));
  block("Within-group residuals (Model 2)", (i, j) => (m2.z[i][j] === null ? "" : fmt(m2.z[i][j], 3)));
  lines.push(csvLine(["Model 1", "p-value", m1.permP, "strength (Cramer's V)", fmt(m1.test.cramersV, 3)]));
  lines.push(csvLine(["Model 2", "p-value", m2.p, "languages that count", m2.usableLanguages, "groups", m2.usableGroups]));
  lines.push(csvLine(["Data", DATA.version]));
  return lines.join("\n");
}

// ---------- start ----------

async function init() {
  try {
    const res = await fetch("data/wals.json");
    DATA = await res.json();
  } catch (e) {
    $("loading").textContent = "Couldn't load the WALS data. Check your connection and reload the page.";
    return;
  }
  for (const f of DATA.features) FEAT.set(f.id, f);
  restoreState();

  for (let i = 0; i < SLOTS; i++) {
    $("morph-slots").append(buildFeatureSelect("morph", i));
    $("syn-slots").append(buildFeatureSelect("syn", i));
  }
  $("clear-all").addEventListener("click", clearAll);
  $("min-langs").textContent = String(MIN_LANGS);
  $("excluded-list").replaceChildren(...Object.entries(EXCLUDED)
    .filter(([id]) => FEAT.has(id))
    .map(([id, why]) => el("li", {}, el("strong", {}, featureLabel(FEAT.get(id))), `: ${why}.`)));
  $("data-credit").replaceChildren(`Data: ${DATA.citation} Version: ${DATA.version}. Licence: ${DATA.license}. `,
    "Map tiles © OpenStreetMap contributors.");

  $("loading").remove();
  for (const id of ["features-section", "pairs-section", "results-section"]) $(id).hidden = false;
  updateFeatureHints();
  renderPairs();
  renderResults();
  saveState();
}

init();
