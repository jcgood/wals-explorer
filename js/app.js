import { buildRecords, valueLists } from "./data.js";
import { modelAllLanguages, modelGenusSampling, modelArealControl } from "./stats.js";

// ---------- settings ----------

const SLOTS = 3;                 // features per list
const MIN_LANGS = 250;           // features coded for fewer languages aren't offered
const SMALL_PAIR = 100;          // pairs sharing fewer languages get a warning
const PERM_REPS = 2000;
const GENUS_DRAWS = 1000;
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

function sizeWord(v) {
  if (!Number.isFinite(v)) return "";
  if (v < 0.1) return "negligible";
  if (v < 0.3) return "weak";
  if (v < 0.5) return "moderate";
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
function matrixTable({ caption, A, B, rowVals, colVals, use, cell, totals }) {
  const thead = el("thead", {}, el("tr", {},
    el("th", { scope: "col" }, `${A.name} \\ ${B.name}`),
    use.cols.map(j => el("th", { scope: "col", class: "num" }, B.values[colVals[j]])),
    totals ? el("th", { scope: "col", class: "num total" }, "Total") : null));
  const tbody = el("tbody", {}, use.rows.map(i => el("tr", {},
    el("th", { scope: "row" }, A.values[rowVals[i]]),
    use.cols.map(j => {
      const c = cell(i, j);
      return el("td", { class: `num ${c.cls || ""}` }, c.text, c.sub ? el("span", { class: "cell-sub" }, c.sub) : null);
    }),
    totals ? el("td", { class: "num total" }, totals.row(i)) : null)));
  if (totals) {
    tbody.append(el("tr", { class: "total" },
      el("th", { scope: "row" }, "Total"),
      use.cols.map(j => el("td", { class: "num" }, totals.col(j))),
      el("td", { class: "num" }, totals.all())));
  }
  return el("div", { class: "table-scroll", tabindex: "0", role: "group", "aria-label": caption },
    el("table", {}, el("caption", { text: caption }), thead, tbody));
}

function residualCell(r, o, e) {
  if (r === null) return { text: "—" };
  const strong = Math.abs(r) >= 2;
  const word = strong ? (r > 0 ? " more" : " fewer") : "";
  return {
    text: `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(1)}${word}`,
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
    const m2 = modelGenusSampling(records, rows, cols, { draws: GENUS_DRAWS });
    const m3 = modelArealControl(records, rows, cols, DATA.macroareas.length, { reps: PERM_REPS });
    renderPairResults(out, { A, B, records, rows, cols, m1, m2, m3 });
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
      "especially for Model 2 (one language per genus) and Model 3 (within areas). Treat any pattern here as tentative."));
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
  out.append(el("div", { class: "toolbar" },
    el("a", { class: "button", href: `https://wals.info/combinations/${A.id}_${B.id}`, target: "_blank", rel: "noopener" },
      "Open this combination on WALS", el("span", { class: "visually-hidden" }, " (opens in a new tab)")),
    el("button", { type: "button", class: "button", onclick: csvLanguages }, "Download language list (CSV)"),
    el("button", { type: "button", class: "button", onclick: csvTables }, "Download tables (CSV)"),
    el("button", { type: "button", class: "button", onclick: copyLink }, "Copy link to this analysis")));

  out.append(el("nav", { class: "results-nav", "aria-label": "Sections of these results" },
    el("ul", {}, [
      ["sec-map", "Map"], ["sec-desc", "Descriptive statistics"], ["sec-m1", "Model 1: all languages"],
      ["sec-m2", "Model 2: one language per genus"], ["sec-m3", "Model 3: controlling for area"], ["sec-help", "How to read these results"],
    ].map(([id, t]) => el("li", {}, el("a", { href: `#${id}`, onclick: e => { e.preventDefault(); $(id).focus(); $(id).scrollIntoView(); } }, t))))));

  renderMap(out, ctx);
  renderDescriptive(out, ctx);
  renderModel1(out, ctx);
  renderModel2(out, ctx);
  renderModel3(out, ctx);
  renderHelp(out);
}

// ----- map -----

