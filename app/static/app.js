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
const systemsCache = {};      // sector -> [{hex, name, uwp}]
const systemsPending = {};    // sector -> Promise

// ---------------------------------------------------------------- sector/system data
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
      opening_balance: 0,
      transactions: [],
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
    opening_balance: 0,
    transactions: [],
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
  const out = emptyConfig();

  // Migrate to fleet-scoped shape (ships / fuel_dumps / drinax contract).
  // Legacy configs carried ships/fuel_dumps at the top level and the drinax
  // cut on a ship contract; lift both into fleet scope instead of dropping
  // them. Fields are read explicitly (not Object.assign'd) so no stale
  // top-level keys survive into the normalized config.
  const fleetIn = (cfg && cfg.fleet) || {};
  const rawShips = Array.isArray(fleetIn.ships) ? fleetIn.ships
    : Array.isArray(cfg.ships) ? cfg.ships : null;

  out.fleet.name = fleetIn.name || "";
  out.fleet.ships = (rawShips || [emptyShip()]).map((s) => Object.assign(emptyShip(), s));
  out.fleet.fuel_dumps = Array.isArray(fleetIn.fuel_dumps) ? fleetIn.fuel_dumps
    : Array.isArray(cfg.fuel_dumps) ? deepCopy(cfg.fuel_dumps) : [];

  out.fleet.contract = Object.assign({ type: "none" }, fleetIn.contract || {});
  if (out.fleet.contract.type === "drinax" && out.fleet.contract.percentage == null) {
    out.fleet.contract.percentage = 10;
  }
  // lift legacy ship-level drinax contracts AFTER merging fleet.contract so a
  // fleet-level contract keeps its own percentage
  out.fleet.ships.forEach((s) => {
    if (s.contract && s.contract.type === "drinax") {
      if (out.fleet.contract.type !== "drinax") {
        out.fleet.contract = { type: "drinax", percentage: 10 };
      }
      s.contract = { type: "none" };
    }
  });

  out.fleet.opening_balance = Number.isFinite(Number(fleetIn.opening_balance)) ? Number(fleetIn.opening_balance) : 0;
  out.fleet.transactions = normalizeTxns(fleetIn.transactions);

  ["stops", "avoid"].forEach((k) => {
    out[k] = Array.isArray(cfg[k]) ? deepCopy(cfg[k]) : [];
  });
  out.start = Object.assign({ sector: "", hex: "" }, cfg.start || {});
  out.start_date = Object.assign({ year: 1105, day: 1 }, cfg.start_date || {});
  ["capital", "uncut_profits", "max_profit", "max_duration"].forEach((k) => {
    if (cfg[k] !== undefined) out[k] = cfg[k];
  });
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
      <div class="loc-picker-cell">${locPickerHTML(`${base}.${j}`)}</div>
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
  renderLocPickers();
  syncScalars();
  syncFleetContractVisibility();
  syncFleetUI();
  renderTxns();
  enrichLabels();
}

// ---------------------------------------------------------------- location picker
// Each location (start / stop / avoid / fuel dump) is one text-search box that
// resolves a system (globally, showing its sector for disambiguation) or a
// sector (which then exposes a free-text hex field for a custom hex). NOTE
// (XSS): every interpolated value below is escaped via esc() (&, ", <, >).
const worldNames = {};   // "sector|hex" -> world name (cosmetic display only)
const searchCache = {};  // query -> {sectors, worlds}

function labelFor(loc) {
  if (!loc || !loc.sector) return "";
  const name = loc.hex ? worldNames[`${loc.sector}|${loc.hex}`] : null;
  return name ? `${name} — ${loc.sector}` : loc.sector;
}

function locPickerHTML(path) {
  const loc = getByPath(state, path) || { sector: "", hex: "" };
  const showHex = !!loc.sector;
  return `<div class="loc-picker" data-loc-path="${esc(path)}">
    <input class="loc-search" type="text" placeholder="Search system or sector…" value="${esc(labelFor(loc))}" autocomplete="off" spellcheck="false">
    <div class="loc-results" hidden></div>
    <div class="loc-hex-row" ${showHex ? "" : "hidden"}>
      <span class="loc-hint">Hex</span>
      <input class="loc-hex" type="text" data-path="${esc(path)}.hex" placeholder="e.g. 2221" value="${esc(loc.hex)}" inputmode="numeric" maxlength="4" autocomplete="off" spellcheck="false">
    </div>
  </div>`;
}

