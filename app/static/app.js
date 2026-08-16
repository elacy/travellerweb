"use strict";

// ---------------------------------------------------------------- helpers
const $ = (id) => document.getElementById(id);
const deepCopy = (o) => JSON.parse(JSON.stringify(o));
const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
  .replace(/</g, "&lt;").replace(/>/g, "&gt;");

function getByPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setByPath(obj, path, value) {
  const keys = path.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
  cur[keys[keys.length - 1]] = value;
}

function coerce(el) {
  if (el.type === "checkbox") return el.checked;
  const raw = el.value.trim();
  if (el.dataset.type === "list") {
    return raw === "" ? [] : raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (el.type === "number") {
    if (raw === "") {
      const p = el.dataset.path || "";
      const nullable = p.endsWith("max_profit") || p.endsWith("max_duration") || p.endsWith("monthly_payment");
      return nullable ? null : 0;
    }
    return parseFloat(raw);
  }
  return raw;
}

// ---------------------------------------------------------------- globals
let sectorList = [];          // [{name, abbreviation}]
const systemsCache = {};      // sector -> [{hex, name, uwp}]
const systemsPending = {};    // sector -> Promise

// ---------------------------------------------------------------- sector/system data
async function loadSectors() {
  try {
    const resp = await fetch("/api/sectors");
    const data = await resp.json();
    sectorList = (data.sectors || []).filter((s) => s && s.name);
  } catch (e) {
    console.error("Failed to load sectors:", e);
    sectorList = [];
  }
}

function getSystems(sector) {
  if (systemsCache[sector]) return Promise.resolve(systemsCache[sector]);
  if (systemsPending[sector]) return systemsPending[sector];
  systemsPending[sector] = fetch(`/api/systems?sector=${encodeURIComponent(sector)}`)
    .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then((d) => { systemsCache[sector] = d.systems || []; return systemsCache[sector]; })
    .catch(() => { console.error("systems fetch failed for", sector); return []; })
    .finally(() => { delete systemsPending[sector]; });
  return systemsPending[sector];
}

// ---------------------------------------------------------------- preset
function emptyShip() {
  return {
    name: "New ship",
    monthly_maint: 0, fuel_per_jump: 0, max_jump: 1, fuel_tank: 0,
    cargo: 0, cargo_fuel: 0,
    berths: [], crew: [],
    contract: { type: "none" },
    max_steward: 0, max_broker: 0,
    accepts_passengers: true, banned_allegiances: [],
  };
}

function emptyConfig() {
  return {
    fleet: {
      name: "",
      ships: [emptyShip()],
      fuel_dumps: [],
      contract: { type: "none" },
    },
    start: { sector: "", hex: "" },
    start_date: { year: 1105, day: 1 },
    stops: [], avoid: [],
    capital: 0, uncut_profits: 0,
    max_profit: null, max_duration: null,
  };
}

// Exact default from traveller-trade-planner trade.py main()
const DEFAULT_CONFIG = {
  fleet: {
    name: "Pirates of Drinax",
    ships: [
    { name: "Vhurg", monthly_maint: 4513, fuel_per_jump: 20, max_jump: 2, fuel_tank: 42,
      cargo: 25, cargo_fuel: 0,
      berths: [{ type: "standard", number: 8 }, { type: "low", number: 8 }],
      crew: [
        { name: "Carla Sagan", salary: 0, passage: "middle" },
        { name: "Talahasee of Tort", salary: 0, passage: "middle" },
        { name: "Silent Unter", salary: 2000, passage: "middle" },
        { name: "Jim Cheese", salary: 6000, passage: "middle" },
        { name: "Old Jaek", salary: 3000, passage: "middle" },
      ],
      contract: { type: "none" }, max_steward: 0, max_broker: 3,
      accepts_passengers: false, banned_allegiances: [] },
    { name: "Mercifuge", monthly_maint: 8235, fuel_per_jump: 40, max_jump: 2, fuel_tank: 82,
      cargo: 199, cargo_fuel: 0,
      berths: [{ type: "standard", number: 4 }], crew: [],
      contract: { type: "none" }, max_steward: 0, max_broker: 3,
      accepts_passengers: false, banned_allegiances: [] },
    { name: "Ambush Frigate", monthly_maint: 27259, fuel_per_jump: 40, max_jump: 2, fuel_tank: 120,
      cargo: 101, cargo_fuel: 0,
      berths: [{ type: "high", number: 1 }, { type: "standard", number: 10 }, { type: "low", number: 10 }],
      crew: [
        { name: "Cassius Hart", salary: 0, passage: "middle" },
        { name: "Hyacinth Argona", salary: 0, passage: "middle" },
        { name: "Scarr", salary: 2000, passage: "middle" },
        { name: "Gargoyle", salary: 2000, passage: "middle" },
        { name: "Garginine", salary: 2000, passage: "middle" },
        { name: "Brick", salary: 2000, passage: "middle" },
        { name: "Duncan", salary: 4000, passage: "middle" },
      ],
      contract: { type: "mortgage", mortgage: 320013000, monthly_payment: 1333387.5 },
      max_steward: 0, max_broker: 3, accepts_passengers: false, banned_allegiances: [] },
    { name: "Far Trader A2", monthly_maint: 4353, fuel_per_jump: 20, max_jump: 2, fuel_tank: 40,
      cargo: 65, cargo_fuel: 0,
      berths: [{ type: "standard", number: 10 }],
      crew: [
        { name: "Krrsh", salary: 4000, passage: "middle" },
        { name: "penitent grim", salary: 4000, passage: "basic" },
        { name: "Adro Vennisir", salary: 4000, passage: "basic" },
        { name: "Streph Falter", salary: 4000, passage: "basic" },
        { name: "Laert", salary: 4000, passage: "basic" },
        { name: "Pete the Stench", salary: 6000, passage: "basic" },
        { name: "Jimothey Deleroux", salary: 2000, passage: "middle" },
      ],
      contract: { type: "none" }, max_steward: 2, max_broker: 3,
      accepts_passengers: false, banned_allegiances: [] },
    { name: "Far Trader A2 #2", monthly_maint: 4353, fuel_per_jump: 20, max_jump: 2, fuel_tank: 40,
      cargo: 65, cargo_fuel: 0,
      berths: [{ type: "standard", number: 10 }],
      crew: [
        { name: "Amina Aseel", salary: 0, passage: "middle" },
        { name: "Tom Vargface", salary: 4000, passage: "basic" },
        { name: "Wolf Blood Axe", salary: 2000, passage: "middle" },
        { name: "Opal Twice Vacced", salary: 9000, passage: "basic" },
        { name: "kagni vasiir", salary: 6000, passage: "basic" },
        { name: "Ramsey Grog", salary: 4000, passage: "basic" },
      ],
      contract: { type: "none" }, max_steward: 2, max_broker: 3,
      accepts_passengers: false, banned_allegiances: [] },
    ],
    fuel_dumps: [{ sector: "Trojan Reach", hex: "2117" }],
    contract: { type: "drinax", percentage: 10 },
  },
  start: { sector: "Trojan Reach", hex: "2221" },
  start_date: { year: 1105, day: 262 },
  stops: [{ sector: "Trojan Reach", hex: "2020" }, { sector: "Trojan Reach", hex: "1919" }],
  avoid: [],
  capital: 15800985,
  uncut_profits: 0,
  max_profit: null,
  max_duration: null,
};

// ---------------------------------------------------------------- state
let state = deepCopy(DEFAULT_CONFIG);

function normalize(cfg) {
  const base = emptyConfig();
  const out = deepCopy(base);
  Object.assign(out, cfg);

  // Migrate to fleet-scoped shape (ships / fuel_dumps / drinax contract).
  if (!out.fleet) out.fleet = { ships: [], fuel_dumps: [], contract: { type: "none" } };
  if (!Array.isArray(out.fleet.ships)) {
    out.fleet.ships = Array.isArray(out.ships) ? out.ships : [emptyShip()];
  }
  out.fleet.ships = out.fleet.ships.map((s) => Object.assign(emptyShip(), s));
  out.fleet.ships.forEach((s) => {
    if (s.contract && s.contract.type === "drinax") {
      out.fleet.contract = { type: "drinax", percentage: 10 };
      s.contract = { type: "none" };
    }
  });
  out.fleet.contract = Object.assign({ type: "none" }, out.fleet.contract || {});
  if (out.fleet.contract.type === "drinax" && out.fleet.contract.percentage == null) {
    out.fleet.contract.percentage = 10;
  }
  if (!Array.isArray(out.fleet.fuel_dumps)) {
    out.fleet.fuel_dumps = Array.isArray(out.fuel_dumps) ? out.fuel_dumps : [];
  }

  ["stops", "avoid"].forEach((k) => {
    if (!Array.isArray(out[k])) out[k] = [];
  });
  out.start = Object.assign({ sector: "", hex: "" }, out.start || {});
  out.start_date = Object.assign({ year: 1105, day: 1 }, out.start_date || {});
  return out;
}

// ---------------------------------------------------------------- render
// NOTE (XSS): every string/attribute value interpolated into HTML below is
// escaped via esc() (&, ", <, >). Numeric fields are always JS numbers in the
// form-editing path (coerce() -> parseFloat). This is a single-admin, internal
// (admin-ACL'd) tool; the only alternate input path is manual JSON paste by the
// owner. No unescaped external/third-party content is rendered.
function berthRow(i, b, j) {
  const opt = (v) => b.type === v ? "selected" : "";
  return `<div class="berth-row">
    <select data-path="fleet.ships.${i}.berths.${j}.type">
      <option value="standard" ${opt("standard")}>standard</option>
      <option value="high" ${opt("high")}>high</option>
      <option value="low" ${opt("low")}>low</option>
    </select>
    <input type="number" data-path="fleet.ships.${i}.berths.${j}.number" value="${b.number}">
    <button class="danger" data-action="remove-berth" data-ship="${i}" data-row="${j}">✕</button>
  </div>`;
}

function crewRow(i, c, j) {
  const opt = (v) => c.passage === v ? "selected" : "";
  return `<div class="crew-row">
    <input data-path="fleet.ships.${i}.crew.${j}.name" value="${esc(c.name)}" placeholder="Name">
    <input type="number" data-path="fleet.ships.${i}.crew.${j}.salary" value="${c.salary}" placeholder="Salary">
    <select data-path="fleet.ships.${i}.crew.${j}.passage">
      <option value="low" ${opt("low")}>low</option>
      <option value="basic" ${opt("basic")}>basic</option>
      <option value="middle" ${opt("middle")}>middle</option>
      <option value="high" ${opt("high")}>high</option>
    </select>
    <button class="danger" data-action="remove-crew" data-ship="${i}" data-row="${j}">✕</button>
  </div>`;
}

function shipHTML(s, i) {
  const ct = (s.contract && s.contract.type) || "none";
  const opt = (v) => ct === v ? "selected" : "";
  return `<div class="ship-card" data-ship="${i}">
    <div class="ship-head">
      <input class="ship-name" data-path="fleet.ships.${i}.name" value="${esc(s.name)}">
      <button class="danger" data-action="remove-ship" data-index="${i}">Remove</button>
    </div>
    <div class="ship-grid">
      <label>Monthly maint (Cr)<input type="number" data-path="fleet.ships.${i}.monthly_maint" value="${s.monthly_maint}"></label>
      <label>Fuel / jump<input type="number" data-path="fleet.ships.${i}.fuel_per_jump" value="${s.fuel_per_jump}"></label>
      <label>Max jump<input type="number" data-path="fleet.ships.${i}.max_jump" value="${s.max_jump}"></label>
      <label>Fuel tank<input type="number" data-path="fleet.ships.${i}.fuel_tank" value="${s.fuel_tank}"></label>
      <label>Cargo (tons)<input type="number" data-path="fleet.ships.${i}.cargo" value="${s.cargo}"></label>
      <label>Cargo fuel (tons)<input type="number" data-path="fleet.ships.${i}.cargo_fuel" value="${s.cargo_fuel}"></label>
      <label>Max steward<input type="number" data-path="fleet.ships.${i}.max_steward" value="${s.max_steward}"></label>
      <label>Max broker<input type="number" data-path="fleet.ships.${i}.max_broker" value="${s.max_broker}"></label>
      <label class="checkbox-label">Accepts passengers
        <input type="checkbox" data-path="fleet.ships.${i}.accepts_passengers" ${s.accepts_passengers ? "checked" : ""}></label>
      <label>Banned allegiances
        <input data-type="list" data-path="fleet.ships.${i}.banned_allegiances" value="${esc((s.banned_allegiances || []).join(", "))}" placeholder="e.g. Im, As"></label>
    </div>
    <div class="contract-row">
      <label>Contract
        <select data-path="fleet.ships.${i}.contract.type">
          <option value="none" ${opt("none")}>None</option>
          <option value="mortgage" ${opt("mortgage")}>Mortgage</option>
          <option value="perfect_stranger" ${opt("perfect_stranger")}>Perfect Stranger (75% cut)</option>
        </select>
      </label>
      <label>Mortgage amount (Cr, mortgage only)
        <input type="number" data-path="fleet.ships.${i}.contract.mortgage" value="${s.contract && s.contract.mortgage != null ? s.contract.mortgage : ""}"></label>
      <label>Monthly payment (Cr, optional)
        <input type="number" data-path="fleet.ships.${i}.contract.monthly_payment" value="${s.contract && s.contract.monthly_payment != null ? s.contract.monthly_payment : ""}"></label>
    </div>
    <div class="two-col">
      <div>
        <h3>Berths <button class="ghost small" data-action="add-berth" data-ship="${i}">+</button></h3>
        <div>${(s.berths || []).map((b, j) => berthRow(i, b, j)).join("")}</div>
      </div>
      <div>
        <h3>Crew <button class="ghost small" data-action="add-crew" data-ship="${i}">+</button></h3>
        <div>${(s.crew || []).map((c, j) => crewRow(i, c, j)).join("")}</div>
      </div>
    </div>
  </div>`;
}

function renderList(containerId, arr) {
  const list = { stops: "stop", avoid: "avoid", fueldumps: "fueldump" }[containerId];
  const base = containerId === "fueldumps" ? "fleet.fuel_dumps" : containerId;
  $(containerId).innerHTML = arr.map((it, j) => `
    <div class="list-row">
      <select data-path="${base}.${j}.sector" data-kind="sector"></select>
      <select data-path="${base}.${j}.hex" data-kind="hex"></select>
      <button class="danger" data-action="remove-${list}" data-index="${j}">✕</button>
    </div>`).join("");
}

function syncScalars() {
  document.querySelectorAll("[data-path]").forEach((el) => {
    if (el.closest("#ships") || el.closest("#stops") || el.closest("#avoid") || el.closest("#fueldumps")) return;
    if (el.tagName === "SELECT" && (el.dataset.kind === "sector" || el.dataset.kind === "hex")) return; // sector/system selects handled by populate
    const v = getByPath(state, el.dataset.path);
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = (v === null || v === undefined) ? "" : v;
  });
}

function syncFleetContractVisibility() {
  const pctRow = $("drinax-pct-row");
  if (!pctRow) return;
  pctRow.hidden = getByPath(state, "fleet.contract.type") !== "drinax";
}

function render() {
  $("ships").innerHTML = state.fleet.ships.map((s, i) => shipHTML(s, i)).join("");
  renderList("stops", state.stops);
  renderList("avoid", state.avoid);
  renderList("fueldumps", state.fleet.fuel_dumps);
  syncScalars();
  populateSectorSelects();
  populateHexSelects();
  syncFleetContractVisibility();
}

// ---------------------------------------------------------------- dropdowns
function populateSectorSelects() {
  document.querySelectorAll('select[data-kind="sector"]').forEach((el) => {
    const current = getByPath(state, el.dataset.path);
    const opts = ['<option value="">— sector —</option>']
      .concat(sectorList.map((s) =>
        `<option value="${esc(s.name)}" ${s.name === current ? "selected" : ""}>${esc(s.name)}</option>`))
      .join("");
    el.innerHTML = opts;
    el.value = current || "";
  });
}

async function populateHexSelect(hexEl) {
  const sectorPath = hexEl.dataset.path.replace(/\.hex$/, ".sector");
  const sector = getByPath(state, sectorPath);
  const currentHex = getByPath(state, hexEl.dataset.path);
  let opts = '<option value="">— system —</option>';
  if (sector) {
    const systems = await getSystems(sector);
    if (!document.body.contains(hexEl)) return;          // stale element
    if (getByPath(state, sectorPath) !== sector) return;  // sector changed under us
    if (systems.length === 0) {
      opts = '<option value="">(no systems found)</option>';
    } else {
      opts += systems.map((s) =>
        `<option value="${s.hex}" ${s.hex === currentHex ? "selected" : ""}>${esc(s.name || s.hex)}</option>`).join("");
    }
  }
  hexEl.innerHTML = opts;
  hexEl.value = currentHex || "";
}

function populateHexSelects() {
  document.querySelectorAll('select[data-kind="hex"]').forEach(populateHexSelect);
}

// ---------------------------------------------------------------- events
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.path) setByPath(state, el.dataset.path, coerce(el));
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.kind === "sector") {
    // state.sector is already updated by the input handler; reset + refill hexes
    const hexPath = el.dataset.path.replace(/\.sector$/, ".hex");
    setByPath(state, hexPath, "");
    const hexEl = document.querySelector(`select[data-kind="hex"][data-path="${hexPath}"]`);
    if (hexEl) populateHexSelect(hexEl);
    return;
  }
  if (el.type === "checkbox" && el.dataset && el.dataset.path) {
    setByPath(state, el.dataset.path, el.checked);
  }
  if (el.dataset && el.dataset.path === "fleet.contract.type") {
    if (getByPath(state, "fleet.contract.type") === "drinax" && getByPath(state, "fleet.contract.percentage") == null) {
      setByPath(state, "fleet.contract.percentage", 10);
      const pctEl = document.querySelector('[data-path="fleet.contract.percentage"]');
      if (pctEl) pctEl.value = "10";
    }
    syncFleetContractVisibility();
  }
});