function renderMap(out, { A, B, records, rows, cols, m1 }) {
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
  const filter = el("select", { id: filterId },
    el("option", { value: "", text: `All combinations (${records.length} languages)` }),
    combos.map((c, k) => el("option", { value: String(k), text: `${c.label} (${c.n})` })));
  out.append(el("div", { class: "field" }, el("label", { for: filterId, text: "Show on the map" }), filter));

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

function renderDescriptive(out, { A, B, records, rows, cols, m1 }) {
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
      A, B, rowVals: rows, colVals: cols, use,
      cell: (i, j) => ({ text: String(t[i][j]) }),
      totals: { row: i => String(rowSums[i]), col: j => String(colSums[j]), all: () => String(n) },
    }),
    row: () => matrixTable({
      caption: `Row percentages: of the languages with each ${A.id} value, the share with each ${B.id} value`,
      A, B, rowVals: rows, colVals: cols, use,
      cell: (i, j) => ({ text: pct(t[i][j] / rowSums[i]) }),
      totals: { row: i => `100% (${rowSums[i]})`, col: j => pct(colSums[j] / n), all: () => `100% (${n})` },
    }),
    col: () => matrixTable({
      caption: `Column percentages: of the languages with each ${B.id} value, the share with each ${A.id} value`,
      A, B, rowVals: rows, colVals: cols, use,
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
}

// ----- model 1 -----

function verdict(p, what) {
  if (!Number.isFinite(p)) return "No test is possible: at least one feature has only one value among these languages.";
  return p < 0.05
    ? `By this measure the two features are associated ${what}: their values combine differently from what you would expect if they were independent.`
    : `By this measure there is no clear evidence that the two features are associated ${what}.`;
}

function renderModel1(out, { A, B, rows, cols, m1 }) {
  out.append(sectionHeading("sec-m1", "Model 1: all languages counted"));
  out.append(el("p", {}, "Every language counts once. This is the standard chi-square test of independence. ",
    "It treats each language as an independent observation, which they are not: related languages and neighbouring languages tend to resemble each other. ",
    "Models 2 and 3 address that."));
  const T = m1.test;
  out.append(facts([
    ["Chi-square (χ²)", T.testable ? `${fmt(T.x2)} with ${T.df} degrees of freedom` : "—"],
    ["p-value (chi-square approximation)", fmtP(T.p)],
    [`p-value (permutation, ${m1.reps} shuffles)`, fmtP(m1.permP)],
    ["Cramér's V (strength, 0 to 1)", T.testable ? `${fmt(T.cramersV)} (${sizeWord(T.cramersV)})` : "—"],
  ]));
  if (T.testable && T.smallExpectedShare > 0.2) {
    out.append(el("p", { class: "warning" },
      `${pct(T.smallExpectedShare)} of the cells have an expected count below 5, so the chi-square approximation is unreliable here. `,
      "Use the permutation p-value instead."));
  }
  out.append(el("p", {}, verdict(m1.permP, "across all languages")));
  out.append(matrixTable({
    caption: "Adjusted residuals: how far each combination is from what independence predicts. Values beyond ±2 (in bold, marked “more” or “fewer”) stand out.",
    A, B, rowVals: rows, colVals: cols, use: nonEmpty(m1.table),
    cell: (i, j) => residualCell(T.residuals[i][j], m1.table[i][j], T.expected[i][j]),
  }));
}

// ----- model 2 -----

function renderModel2(out, { A, B, rows, cols, m2 }) {
  out.append(sectionHeading("sec-m2", "Model 2: one language per genus"));
  out.append(el("p", {}, "Languages in the same genus (a group of clearly related languages, such as Germanic or Romance) often share features because they inherited them. ",
    `This model draws ${m2.draws} random samples with exactly one language from each genus and runs the chi-square test on each sample. `,
    "If the association is real rather than an effect of a few large families, it should show up in most samples."));
  out.append(facts([
    ["Genera (= languages per sample)", String(m2.genera)],
    ["Median chi-square across samples", m2.tested ? `${fmt(m2.medianX2)} with ${m2.df} degrees of freedom` : "—"],
    ["Median p-value", fmtP(m2.medianP)],
    ["Middle half of p-values", m2.tested ? `${fmtP(m2.pQuartiles[0])} to ${fmtP(m2.pQuartiles[1])}` : "—"],
    ["Samples with p below 0.05", pct(m2.shareSignificant)],
    ["Median Cramér's V", m2.tested ? `${fmt(m2.medianV)} (${sizeWord(m2.medianV)})` : "—"],
  ]));
  const s = m2.shareSignificant;
  out.append(el("p", {}, !Number.isFinite(s) ? "No test is possible for this pair."
    : s >= 0.8 ? "The association holds up in nearly all one-per-genus samples, so it is not just an effect of a few large genera."
      : s >= 0.5 ? "The association shows up in most, but not all, one-per-genus samples: it is weaker once relatedness is controlled for."
        : "The association does not hold up consistently once each genus counts only once."));
  if (m2.weightedTest.testable && m2.weightedTest.smallExpectedShare > 0.2) {
    out.append(el("p", { class: "warning" }, "Many cells have small expected counts, so individual sample p-values are rough. Look at the pattern across samples rather than any single number."));
  }
  const W = m2.weighted, WT = m2.weightedTest;
  out.append(matrixTable({
    caption: "Genus-weighted counts: each genus counts once in total, shared among its languages. The ratio compares each count with what independence predicts (×1.0 = as expected); ×1.5 or more is marked “more”, ×0.67 or less “fewer”.",
    A, B, rowVals: rows, colVals: cols, use: nonEmpty(W),
    cell: (i, j) => {
      const o = W[i][j], e = WT.expected[i][j];
      const ratio = e > 0 ? o / e : NaN;
      if (e < 1) return { text: `${fmt(o, 1)}`, sub: `expected ${fmt(e, 1)}: too few to judge` };
      const cls = ratio >= 1.5 ? "pos strong" : ratio <= 1 / 1.5 ? "neg strong" : "";
      const word = ratio >= 1.5 ? " more" : ratio <= 1 / 1.5 ? " fewer" : "";
      return { text: `${fmt(o, 1)}${word}`, sub: `expected ${fmt(e, 1)}, ×${fmt(ratio, 1)}`, cls };
    },
  }));
}

// ----- model 3 -----

function renderModel3(out, { A, B, rows, cols, m1, m3 }) {
  out.append(sectionHeading("sec-m3", "Model 3: controlling for area"));
  out.append(el("p", {}, "Neighbouring languages influence each other, so a pattern can be common in one part of the world for historical reasons. ",
    "This model asks whether the two features are associated within each of WALS's six large areas (Africa, Eurasia, Papunesia, Australia, North America, South America), ",
    "by adding up the chi-square tests done separately in each area. Its permutation p-value shuffles values only among languages of the same area."));
  const S = m3.strat;
  const areasWithData = m3.areaSummaries.filter(s => s.n > 0).length;
  out.append(facts([
    ["Areas with data", `${areasWithData} of ${DATA.macroareas.length}`],
    ["Within-area chi-square (sum)", S.testable ? `${fmt(S.x2)} with ${S.df} degrees of freedom` : "—"],
    ["p-value (chi-square approximation)", fmtP(S.p)],
    [`p-value (permutation within areas, ${m3.reps} shuffles)`, fmtP(m3.permP)],
  ]));
  out.append(el("p", {}, verdict(m3.permP, "within areas")));
  out.append(el("p", {}, "The next table shows how consistent each combination is across areas. ",
    "In each area, genera are weighted equally (as in Model 2), and the table counts the areas where that combination is more common than independence predicts. ",
    "A combination that is over-represented in all or nearly all areas is a strong candidate for a real cross-linguistic preference (this is the logic of Dryer's areal method)."));
  out.append(matrixTable({
    caption: "Areas in which each combination is more common than expected (genera weighted equally within each area)",
    A, B, rowVals: rows, colVals: cols, use: nonEmpty(m1.table),
    cell: (i, j) => {
      const c = m3.consistency[i][j];
      if (!c.possible) return { text: "—" };
      const share = c.over / c.possible;
      const cls = c.possible >= 3 ? (share >= 0.8 ? "pos strong" : share <= 0.2 ? "neg strong" : "") : "";
      return { text: `${c.over} of ${c.possible}`, cls };
    },
  }));

  const details = el("details", {}, el("summary", {}, "Show the table for each area"));
  m3.areaSummaries.forEach(s => {
    const name = DATA.macroareas[s.area];
    details.append(el("h4", {}, `${name}: ${s.n} languages in ${s.genera} genera`));
    if (!s.n) { details.append(el("p", {}, "No languages in this area are coded for both features.")); return; }
    const use = nonEmpty(s.table);
    details.append(el("p", {}, s.test.testable
      ? `Chi-square ${fmt(s.test.x2)} with ${s.test.df} degrees of freedom (approximate p ${fmtP(s.test.p)}).`
      : "Only one value of a feature occurs here, so no test is possible in this area."));
    details.append(matrixTable({
      caption: `${name}: number of languages with each combination`,
      A, B, rowVals: rows, colVals: cols, use,
      cell: (i, j) => ({ text: String(s.table[i][j]) }),
    }));
  });
  out.append(details);
}

// ----- help -----

function renderHelp(out) {
  out.append(sectionHeading("sec-help", "How to read these results"));
  const items = [
    ["What is a p-value?", "The p-value is the probability of seeing an association at least this strong if the two features were in fact unrelated. Small values (by convention, below 0.05) suggest the association is not just chance. A p-value does not tell you how strong or how interesting an association is, and with many languages even tiny associations get small p-values."],
    ["Why two p-values?", "The chi-square approximation is quick but becomes unreliable when many cells have small expected counts, which is common with WALS features. The permutation p-value shuffles one feature's values among the languages thousands of times and counts how often the shuffled data look as associated as the real data. It makes no approximation, so prefer it when the two disagree."],
    ["What is an adjusted residual?", "For each combination, the residual compares the observed number of languages with the number expected if the features were independent, scaled so that values beyond about ±2 are unusual. Positive means more languages than expected; negative means fewer. Residuals tell you which combinations drive an association."],
    ["What is Cramér's V?", "A measure of strength from 0 (no association) to 1 (each value of one feature predicts the other perfectly). The words weak, moderate and strong are rough guides only."],
    ["Why three models?", "Languages are not independent observations. Related languages share features by inheritance (Model 2 handles this by counting each genus once) and neighbouring languages share features by contact (Model 3 handles this by looking within areas). An association that survives all three models is much more convincing than one that appears only in Model 1."],
    ["Things to keep in mind", "WALS's languages are not a random sample of the world's languages, and different features were coded for different sets of languages. Features in the same WALS chapter may be defined in terms of each other. A statistical association says nothing by itself about why the features go together; that is for you to think about."],
  ];
  items.forEach(([q, a]) => out.append(el("details", {}, el("summary", {}, q), el("p", {}, a))));
}

// ----- CSV of all tables -----

function tablesCsv({ A, B, rows, cols, m1, m2, m3 }) {
  const lines = [];
  const header = [`${A.id} \\ ${B.id}`, ...cols.map(c => B.values[c])];
  const block = (title, f) => {
    lines.push(csvLine([title]));
    lines.push(csvLine(header));
    rows.forEach((r, i) => lines.push(csvLine([A.values[r], ...cols.map((_, j) => f(i, j))])));
    lines.push("");
  };
  block("Counts", (i, j) => m1.table[i][j]);
  block("Expected counts (Model 1)", (i, j) => fmt(m1.test.expected[i][j], 3));
  block("Adjusted residuals (Model 1)", (i, j) => (m1.test.residuals[i][j] === null ? "" : fmt(m1.test.residuals[i][j], 3)));
  block("Genus-weighted counts (Model 2)", (i, j) => fmt(m2.weighted[i][j], 3));
  block("Areas where over-represented (Model 3)", (i, j) => `${m3.consistency[i][j].over}/${m3.consistency[i][j].possible}`);
  lines.push(csvLine(["Model 1 chi-square", fmt(m1.test.x2, 3), "df", m1.test.df, "p (approx)", m1.test.p, "p (permutation)", m1.permP, "Cramer's V", fmt(m1.test.cramersV, 3)]));
  lines.push(csvLine(["Model 2 genera", m2.genera, "median p", m2.medianP, "share p<0.05", fmt(m2.shareSignificant, 3), "median V", fmt(m2.medianV, 3)]));
  lines.push(csvLine(["Model 3 within-area chi-square", fmt(m3.strat.x2, 3), "df", m3.strat.df, "p (approx)", m3.strat.p, "p (permutation)", m3.permP]));
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