function renderLocPickers() {
  const startEl = $("start-loc");
  if (startEl) startEl.innerHTML = locPickerHTML("start");
}

// Best-effort: resolve world names for already-set hexes so the search box
// shows "Regina — Spinward Marches" instead of just the sector. Runs after
// every render; systemsCache makes it cheap.
function enrichLabels() {
  document.querySelectorAll(".loc-picker").forEach((picker) => {
    const path = picker.dataset.locPath;
    const loc = getByPath(state, path) || {};
    if (!loc.sector || !loc.hex) return;
    const key = `${loc.sector}|${loc.hex}`;
    if (worldNames[key]) return;
    const input = picker.querySelector(".loc-search");
    getSystems(loc.sector).then((systems) => {
      const s = systems.find((x) => x.hex === loc.hex);
      if (s && s.name) worldNames[key] = s.name;
      const cur = getByPath(state, path) || {};
      if (cur.sector === loc.sector && cur.hex === loc.hex
          && input && document.body.contains(input)
          && document.activeElement !== input) {
        input.value = labelFor(cur);
      }
    }).catch(() => {});
  });
}

async function runSearch(q) {
  const key = q.trim().toLowerCase();
  if (!key) return { sectors: [], worlds: [] };
  if (searchCache[key]) return searchCache[key];
  const resp = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  const data = await resp.json();
  searchCache[key] = data;
  return data;
}

function renderSearchResults(picker, data) {
  const dd = picker.querySelector(".loc-results");
  const sectors = data.sectors || [];
  const worlds = data.worlds || [];
  if (!sectors.length && !worlds.length) {
    dd.innerHTML = '<div class="loc-empty">No matches</div>';
  } else {
    let html = "";
    if (sectors.length) {
      html += '<div class="loc-group">Sectors</div>';
      html += sectors.map((s) => `<button type="button" class="loc-option" data-kind="sector" data-name="${esc(s.name)}">${esc(s.name)}</button>`).join("");
    }
    if (worlds.length) {
      html += '<div class="loc-group">Systems</div>';
      html += worlds.map((w) => {
        const tag = (w.tags && !/OTU/.test(w.tags)) ? ` <span class="loc-tag">${esc(w.tags)}</span>` : "";
        return `<button type="button" class="loc-option" data-kind="world" data-name="${esc(w.name)}" data-sector="${esc(w.sector)}" data-hex="${esc(w.hex)}">${esc(w.name)}${tag} <span class="loc-muted">${esc(w.hex)} · ${esc(w.sector)}</span></button>`;
      }).join("");
    }
    dd.innerHTML = html;
  }
  dd.hidden = false;
}

function closeResults(picker) {
  const dd = picker.querySelector(".loc-results");
  dd.hidden = true;
  dd.innerHTML = "";
}

function refreshPicker(picker, path) {
  const loc = getByPath(state, path) || { sector: "", hex: "" };
  const input = picker.querySelector(".loc-search");
  input.value = labelFor(loc);
  const hexRow = picker.querySelector(".loc-hex-row");
  hexRow.hidden = !loc.sector;
  if (!hexRow.hidden) picker.querySelector(".loc-hex").value = loc.hex || "";
  if (document.activeElement === input) input.select();
  closeResults(picker);
}

function selectResult(picker, kind, d) {
  const path = picker.dataset.locPath;
  if (kind === "world") {
    setByPath(state, `${path}.sector`, d.sector);
    setByPath(state, `${path}.hex`, d.hex);
    worldNames[`${d.sector}|${d.hex}`] = d.name;
  } else {
    setByPath(state, `${path}.sector`, d.name);
    setByPath(state, `${path}.hex`, "");
  }
  refreshPicker(picker, path);
}

function onSearchInput(input) {
  const picker = input.closest(".loc-picker");
  const path = picker.dataset.locPath;
  const q = input.value.trim();
  clearTimeout(input._debounce);
  if (!q) {
    // field cleared -> reset the selection
    setByPath(state, `${path}.sector`, "");
    setByPath(state, `${path}.hex`, "");
    refreshPicker(picker, path);
    return;
  }
  input._debounce = setTimeout(async () => {
    const seq = (input._seq = (input._seq || 0) + 1);
    try {
      const data = await runSearch(q);
      if (!document.body.contains(input) || seq !== input._seq) return;
      if (input.value.trim() !== q) return;
      renderSearchResults(picker, data);
    } catch (err) {
      console.error("search failed:", err);
    }
  }, 200);
}