document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  const a = t.dataset.action;
  const i = parseInt(t.dataset.index, 10);
  const si = parseInt(t.dataset.ship, 10);
  const rj = parseInt(t.dataset.row, 10);

  switch (a) {
    case "remove-ship": state.fleet.ships.splice(i, 1); render(); break;
    case "add-crew": state.fleet.ships[si].crew.push({ name: "", salary: 0, passage: "middle" }); render(); break;
    case "remove-crew": state.fleet.ships[si].crew.splice(rj, 1); render(); break;
    case "add-berth": state.fleet.ships[si].berths.push({ type: "standard", number: 1 }); render(); break;
    case "remove-berth": state.fleet.ships[si].berths.splice(rj, 1); render(); break;
    case "remove-stop": state.stops.splice(i, 1); render(); break;
    case "remove-avoid": state.avoid.splice(i, 1); render(); break;
    case "remove-fueldump": state.fleet.fuel_dumps.splice(i, 1); render(); break;
  }
});

// ---------------------------------------------------------------- fleet save/load
const FLEETS_KEY = "travellerweb.fleets";
const loadFleets = () => {
  try { return JSON.parse(localStorage.getItem(FLEETS_KEY)) || {}; } catch (_) { return {}; }
};
const persistFleets = (f) => localStorage.setItem(FLEETS_KEY, JSON.stringify(f));

function refreshFleetSelect() {
  const fleets = loadFleets();
  const names = Object.keys(fleets).sort();
  const fleetCount = (f) => (Array.isArray(f) ? f.length : (f.ships ? f.ships.length : 0));
  $("fleet-select").innerHTML = '<option value="">— saved fleets —</option>' +
    names.map((n) => {
      const c = fleetCount(fleets[n]);
      return `<option value="${esc(n)}">${esc(n)} (${c} ship${c === 1 ? "" : "s"})</option>`;
    }).join("");
}

$("save-fleet").addEventListener("click", () => {
  const name = $("fleet-name").value.trim();
  if (!name) return alert("Enter a fleet name first");
  if (!state.fleet.ships.length) return alert("Nothing to save — add some ships first");
  const fleets = loadFleets();
  const toSave = deepCopy(state.fleet);
  toSave.name = name;
  fleets[name] = toSave;
  persistFleets(fleets);
  refreshFleetSelect();
  $("fleet-select").value = name;
  $("fleet-name").value = "";
});

$("load-fleet").addEventListener("click", () => {
  const name = $("fleet-select").value;
  if (!name) return;
  const fleets = loadFleets();
  const saved = fleets[name];
  if (saved) {
    if (Array.isArray(saved)) {
      // migrate pre-fleet-scoping saves (a bare array of ships); lift any
      // ship-level drinax contract to fleet scope, exactly like normalize()
      const ships = saved.map((s) => Object.assign(emptyShip(), s));
      let contract = { type: "none" };
      ships.forEach((s) => {
        if (s.contract && s.contract.type === "drinax") {
          contract = { type: "drinax", percentage: 10 };
          s.contract = { type: "none" };
        }
      });
      state.fleet = { name, ships, fuel_dumps: [], contract };
    } else {
      state.fleet = deepCopy(saved);
    }
    render();
  }
});