function setActive(dd, idx) {
  const opts = Array.from(dd.querySelectorAll(".loc-option"));
  opts.forEach((o, i) => o.classList.toggle("active", i === idx));
  if (opts[idx]) opts[idx].scrollIntoView({ block: "nearest" });
}

// --- picker events ---
document.addEventListener("focusin", (e) => {
  const input = e.target.closest ? e.target.closest(".loc-search") : null;
  if (!input) return;
  input.select();
});

document.addEventListener("focusout", (e) => {
  const input = e.target.closest ? e.target.closest(".loc-search") : null;
  if (!input) return;
  const picker = input.closest(".loc-picker");
  const loc = getByPath(state, picker.dataset.locPath) || { sector: "", hex: "" };
  if (input.value.trim() !== labelFor(loc)) input.value = labelFor(loc);
  closeResults(picker);
});

document.addEventListener("mousedown", (e) => {
  const opt = e.target.closest ? e.target.closest(".loc-option") : null;
  if (!opt) return;
  e.preventDefault(); // keep focus in the search box; selection happens here
  const picker = opt.closest(".loc-picker");
  selectResult(picker, opt.dataset.kind, opt.dataset);
});

document.addEventListener("keydown", (e) => {
  const input = e.target.closest ? e.target.closest(".loc-search") : null;
  if (!input) return;
  const picker = input.closest(".loc-picker");
  const dd = picker.querySelector(".loc-results");
  if (e.key === "Escape") { closeResults(picker); return; }
  if (dd.hidden) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const opts = Array.from(dd.querySelectorAll(".loc-option"));
    if (!opts.length) return;
    e.preventDefault();
    const cur = opts.findIndex((o) => o.classList.contains("active"));
    const delta = e.key === "ArrowDown" ? 1 : -1;
    const next = cur < 0
      ? (delta === 1 ? 0 : opts.length - 1)
      : ((cur + delta) % opts.length + opts.length) % opts.length;
    setActive(dd, next);
    return;
  }
  if (e.key === "Enter") {
    const opts = Array.from(dd.querySelectorAll(".loc-option"));
    if (!opts.length) return;
    e.preventDefault();
    const active = opts.find((o) => o.classList.contains("active")) || opts[0];
    selectResult(picker, active.dataset.kind, active.dataset);
  }
});