$("delete-fleet").addEventListener("click", () => {
  const name = $("fleet-select").value;
  if (!name) return;
  if (!confirm(`Delete saved fleet "${name}"?`)) return;
  const fleets = loadFleets();
  delete fleets[name];
  persistFleets(fleets);
  refreshFleetSelect();
});

// ---------------------------------------------------------------- actions
$("load-preset").addEventListener("click", () => { state = deepCopy(DEFAULT_CONFIG); render(); });
$("clear-all").addEventListener("click", () => { state = emptyConfig(); render(); });
$("add-ship").addEventListener("click", () => { state.fleet.ships.push(emptyShip()); render(); });
$("add-stop").addEventListener("click", () => { state.stops.push({ sector: "", hex: "" }); render(); });
$("add-avoid").addEventListener("click", () => { state.avoid.push({ sector: "", hex: "" }); render(); });
$("add-fueldump").addEventListener("click", () => { state.fleet.fuel_dumps.push({ sector: "", hex: "" }); render(); });

document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
  $("tab-fleet").hidden = t.dataset.tab !== "fleet";
  $("tab-route").hidden = t.dataset.tab !== "route";
  $("tab-json").hidden = t.dataset.tab !== "json";
  if (t.dataset.tab === "json") $("json-editor").value = JSON.stringify(state, null, 2);
}));

$("export-json").addEventListener("click", () => {
  $("json-editor").value = JSON.stringify(state, null, 2);
});
$("load-json").addEventListener("click", () => {
  try {
    const parsed = JSON.parse($("json-editor").value);
    state = normalize(parsed);
    render();
    document.querySelector('[data-tab="fleet"]').click();
  } catch (err) {
    alert("Invalid JSON: " + err.message);
  }
});

async function planRoute() {
  const results = $("results");
  results.hidden = false;
  const out = $("route-output");
  const err = $("error-box");
  err.hidden = true;
  out.innerHTML = '<span class="spinner">Planning route…</span>';
  try {
    const resp = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: state }),
    });
    let data;
    try { data = await resp.json(); } catch (_) { data = { detail: await resp.text() }; }
    if (!resp.ok) {
      err.textContent = (data && data.detail) ? data.detail : ("HTTP " + resp.status);
      err.hidden = false;
      lastMarkdown = "";
      out.innerHTML = "";
      return;
    }
    if (!data.ok) {
      err.textContent = data.error || "Unknown error";
      err.hidden = false;
      lastMarkdown = "";
      out.innerHTML = "";
      return;
    }
    renderResults(data);
  } catch (ex) {
    err.textContent = String(ex);
    err.hidden = false;
    lastMarkdown = "";
    out.innerHTML = "";
  }
}