// ---------------------------------------------------------------- events
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.classList && el.classList.contains("loc-search")) { onSearchInput(el); return; }
  if (el.dataset && el.dataset.path) {
    setByPath(state, el.dataset.path, coerce(el));
    // keep the search label in sync when a custom hex is typed directly
    if (el.classList && el.classList.contains("loc-hex")) {
      const picker = el.closest(".loc-picker");
      const loc = getByPath(state, picker.dataset.locPath) || {};
      picker.querySelector(".loc-search").value = labelFor(loc);
    }
  }
});
document.addEventListener("change", (e) => {
  const el = e.target;
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
const fleetCount = (f) => (Array.isArray(f) ? f.length : (f.ships ? f.ships.length : 0));

function savedFleetOptions() {
  const fleets = loadFleets();
  return Object.keys(fleets).sort().map((n) => {
    const c = fleetCount(fleets[n]);
    return `<option value="${esc(n)}">${esc(n)} (${c} ship${c === 1 ? "" : "s"})</option>`;
  }).join("");
}

function refreshFleetSelect() {
  const opts = savedFleetOptions();
  $("fleet-select").innerHTML = '<option value="">— saved fleets —</option>' + opts;
  $("route-fleet-select").innerHTML = '<option value="">— choose saved fleet —</option>' + opts;
  syncFleetUI();
}

// Keep the two fleet dropdowns (Fleets tab + Route tab) and the "Current fleet"
// hint in sync with state.fleet.
function syncFleetUI() {
  const current = state.fleet.name;
  const fleets = loadFleets();
  const active = (current && fleets[current]) ? current : "";
  $("fleet-select").value = active;
  $("route-fleet-select").value = active;
  const status = $("route-fleet-status");
  if (status) {
    const c = (state.fleet.ships || []).length;
    status.textContent = `Current fleet: ${current || "unnamed"} (${c} ship${c === 1 ? "" : "s"})`;
  }
}

// Load a saved fleet by name into state.fleet (migrating legacy bare-array
// saves). Returns true on success. Shared by the Fleets tab "Load" button and
// the Route tab fleet dropdown.
function loadFleetByName(name) {
  const fleets = loadFleets();
  const saved = fleets[name];
  if (!saved) return false;
  if (Array.isArray(saved)) {
    // migrate pre-fleet-scoping saves (a bare array of ships); lift any
    // ship-level drinax contract to fleet scope, exactly like normalize().
    // Legacy saves carried no fuel dumps or fleet contract, so keep the
    // currently configured ones rather than discarding them.
    const ships = saved.map((s) => Object.assign(emptyShip(), s));
    let contract = deepCopy(state.fleet.contract || { type: "none" });
    ships.forEach((s) => {
      if (s.contract && s.contract.type === "drinax") {
        contract = { type: "drinax", percentage: 10 };
        s.contract = { type: "none" };
      }
    });
    state.fleet = { name, ships, fuel_dumps: deepCopy(state.fleet.fuel_dumps), contract };
  } else {
    state.fleet = deepCopy(saved);
  }
  ensureLedger();
  return true;
}

$("save-fleet").addEventListener("click", () => {
  const name = $("fleet-name").value.trim();
  if (!name) return alert("Enter a fleet name first");
  if (!state.fleet.ships.length) return alert("Nothing to save — add some ships first");
  const fleets = loadFleets();
  const toSave = deepCopy(state.fleet);
  toSave.name = name;
  state.fleet.name = name;
  fleets[name] = toSave;
  persistFleets(fleets);
  refreshFleetSelect();
  $("fleet-name").value = "";
});

$("load-fleet").addEventListener("click", () => {
  const name = $("fleet-select").value;
  if (!name) return;
  if (loadFleetByName(name)) render();
});

$("route-fleet-select").addEventListener("change", () => {
  const name = $("route-fleet-select").value;
  if (!name) return;
  if (loadFleetByName(name)) render();
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

// ---------------------------------------------------------------- transactions
function txId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const fmtCr = (n) => "Cr " + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const signedCr = (n) => (n < 0 ? "−" : "") + fmtCr(n);

function normalizeTxns(list) {
  if (!Array.isArray(list)) return [];
  return list.map((t) => {
    const amount = (typeof t.amount === "number" && isFinite(t.amount)) ? t.amount : (parseFloat(t.amount) || 0);
    return {
      id: (typeof t.id === "string" && t.id) ? t.id : txId(),
      date: (typeof t.date === "string") ? t.date : String(t.date || ""),
      type: t.type === "income" ? "income" : "expense",
      amount,
      category: (typeof t.category === "string") ? t.category : String(t.category || ""),
      note: (typeof t.note === "string") ? t.note : String(t.note || ""),
    };
  });
}

function ensureLedger() {
  if (typeof state.fleet.opening_balance !== "number" || !isFinite(state.fleet.opening_balance)) state.fleet.opening_balance = 0;
  if (!Array.isArray(state.fleet.transactions)) state.fleet.transactions = [];
}

function todayLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function txTotals() {
  const txs = state.fleet.transactions || [];
  let income = 0, expense = 0;
  txs.forEach((t) => { if (t.type === "income") income += t.amount; else expense += t.amount; });
  return { income, expense, balance: (state.fleet.opening_balance || 0) + income - expense };
}

function renderTxns() {
  ensureLedger();
  const openEl = $("tx-opening");
  if (openEl && document.activeElement !== openEl) openEl.value = (state.fleet.opening_balance || 0);

  $("tx-fleet-label").textContent = `Money for fleet “${state.fleet.name || "unnamed"}” — each saved fleet keeps its own transactions; Save on the Fleets tab to keep changes.`;

  const txs = state.fleet.transactions;
  const sorted = txs.map((t, i) => ({ t, i })).sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : a.i - b.i));
  let running = state.fleet.opening_balance || 0;
  const rows = sorted.map(({ t }) => {
    running += t.type === "income" ? t.amount : -t.amount;
    return `<tr data-tx-id="${esc(t.id)}">
      <td>${esc(t.date)}</td>
      <td>${t.type === "income" ? "Income" : "Expense"}</td>
      <td>${esc(t.category || "—")}</td>
      <td>${esc(t.note || "—")}</td>
      <td class="num ${t.type}">${t.type === "income" ? "+" : "−"}${fmtCr(t.amount)}</td>
      <td class="num">${signedCr(running)}</td>
      <td class="tx-actions">
        <button class="ghost small" data-action="edit-tx" data-id="${esc(t.id)}">Edit</button>
        <button class="danger small" data-action="delete-tx" data-id="${esc(t.id)}">✕</button>
      </td>
    </tr>`;
  }).join("");

  const totals = txTotals();
  $("tx-summary").innerHTML = `
    <div class="tx-chip">Opening <strong>${signedCr(state.fleet.opening_balance || 0)}</strong></div>
    <div class="tx-chip income">In <strong>+${fmtCr(totals.income)}</strong></div>
    <div class="tx-chip expense">Spent <strong>−${fmtCr(totals.expense)}</strong></div>
    <div class="tx-chip balance">Balance <strong>${signedCr(totals.balance)}</strong></div>`;

  $("tx-list").innerHTML = txs.length
    ? `<table class="tx-table">
        <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Note</th><th class="num">Amount</th><th class="num">Balance</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`
    : '<p class="hint">No transactions for this fleet yet — add one above.</p>';
}

let editingTxId = null;

function resetTxForm() {
  editingTxId = null;
  $("tx-date").value = todayLocal();
  $("tx-type").value = "expense";
  $("tx-amount").value = "";
  $("tx-category").value = "";
  $("tx-note").value = "";
  $("tx-add").textContent = "Add transaction";
  $("tx-cancel").hidden = true;
}

$("tx-add").addEventListener("click", () => {
  const date = $("tx-date").value;
  const type = $("tx-type").value;
  const amount = parseFloat($("tx-amount").value);
  if (!date) return alert("Pick a date");
  if (!isFinite(amount) || amount <= 0) return alert("Enter a positive amount");
  ensureLedger();
  if (editingTxId) {
    const t = state.fleet.transactions.find((x) => x.id === editingTxId);
    if (t) Object.assign(t, { date, type, amount, category: $("tx-category").value.trim(), note: $("tx-note").value.trim() });
  } else {
    state.fleet.transactions.push({ id: txId(), date, type, amount, category: $("tx-category").value.trim(), note: $("tx-note").value.trim() });
  }
  renderTxns();
  resetTxForm();
});

$("tx-cancel").addEventListener("click", resetTxForm);

$("tx-opening").addEventListener("input", () => {
  const v = parseFloat($("tx-opening").value);
  state.fleet.opening_balance = isFinite(v) ? v : 0;
  renderTxns();
});

$("tx-list").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === "edit-tx") {
    const t = (state.fleet.transactions || []).find((x) => x.id === id);
    if (!t) return;
    editingTxId = id;
    $("tx-date").value = t.date;
    $("tx-type").value = t.type;
    $("tx-amount").value = t.amount;
    $("tx-category").value = t.category;
    $("tx-note").value = t.note;
    $("tx-add").textContent = "Save changes";
    $("tx-cancel").hidden = false;
  } else if (btn.dataset.action === "delete-tx") {
    if (!confirm("Delete this transaction?")) return;
    state.fleet.transactions = (state.fleet.transactions || []).filter((x) => x.id !== id);
    renderTxns();
  }
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
  $("tab-txs").hidden = t.dataset.tab !== "txs";
  if (t.dataset.tab === "json") $("json-editor").value = JSON.stringify(state, null, 2);
  if (t.dataset.tab === "txs") renderTxns();
}));

$("export-json").addEventListener("click", () => {
  $("json-editor").value = JSON.stringify(state, null, 2);
});
$("load-json").addEventListener("click", () => {
  try {
    const parsed = JSON.parse($("json-editor").value);
    state = normalize(parsed);
    render();
    document.querySelector('[data-tab="route"]').click();
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
  const status = $("copy-status");
  if (!lastMarkdown) {
    status.textContent = "Nothing to copy — run a plan first";
    setTimeout(() => { status.textContent = ""; }, 2000);
    return;
  }
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
function init() {
  refreshFleetSelect();
  resetTxForm();
  render();
}
init();