let lastMarkdown = "";

function inlineMd(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function renderTable(rows) {
  const parsed = rows.map((r) => r.split("|").slice(1, -1).map((c) => c.trim()));
  const dataRows = parsed.filter((cells) => !cells.every((c) => /^-+$/.test(c)));
  if (!dataRows.length) return "";
  const head = dataRows[0];
  const body = dataRows.slice(1);
  return `<table><thead><tr>${head.map((h) => `<th>${inlineMd(h)}</th>`).join("")}</tr></thead>` +
    `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inlineMd(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderMarkdown(md) {
  const lines = md.split("\n");
  let html = "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }
    if (line.startsWith("## ")) { html += `<h3>${inlineMd(line.slice(3))}</h3>`; i++; }
    else if (line.startsWith("# ")) { html += `<h2>${inlineMd(line.slice(2))}</h2>`; i++; }
    else if (line.startsWith("|")) {
      const block = [];
      while (i < lines.length && lines[i].startsWith("|")) { block.push(lines[i]); i++; }
      html += renderTable(block);
    } else { html += `<div class="md-line">${inlineMd(line)}</div>`; i++; }
  }
  return html;
}

function renderResults(data) {
  lastMarkdown = data.markdown || "";
  $("route-output").innerHTML = renderMarkdown(lastMarkdown);
  $("results").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("plan-btn").addEventListener("click", planRoute);

$("copy-markdown").addEventListener("click", async () => {
  if (!lastMarkdown) return;
  const status = $("copy-status");
  try {
    await navigator.clipboard.writeText(lastMarkdown);
    status.textContent = "Copied to clipboard";
  } catch (_) {
    const ta = document.createElement("textarea");
    ta.value = lastMarkdown;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); status.textContent = "Copied to clipboard"; }
    catch (__) { status.textContent = "Copy failed — select and copy manually"; }
    ta.remove();
  }
  setTimeout(() => { status.textContent = ""; }, 2000);
});

// ---------------------------------------------------------------- init
async function init() {
  await loadSectors();
  refreshFleetSelect();
  render();
}
init();