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
    game: {
      name: "",
      opening_balance: 0,
      current_date: { year: 1105, day: 1 },
      transactions: [],
      boughtItems: [],
      characters: [],
      fleets: [],
    },
    start: { sector: "", hex: "" },
    start_date: { year: 1105, day: 1 },
    stops: [], avoid: [],
    capital: 0, uncut_profits: 0,
    max_profit: null, max_duration: null,
  };
}

// Exact default from traveller-trade-planner trade.py main().
// Data model: Game -> Fleets -> Ships. The game carries the ledger
// (opening_balance + transactions) and the fleets array.
const DEFAULT_CONFIG = {
  game: {
    name: "Pirates of Drinax",
    opening_balance: 0,
    current_date: { year: 1105, day: 1 },
    transactions: [],
    boughtItems: [],
    characters: [],
    fleets: [{
      name: "Pirates of Drinax",
      location: "",
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
    }],
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
// state.fleet is a live reference to the selected fleet inside
// state.game.fleets — keeps every fleet.* data-path binding and the route
// planner's `config.fleet` shape working unchanged.
state.fleet = state.game.fleets[0] || null;

function normalizeGame(g) {
  const rawFleets = Array.isArray(g && g.fleets) ? g.fleets : [];
  const fleets = [];
  rawFleets.forEach((f) => {
    if (!f || typeof f !== "object") return;
    const contract = Object.assign({ type: "none" }, (f.contract && typeof f.contract === "object") ? f.contract : {});
    if (contract.type === "drinax" && contract.percentage == null) contract.percentage = 10;
    fleets.push({
      name: typeof f.name === "string" ? f.name : "",
      location: typeof f.location === "string" ? f.location : "",
      ships: Array.isArray(f.ships) ? f.ships.map((s) => Object.assign(emptyShip(), s)) : [],
      fuel_dumps: Array.isArray(f.fuel_dumps) ? deepCopy(f.fuel_dumps) : [],
      contract,
    });
  });
  return {
    name: (g && typeof g.name === "string" && g.name.trim()) ? g.name : "",
    opening_balance: Number.isFinite(Number(g && g.opening_balance)) ? Number(g.opening_balance) : 0,
    current_date: normalizeDay((g && g.current_date && typeof g.current_date === "object") ? g.current_date : {}),
    transactions: normalizeTxns(g && g.transactions),
    boughtItems: normalizeBought(g && g.boughtItems),
    characters: normalizeChars(g && g.characters),
    fleets,
  };
}

function normalizeBought(list) {
  if (!Array.isArray(list)) return [];
  return list.map((b) => {
    if (!b || typeof b !== "object") return null;
    const cost = Number.isFinite(Number(b.cost)) ? Number(b.cost) : 0;
    const qty = Math.max(1, parseInt(b.qty, 10) || 1);
    const { day, year } = normalizeDay({ day: b.day, year: b.year });
    return {
      id: (typeof b.id === "string" && b.id) ? b.id : txId(),
      itemId: (typeof b.itemId === "string") ? b.itemId : "",
      name: (typeof b.name === "string") ? b.name : "",
      category: (typeof b.category === "string") ? b.category : "",
      tl: (b.tl != null) ? b.tl : null,
      cost,
      mass: (b.mass != null) ? b.mass : 0,
      stats: (b.stats && typeof b.stats === "object") ? deepCopy(b.stats) : {},
      qty,
      total: Number.isFinite(Number(b.total)) ? Number(b.total) : cost * qty,
      day,
      year,
    };
  }).filter(Boolean);
}

const CHAR_STAT_KEYS = ["str", "dex", "end", "int", "edu", "soc"];

// MgT2e characteristic DM table: 0→-3, 1-2→-2, 3-5→-1, 6-8→0, 9-11→+1, 12-14→+2, 15+→+3.
function charDM(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return -3;
  if (n >= 15) return 3;
  if (n >= 12) return 2;
  if (n >= 9) return 1;
  if (n >= 6) return 0;
  if (n >= 3) return -1;
  if (n >= 1) return -2;
  return -3;
}

function normalizeChars(list) {
  if (!Array.isArray(list)) return [];
  return list.map((c) => {
    if (!c || typeof c !== "object") return null;
    const rawChars = (c.characteristics && typeof c.characteristics === "object") ? c.characteristics : {};
    const characteristics = {};
    CHAR_STAT_KEYS.forEach((k) => {
      const n = Number(rawChars[k]);
      characteristics[k] = Number.isFinite(n) ? Math.max(0, Math.min(15, Math.round(n))) : 0;
    });
    const skills = (Array.isArray(c.skills) ? c.skills : []).map((s) => {
      if (!s || typeof s !== "object") return { name: "", level: 0 };
      const lv = parseInt(s.level, 10);
      return {
        name: typeof s.name === "string" ? s.name : "",
        level: Number.isFinite(lv) ? Math.max(0, Math.min(6, lv)) : 0,
      };
    }).filter((s) => s.name || s.level > 0);
    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    const ageRaw = (c.age === "" || c.age == null) ? null : num(c.age);
    return {
      id: (typeof c.id === "string" && c.id) ? c.id : txId(),
      name: typeof c.name === "string" ? c.name : "",
      role: typeof c.role === "string" ? c.role : "",
      career: typeof c.career === "string" ? c.career : "",
      age: Number.isFinite(ageRaw) ? ageRaw : null,
      homeworld: typeof c.homeworld === "string" ? c.homeworld : "",
      characteristics,
      skills,
      salary: num(c.salary),
      pension: num(c.pension),
      rank: typeof c.rank === "string" ? c.rank : "",
      terms: num(c.terms),
      cash: num(c.cash),
      benefits: typeof c.benefits === "string" ? c.benefits : "",
      notes: typeof c.notes === "string" ? c.notes : "",
    };
  }).filter(Boolean);
}

function normalize(cfg) {
  const out = emptyConfig();
  if (!cfg || typeof cfg !== "object") return out;

  // New shape: game-scoped (Game -> Fleets -> Ships).
  if (cfg.game && typeof cfg.game === "object") {
    out.game = normalizeGame(cfg.game);
    // legacy top-level ships/fuel_dumps -> the game's first fleet (old exports)
    if (Array.isArray(cfg.ships)) {
      if (out.game.fleets.length && !out.game.fleets[0].ships.length) {
        out.game.fleets[0].ships = cfg.ships.map((s) => Object.assign(emptyShip(), s));
      } else if (!out.game.fleets.length) {
        out.game.fleets.push({
          name: out.game.name || "Fleet",
          location: "",
          ships: cfg.ships.map((s) => Object.assign(emptyShip(), s)),
          fuel_dumps: Array.isArray(cfg.fuel_dumps) ? deepCopy(cfg.fuel_dumps) : [],
          contract: { type: "none" },
        });
      }
    }
    if (Array.isArray(cfg.fuel_dumps) && out.game.fleets.length && !out.game.fleets[0].fuel_dumps.length) {
      out.game.fleets[0].fuel_dumps = deepCopy(cfg.fuel_dumps);
    }
  } else if (cfg.fleet && typeof cfg.fleet === "object") {
    // Legacy shape: fleet-scoped config; lift into a single-fleet game.
    const f = cfg.fleet;
    const contract = Object.assign({ type: "none" }, f.contract || {});
    const ships = (Array.isArray(f.ships) ? f.ships : (Array.isArray(cfg.ships) ? cfg.ships : [emptyShip()]))
      .map((s) => Object.assign(emptyShip(), s));
    // lift legacy ship-level drinax contracts AFTER merging fleet.contract so a
    // fleet-level contract keeps its own percentage
    ships.forEach((s) => {
      if (s.contract && s.contract.type === "drinax") {
        if (contract.type !== "drinax") {
          contract.type = "drinax";
          contract.percentage = 10;
        }
        s.contract = { type: "none" };
      }
    });
    if (contract.type === "drinax" && contract.percentage == null) contract.percentage = 10;
    out.game = {
      name: f.name || "Pirates of Drinax",
      opening_balance: Number.isFinite(Number(f.opening_balance)) ? Number(f.opening_balance) : 0,
      current_date: normalizeDay(cfg.start_date || {}),
      transactions: normalizeTxns(f.transactions),
      fleets: [{
        name: f.name || "",
        location: "",
        ships,
        fuel_dumps: Array.isArray(f.fuel_dumps) ? deepCopy(f.fuel_dumps)
          : (Array.isArray(cfg.fuel_dumps) ? deepCopy(cfg.fuel_dumps) : []),
        contract,
      }],
    };
  }

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

// "Move ship to another fleet" row: shown when the current game has another
// named fleet to move into.
function shipMoveHTML(i) {
  const current = (state.fleet && state.fleet.name) || "";
  const others = ((state.game && state.game.fleets) || [])
    .filter((f) => f.name && f.name !== current);
  if (!others.length) return "";
  return `<div class="ship-move-row">
    <label class="ship-move-label">Move ship to
      <select id="ship-move-${i}">
        <option value="">— fleet —</option>
        ${others.map((f) => `<option value="${esc(f.name)}">${esc(f.name)}</option>`).join("")}
      </select>
    </label>
    <button class="ghost small" data-action="move-ship" data-index="${i}">Move</button>
  </div>`;
}

function moveShip(i) {
  if (!state.fleet) return;
  const sel = document.getElementById("ship-move-" + i);
  const target = sel ? sel.value : "";
  if (!target) return;
  const to = state.game.fleets.find((f) => f.name === target);
  if (!to) return;
  const moved = state.fleet.ships.splice(i, 1);
  if (moved.length) to.ships.push(moved[0]);
}

function shipHTML(s, i) {
  const ct = (s.contract && s.contract.type) || "none";
  const opt = (v) => ct === v ? "selected" : "";
  return `<div class="ship-card" data-ship="${i}">
    <div class="ship-head">
      <input class="ship-name" data-path="fleet.ships.${i}.name" value="${esc(s.name)}">
      <button class="danger" data-action="remove-ship" data-index="${i}">Remove</button>
    </div>
    ${shipMoveHTML(i)}
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
  const ships = (state.fleet && state.fleet.ships) ? state.fleet.ships : [];
  const fuelDumps = (state.fleet && state.fleet.fuel_dumps) ? state.fleet.fuel_dumps : [];
  $("ships").innerHTML = ships.map((s, i) => shipHTML(s, i)).join("");
  renderList("stops", state.stops);
  renderList("avoid", state.avoid);
  renderList("fueldumps", fuelDumps);
  renderLocPickers();
  syncScalars();
  syncFleetContractVisibility();
  syncFleetUI();
  renderTxns();
  renderBoughtItems();
  renderChars();
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
    if (el.dataset.path.startsWith("fleet.") && !state.fleet) return;
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
  if (el.dataset && el.dataset.path && el.dataset.path.startsWith("fleet.") && !state.fleet) return;
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
    case "remove-ship": if (state.fleet) state.fleet.ships.splice(i, 1); render(); break;
    case "add-crew": if (state.fleet && state.fleet.ships[si]) state.fleet.ships[si].crew.push({ name: "", salary: 0, passage: "middle" }); render(); break;
    case "remove-crew": if (state.fleet && state.fleet.ships[si]) state.fleet.ships[si].crew.splice(rj, 1); render(); break;
    case "add-berth": if (state.fleet && state.fleet.ships[si]) state.fleet.ships[si].berths.push({ type: "standard", number: 1 }); render(); break;
    case "remove-berth": if (state.fleet && state.fleet.ships[si]) state.fleet.ships[si].berths.splice(rj, 1); render(); break;
    case "remove-stop": state.stops.splice(i, 1); render(); break;
    case "remove-avoid": state.avoid.splice(i, 1); render(); break;
    case "remove-fueldump": if (state.fleet) state.fleet.fuel_dumps.splice(i, 1); render(); break;
    case "move-ship": moveShip(i); render(); break;
  }
});

// ---------------------------------------------------------------- games
// Data model: 'travellerweb.games' maps game name -> game, where
// game = { name, opening_balance, transactions, fleets: [{name, location, ships}] }.
// The in-memory `games` map is the single source of truth. On boot we probe
// /api/me; when the backend recognises us (authentik SSO headers) we enter
// server mode and use the account's games map via GET/PUT /api/games, always
// mirroring to localStorage as an offline cache. Any failure along the way
// (no fetch, 401, network error, non-JSON, missing uid) keeps the classic
// localStorage-only behaviour.
const GAMES_KEY = "travellerweb.games";
const LEGACY_FLEETS_KEY = "travellerweb.fleets";

let games = (() => {
  try { return JSON.parse(localStorage.getItem(GAMES_KEY)) || {}; } catch (_) { return {}; }
})();
let serverMode = false;
let serverUser = null;

const loadGames = () => games;

// Small status indicator next to the save controls: persistent
// 'Signed in as <username>' (server mode) vs 'Saving locally' (local mode),
// plus transient 'Saved to account' / 'Save failed' flashes on server saves.
let saveStatusEl = null;
let saveStatusTimer = null;
function getSaveStatusEl() {
  if (saveStatusEl) return saveStatusEl;
  saveStatusEl = document.createElement("span");
  saveStatusEl.id = "save-status";
  saveStatusEl.style.cssText = "margin-left:8px;color:#667;font-size:0.85em;";
  const bar = $("game-name") ? $("game-name").parentElement : null;
  (bar || document.body).appendChild(saveStatusEl);
  return saveStatusEl;
}
function setSaveStatus(text, transient) {
  const el = getSaveStatusEl();
  if (saveStatusTimer) { clearTimeout(saveStatusTimer); saveStatusTimer = null; }
  el.textContent = text;
  if (transient) {
    saveStatusTimer = setTimeout(() => {
      el.textContent = serverMode
        ? ("Signed in as " + esc((serverUser && (serverUser.username || serverUser.uid)) || ""))
        : "Saving locally";
    }, 2000);
  }
}

const persistGames = (g) => {
  games = g;
  try { localStorage.setItem(GAMES_KEY, JSON.stringify(g)); } catch (_) { /* offline cache only */ }
  if (serverMode) {
    fetch("/api/games", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(g),
    })
      .then((r) => setSaveStatus(r.ok ? "Saved to account" : "Save failed", true))
      .catch(() => setSaveStatus("Save failed", true));
  }
};

// Enter server mode only when /api/me is ok AND carries a truthy uid AND
// /api/games loads; otherwise stay in local mode with the localStorage map
// already in `games`. Never throws.
async function bootstrapGames() {
  try {
    if (typeof fetch === "undefined") return;
    const meRes = await fetch("/api/me");
    if (!meRes.ok) return;
    const me = await meRes.json();
    if (!me || !me.uid) return;
    const gamesRes = await fetch("/api/games");
    if (!gamesRes.ok) return;
    const remote = await gamesRes.json();
    if (remote && typeof remote === "object" && !Array.isArray(remote)) games = remote;
    serverMode = true;
    serverUser = me;
    setSaveStatus("Signed in as " + esc(me.username || me.uid));
  } catch (_) {
    // local mode; `games` already came from localStorage
  }
}
setSaveStatus("Saving locally");

const gameFleetCount = (g) => (Array.isArray(g && g.fleets) ? g.fleets.length : 0);

function savedGameOptions() {
  const games = loadGames();
  return Object.keys(games).sort().map((n) => {
    const c = gameFleetCount(games[n]);
    return `<option value="${esc(n)}">${esc(n)} (${c} fleet${c === 1 ? "" : "s"})</option>`;
  }).join("");
}

// Fill the two game dropdowns (Fleets tab + Route tab) and sync their values.
function refreshGameSelect() {
  const opts = savedGameOptions();
  const gs = $("game-select");
  if (gs) gs.innerHTML = '<option value="">— saved games —</option>' + opts;
  const rgs = $("route-game-select");
  if (rgs) rgs.innerHTML = '<option value="">— choose saved game —</option>' + opts;
  syncGameUI();
}

function syncGameUI() {
  const current = (state.game && state.game.name) || "";
  const games = loadGames();
  const active = (current && games[current]) ? current : "";
  const gs = $("game-select");
  if (gs) gs.value = active;
  const rgs = $("route-game-select");
  if (rgs) rgs.value = active;
  refreshFleetSelect();
}

// Load a saved game by name into state.game, re-pointing state.fleet at its
// first fleet. Returns true on success.
function loadGameByName(name) {
  const games = loadGames();
  const saved = games[name];
  if (!saved) return false;
  state.game = normalizeGame(saved);
  state.fleet = (state.game.fleets && state.game.fleets.length) ? state.game.fleets[0] : null;
  syncGameUI();
  return true;
}

// Persist the current in-memory game under its own name. No-op (false) when
// the game has no name yet.
function persistCurrentGame() {
  if (!state.game || !state.game.name) return false;
  const games = loadGames();
  games[state.game.name] = deepCopy(state.game);
  persistGames(games);
  return true;
}

$("save-game").addEventListener("click", () => {
  const name = $("game-name").value.trim();
  if (!name) return alert("Enter a game name first");
  if (!state.game.fleets.length) return alert("Nothing to save — add a fleet first");
  state.game.name = name;
  const games = loadGames();
  games[name] = deepCopy(state.game);
  persistGames(games);
  refreshGameSelect();
  $("game-name").value = "";
});

$("load-game").addEventListener("click", () => {
  const name = $("game-select").value;
  if (!name) return;
  if (loadGameByName(name)) render();
});

$("route-game-select").addEventListener("change", () => {
  const name = $("route-game-select").value;
  if (!name) return;
  if (loadGameByName(name)) render();
});

$("delete-game").addEventListener("click", () => {
  const name = $("game-select").value;
  if (!name) return;
  if (!confirm(`Delete saved game "${name}"?`)) return;
  const games = loadGames();
  delete games[name];
  persistGames(games);
  refreshGameSelect();
});

// ---------------------------------------------------------------- fleet save/load
const fleetShipCount = (f) => (Array.isArray(f && f.ships) ? f.ships.length : 0);

// Fleets live inside the current game: state.game.fleets is an array of
// {name, location, ships, fuel_dumps, contract}.
function savedFleetOptions() {
  const fleets = ((state.game && state.game.fleets) || [])
    .filter((f) => f && f.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  return fleets.map((f) => {
    const c = fleetShipCount(f);
    return `<option value="${esc(f.name)}">${esc(f.name)} (${c} ship${c === 1 ? "" : "s"})</option>`;
  }).join("");
}

function refreshFleetSelect() {
  const opts = savedFleetOptions();
  $("fleet-select").innerHTML = '<option value="">— saved fleets —</option>' + opts;
  $("route-fleet-select").innerHTML = '<option value="">— choose saved fleet —</option>' + opts;
  syncFleetUI();
}

// Keep the two fleet dropdowns (Fleets tab + Route tab), the location field
// and the "Current fleet" hint in sync with state.fleet.
function syncFleetUI() {
  const current = (state.fleet && state.fleet.name) || "";
  const fleets = (state.game && state.game.fleets) || [];
  const active = fleets.some((f) => f.name === current) ? current : "";
  $("fleet-select").value = active;
  $("route-fleet-select").value = active;
  const locEl = $("fleet-location");
  if (locEl && document.activeElement !== locEl) locEl.value = (state.fleet && state.fleet.location) || "";
  const status = $("route-fleet-status");
  if (status) {
    const c = (state.fleet && state.fleet.ships) ? state.fleet.ships.length : 0;
    status.textContent = `Current fleet: ${current || "unnamed"} (${c} ship${c === 1 ? "" : "s"})`;
  }
}

// Load a fleet by name from the current game into state.fleet as a live
// reference (edits land straight in the game). Returns true on success.
// Shared by the Fleets tab "Load" button and the Route tab fleet dropdown.
function loadFleetByName(name) {
  if (!state.game) return false;
  const idx = state.game.fleets.findIndex((f) => f.name === name);
  if (idx < 0) return false;
  state.fleet = state.game.fleets[idx];
  ensureLedger();
  return true;
}

$("save-fleet").addEventListener("click", () => {
  const name = $("fleet-name").value.trim();
  if (!name) return alert("Enter a fleet name first");
  if (!state.fleet || !state.fleet.ships.length) return alert("Nothing to save — add some ships first");
  const location = $("fleet-location").value.trim();
  const toSave = deepCopy(state.fleet);
  toSave.name = name;
  toSave.location = location;
  const idx = state.game.fleets.findIndex((f) => f.name === name);
  if (idx >= 0) state.game.fleets[idx] = toSave;
  else state.game.fleets.push(toSave);
  state.fleet = state.game.fleets[idx >= 0 ? idx : state.game.fleets.length - 1];
  if (!persistCurrentGame()) alert("Save the game first — give it a name on the Games bar");
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
  state.game.fleets = state.game.fleets.filter((f) => f.name !== name);
  if (state.fleet && state.fleet.name === name) state.fleet = state.game.fleets[0] || null;
  persistCurrentGame();
  refreshFleetSelect();
});

// ---------------------------------------------------------------- transactions
function txId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const fmtCr = (n) => "Cr " + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const signedCr = (n) => (n < 0 ? "−" : "") + fmtCr(n);

function normalizeDay(t) {
  // In-game Imperial calendar date: day-of-year (1–365) + year (e.g. 1105).
  let day = parseInt(t.day, 10);
  let year = parseInt(t.year, 10);
  if (!isFinite(day) || !isFinite(year)) {
    // migrate any legacy Gregorian `date` ("YYYY-MM-DD") → day-of-year + year
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(t.date || "").trim());
    if (m) {
      year = +m[1];
      day = Math.round((Date.UTC(year, +m[2] - 1, +m[3]) - Date.UTC(year, 0, 0)) / 86400000);
    }
  }
  if (!isFinite(day)) day = 1;
  if (!isFinite(year)) year = 1105;
  return { day: Math.max(1, Math.min(365, day)), year };
}

function normalizeTxns(list) {
  if (!Array.isArray(list)) return [];
  return list.map((t) => {
    const amount = (typeof t.amount === "number" && isFinite(t.amount)) ? t.amount : (parseFloat(t.amount) || 0);
    const { day, year } = normalizeDay(t);
    return {
      id: (typeof t.id === "string" && t.id) ? t.id : txId(),
      day,
      year,
      type: t.type === "income" ? "income" : "expense",
      amount,
      category: (typeof t.category === "string") ? t.category : String(t.category || ""),
      note: (typeof t.note === "string") ? t.note : String(t.note || ""),
    };
  });
}

function ensureLedger() {
  if (typeof state.game.opening_balance !== "number" || !isFinite(state.game.opening_balance)) state.game.opening_balance = 0;
  if (!Array.isArray(state.game.transactions)) state.game.transactions = [];
}

const fmtDate = (t) => String(t.day).padStart(3, "0") + "-" + String(t.year);
let lastDay = 1, lastYear = 1105; // prefill the add-form with the most recent in-game date

function txTotals() {
  const txs = state.game.transactions || [];
  let income = 0, expense = 0;
  txs.forEach((t) => { if (t.type === "income") income += t.amount; else expense += t.amount; });
  return { income, expense, balance: (state.game.opening_balance || 0) + income - expense };
}

function renderTxns() {
  ensureLedger();
  const openEl = $("tx-opening");
  if (openEl && document.activeElement !== openEl) openEl.value = (state.game.opening_balance || 0);

  $("tx-fleet-label").textContent = `Money for game “${state.game.name || "unnamed"}” — the game keeps one ledger for all its fleets; Save on the Fleets tab to keep changes.`;

  const txs = state.game.transactions;
  const sorted = txs.map((t, i) => ({ t, i })).sort((a, b) =>
    (a.t.year - b.t.year) || (a.t.day - b.t.day) || (a.i - b.i));
  let running = state.game.opening_balance || 0;
  const rows = sorted.map(({ t }) => {
    running += t.type === "income" ? t.amount : -t.amount;
    return `<tr data-tx-id="${esc(t.id)}">
      <td>${esc(fmtDate(t))}</td>
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
    <div class="tx-chip">Opening <strong>${signedCr(state.game.opening_balance || 0)}</strong></div>
    <div class="tx-chip income">In <strong>+${fmtCr(totals.income)}</strong></div>
    <div class="tx-chip expense">Spent <strong>−${fmtCr(totals.expense)}</strong></div>
    <div class="tx-chip balance">Balance <strong>${signedCr(totals.balance)}</strong></div>`;

  // Route tab: the read-only capital field mirrors the ledger balance.
  const capEl = $("route-capital");
  if (capEl) capEl.value = totals.balance;

  $("tx-list").innerHTML = txs.length
    ? `<table class="tx-table">
        <thead><tr><th>Day</th><th>Type</th><th>Category</th><th>Note</th><th class="num">Amount</th><th class="num">Balance</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`
    : '<p class="hint">No transactions for this game yet — add one above.</p>';
}

let editingTxId = null;

function resetTxForm() {
  editingTxId = null;
  $("tx-day").value = lastDay;
  $("tx-year").value = lastYear;
  $("tx-type").value = "expense";
  $("tx-amount").value = "";
  $("tx-category").value = "";
  $("tx-note").value = "";
  $("tx-add").textContent = "Add transaction";
  $("tx-cancel").hidden = true;
}

$("tx-add").addEventListener("click", () => {
  const day = parseInt($("tx-day").value, 10);
  const year = parseInt($("tx-year").value, 10);
  const type = $("tx-type").value;
  const amount = parseFloat($("tx-amount").value);
  if (!isFinite(day) || day < 1 || day > 365) return alert("Enter an in-game day between 1 and 365");
  if (!isFinite(year)) return alert("Enter an in-game year (e.g. 1105)");
  if (!isFinite(amount) || amount <= 0) return alert("Enter a positive amount");
  ensureLedger();
  const patch = { day, year, type, amount, category: $("tx-category").value.trim(), note: $("tx-note").value.trim() };
  if (editingTxId) {
    const t = state.game.transactions.find((x) => x.id === editingTxId);
    if (t) Object.assign(t, patch);
  } else {
    state.game.transactions.push({ id: txId(), ...patch });
  }
  lastDay = day; lastYear = year;
  renderTxns();
  resetTxForm();
});

$("tx-cancel").addEventListener("click", resetTxForm);

$("tx-opening").addEventListener("input", () => {
  const v = parseFloat($("tx-opening").value);
  state.game.opening_balance = isFinite(v) ? v : 0;
  renderTxns();
});

$("tx-list").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === "edit-tx") {
    const t = (state.game.transactions || []).find((x) => x.id === id);
    if (!t) return;
    editingTxId = id;
    $("tx-day").value = t.day;
    $("tx-year").value = t.year;
    $("tx-type").value = t.type;
    $("tx-amount").value = t.amount;
    $("tx-category").value = t.category;
    $("tx-note").value = t.note;
    $("tx-add").textContent = "Save changes";
    $("tx-cancel").hidden = false;
  } else if (btn.dataset.action === "delete-tx") {
    if (!confirm("Delete this transaction?")) return;
    state.game.transactions = (state.game.transactions || []).filter((x) => x.id !== id);
    renderTxns();
  }
});

// ---------------------------------------------------------------- buy
// Item catalogue loaded from items.json (fetch). Buying posts an expense
// transaction to the current game's ledger.
let catalogue = [];
let catalogueLoaded = false;
let selectedItemId = null;

function loadCatalogue() {
  if (catalogueLoaded) return Promise.resolve(catalogue);
  catalogueLoaded = true;
  return fetch("/static/items.json")
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then((d) => {
      catalogue = Array.isArray(d) ? d : [];
      renderBuyList();
      return catalogue;
    })
    .catch((err) => {
      catalogueLoaded = false;
      console.error("items fetch failed:", err);
      const list = $("buy-list");
      if (list) list.innerHTML = '<p class="hint">Could not load item catalogue.</p>';
      return [];
    });
}

function buyCategories() {
  const seen = {};
  catalogue.forEach((it) => { if (it && it.category) seen[it.category] = true; });
  return Object.keys(seen).sort();
}

function itemStatsHTML(it) {
  const stats = it.stats || {};
  const parts = Object.keys(stats)
    .map((k) => `${k}: ${Array.isArray(stats[k]) ? stats[k].join(", ") : stats[k]}`);
  return parts.length ? `<div class="buy-item-stats">${esc(parts.join(" · "))}</div>` : "";
}

// NOTE (XSS): all interpolated values below are escaped via esc() (see the
// render-section note); numbers are rendered through String() coercion.
function renderBuyList() {
  const cats = buyCategories();
  const cur = $("buy-category").value;
  $("buy-category").innerHTML = '<option value="">All categories</option>' +
    cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  $("buy-category").value = cats.includes(cur) ? cur : "";

  const q = ($("buy-search").value || "").trim().toLowerCase();
  const cat = $("buy-category").value;
  const items = catalogue.filter((it) => {
    if (!it) return false;
    if (cat && it.category !== cat) return false;
    if (!q) return true;
    return String(it.name || "").toLowerCase().includes(q)
      || String(it.category || "").toLowerCase().includes(q)
      || String(it.id || "").toLowerCase().includes(q);
  });

  $("buy-list").innerHTML = items.length
    ? items.map((it) => {
        const sel = it.id === selectedItemId ? " selected" : "";
        return `<div class="buy-item${sel}" data-item-id="${esc(it.id)}">
          <div class="buy-item-head">
            <strong>${esc(it.name)}</strong>
            <span class="buy-item-meta">${esc(it.category || "")} · TL ${esc(it.tl != null ? it.tl : "—")} · ${esc(it.mass != null ? it.mass + " kg" : "—")} · <span class="buy-cost">Cr ${esc(it.cost != null ? it.cost : "—")}</span></span>
          </div>
          ${itemStatsHTML(it)}
        </div>`;
      }).join("")
    : '<p class="hint">No items match.</p>';
}

$("buy-search").addEventListener("input", renderBuyList);
$("buy-category").addEventListener("change", renderBuyList);
$("buy-list").addEventListener("click", (e) => {
  const row = e.target.closest(".buy-item");
  if (!row) return;
  selectedItemId = row.dataset.itemId;
  renderBuyList();
});

$("buy-btn").addEventListener("click", () => {
  const item = catalogue.find((it) => it && it.id === selectedItemId);
  if (!item) return alert("Select an item first");
  const qty = Math.max(1, parseInt($("buy-qty").value, 10) || 1);
  ensureLedger();
  const t = {
    id: txId(),
    day: lastDay,
    year: lastYear,
    type: "expense",
    amount: item.cost * qty,
    category: item.category || "",
    note: qty + " x " + item.name,
  };
  state.game.transactions.push(t);

  // Track the purchase in the game's inventory (full stats snapshot), merging
  // repeat buys of the same item into a single line.
  ensureBoughtItems();
  const existing = state.game.boughtItems.find((b) => b.itemId === item.id);
  if (existing) {
    existing.qty += qty;
    existing.total += item.cost * qty;
    existing.day = lastDay;
    existing.year = lastYear;
  } else {
    state.game.boughtItems.push({
      id: txId(),
      itemId: item.id,
      name: item.name,
      category: item.category || "",
      tl: item.tl != null ? item.tl : null,
      cost: item.cost != null ? item.cost : 0,
      mass: item.mass != null ? item.mass : 0,
      stats: deepCopy(item.stats || {}),
      qty,
      total: item.cost * qty,
      day: lastDay,
      year: lastYear,
    });
  }

  renderTxns();
  renderBoughtItems();
  $("buy-qty").value = 1;
});

// ---------------------------------------------------------------- bought items
function ensureBoughtItems() {
  if (!Array.isArray(state.game.boughtItems)) state.game.boughtItems = [];
}

function renderBoughtItems() {
  ensureBoughtItems();
  const list = $("bought-list");
  if (!list) return;
  const lbl = $("inv-label");
  if (lbl) lbl.textContent = `Equipment bought for game “${state.game.name || "unnamed"}” — saved with the game (Save on the Fleets tab).`;
  const items = state.game.boughtItems;
  if (!items.length) {
    list.innerHTML = '<p class="hint">Nothing bought yet — use the Buy tab to purchase equipment.</p>';
    return;
  }
  let spent = 0;
  const rows = items.map((b) => {
    spent += b.total;
    return `<div class="bought-item" data-bought-id="${esc(b.id)}">
      <div class="bought-item-head">
        <strong>${esc(b.name)}</strong>
        <span class="bought-qty">× ${esc(b.qty)}</span>
        <span class="buy-item-meta">${esc(b.category || "")} · TL ${esc(b.tl != null ? b.tl : "—")} · ${esc(b.mass != null ? b.mass + " kg" : "—")} · <span class="buy-cost">Cr ${esc(b.cost != null ? b.cost : "—")}</span> each</span>
        <span class="bought-total">${esc(signedCr(b.total))}</span>
        <button class="danger small" data-action="delete-bought" data-id="${esc(b.id)}">✕</button>
      </div>
      ${itemStatsHTML(b)}
      <div class="bought-date hint">Bought ${esc(fmtDate(b))}</div>
    </div>`;
  }).join("");
  list.innerHTML = `<div class="bought-summary">${items.length} item type${items.length === 1 ? "" : "s"} · total spent <strong>${esc(signedCr(spent))}</strong></div>` + rows;
}

$("bought-list").addEventListener("click", (e) => {
  const btn = e.target.closest('[data-action="delete-bought"]');
  if (!btn) return;
  if (!confirm("Remove this item from the inventory? (The ledger entry stays.)")) return;
  state.game.boughtItems = state.game.boughtItems.filter((b) => b.id !== btn.dataset.id);
  renderBoughtItems();
});

// ---------------------------------------------------------------- characters
// MgT2e character sheets live on state.game.characters and persist with the
// game. Every dynamic value below is esc()'d before innerHTML.
function ensureChars() {
  if (!Array.isArray(state.game.characters)) state.game.characters = [];
}

// Parse a comma-separated skills string like "Pilot 2, Engineer 1, Medic, Astrogation".
// Each entry is "SkillName [Level]"; the trailing level is optional (defaults 0).
function parseSkills(str) {
  return String(str || "").split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const parts = s.split(/\s+/);
      const last = parts[parts.length - 1];
      if (parts.length > 1 && /^\d+$/.test(last)) {
        return {
          name: parts.slice(0, -1).join(" "),
          level: Math.max(0, Math.min(6, parseInt(last, 10))),
        };
      }
      return { name: s, level: 0 };
    });
}

let editingCharId = null;

function resetCharForm() {
  editingCharId = null;
  ["name", "role", "career", "age", "homeworld", "salary", "pension", "rank", "terms", "cash", "skills", "benefits", "notes"].forEach((f) => {
    $(`char-${f}`).value = "";
  });
  CHAR_STAT_KEYS.forEach((k) => { $(`char-${k}`).value = ""; });
  $("char-save").textContent = "Add Character";
  $("char-cancel").hidden = true;
}

function charFormToObj() {
  const characteristics = {};
  CHAR_STAT_KEYS.forEach((k) => {
    characteristics[k] = Math.max(0, Math.min(15, parseInt($(`char-${k}`).value, 10) || 0));
  });
  const num = (el) => { const n = parseFloat(el.value); return Number.isFinite(n) ? n : 0; };
  return {
    name: $("char-name").value.trim(),
    role: $("char-role").value.trim(),
    career: $("char-career").value.trim(),
    age: $("char-age").value === "" ? null : (parseInt($("char-age").value, 10) || 0),
    homeworld: $("char-homeworld").value.trim(),
    characteristics,
    skills: parseSkills($("char-skills").value),
    salary: num($("char-salary")),
    pension: num($("char-pension")),
    rank: $("char-rank").value.trim(),
    terms: parseInt($("char-terms").value, 10) || 0,
    cash: num($("char-cash")),
    benefits: $("char-benefits").value.trim(),
    notes: $("char-notes").value.trim(),
  };
}

$("char-save").addEventListener("click", () => {
  const obj = charFormToObj();
  if (!obj.name) return alert("Enter a character name first");
  ensureChars();
  if (editingCharId) {
    const c = state.game.characters.find((x) => x.id === editingCharId);
    if (c) Object.assign(c, obj);
  } else {
    state.game.characters.push(Object.assign({ id: txId() }, obj));
  }
  renderChars();
  resetCharForm();
});

$("char-cancel").addEventListener("click", resetCharForm);

function renderChars() {
  ensureChars();
  const list = $("char-list");
  if (!list) return;
  const lbl = $("chars-label");
  if (lbl) lbl.textContent = `Characters for game “${state.game.name || "unnamed"}” — saved with the game (Save on the Fleets tab).`;
  const chars = state.game.characters;
  if (!chars.length) {
    list.innerHTML = '<p class="hint">No characters yet — add one above.</p>';
    return;
  }
  list.innerHTML = chars.map((c) => {
    const stats = CHAR_STAT_KEYS.map((k) => {
      const v = (c.characteristics && c.characteristics[k]) || 0;
      const dm = charDM(v);
      return `<span class="char-stat"><strong>${esc(k.toUpperCase())}</strong> ${esc(v)} <span class="char-dm">(${dm >= 0 ? "+" : ""}${dm})</span></span>`;
    }).join("");
    const skills = (c.skills || []).map((s) =>
      `<span class="skill-chip">${esc(s.name)}${s.level ? " " + esc(s.level) : ""}</span>`).join("");
    const facts = [];
    if (c.salary) facts.push(`<span class="char-fact">Salary ${esc(fmtCr(c.salary))}/month</span>`);
    if (c.pension) facts.push(`<span class="char-fact">Pension ${esc(fmtCr(c.pension))}/year</span>`);
    if (c.age != null) facts.push(`<span class="char-fact">Age ${esc(c.age)}</span>`);
    if (c.homeworld) facts.push(`<span class="char-fact">Homeworld ${esc(c.homeworld)}</span>`);
    if (c.terms) facts.push(`<span class="char-fact">${esc(c.terms)} term${c.terms === 1 ? "" : "s"}</span>`);
    if (c.cash) facts.push(`<span class="char-fact">${esc(signedCr(c.cash))} cash</span>`);
    const meta = [c.role, c.career, c.rank].filter(Boolean).join(" · ");
    return `<div class="char-card" data-char-id="${esc(c.id)}">
      <div class="char-head">
        <strong>${esc(c.name)}</strong>
        ${meta ? `<span class="char-meta">${esc(meta)}</span>` : ""}
        <span class="char-actions">
          <button class="ghost small" data-action="edit-char" data-id="${esc(c.id)}">Edit</button>
          <button class="danger small" data-action="delete-char" data-id="${esc(c.id)}">✕</button>
        </span>
      </div>
      <div class="char-stats">${stats}</div>
      ${facts.length ? `<div class="char-facts">${facts.join("")}</div>` : ""}
      ${skills ? `<div class="char-skills">${skills}</div>` : ""}
      ${c.benefits ? `<div class="char-note-line"><span class="char-label">Benefits</span> ${esc(c.benefits)}</div>` : ""}
      ${c.notes ? `<div class="char-note-line"><span class="char-label">Notes</span> ${esc(c.notes)}</div>` : ""}
    </div>`;
  }).join("");
}

$("char-list").addEventListener("click", (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const chars = state.game.characters || [];
  if (btn.dataset.action === "edit-char") {
    const c = chars.find((x) => x.id === id);
    if (!c) return;
    editingCharId = id;
    $("char-name").value = c.name;
    $("char-role").value = c.role;
    $("char-career").value = c.career;
    $("char-age").value = c.age == null ? "" : c.age;
    $("char-homeworld").value = c.homeworld;
    $("char-salary").value = c.salary || "";
    $("char-pension").value = c.pension || "";
    $("char-rank").value = c.rank;
    $("char-terms").value = c.terms || "";
    $("char-cash").value = c.cash || "";
    CHAR_STAT_KEYS.forEach((k) => { $(`char-${k}`).value = (c.characteristics && c.characteristics[k]) || ""; });
    $("char-skills").value = (c.skills || []).map((s) => s.level ? `${s.name} ${s.level}` : s.name).join(", ");
    $("char-benefits").value = c.benefits;
    $("char-notes").value = c.notes;
    $("char-save").textContent = "Save changes";
    $("char-cancel").hidden = false;
  } else if (btn.dataset.action === "delete-char") {
    if (!confirm("Delete this character?")) return;
    state.game.characters = chars.filter((x) => x.id !== id);
    renderChars();
  }
});

// ---------------------------------------------------------------- actions
function ensureFleet() {
  if (state.fleet) return state.fleet;
  state.game.fleets.push({ name: "", location: "", ships: [], fuel_dumps: [], contract: { type: "none" } });
  state.fleet = state.game.fleets[state.game.fleets.length - 1];
  return state.fleet;
}

$("load-preset").addEventListener("click", () => {
  state = deepCopy(DEFAULT_CONFIG);
  state.fleet = state.game.fleets[0] || null;
  refreshGameSelect();
  render();
});
$("clear-all").addEventListener("click", () => {
  state = emptyConfig();
  state.fleet = null;
  refreshGameSelect();
  render();
});
$("add-ship").addEventListener("click", () => { ensureFleet(); state.fleet.ships.push(emptyShip()); render(); });
$("add-stop").addEventListener("click", () => { state.stops.push({ sector: "", hex: "" }); render(); });
$("add-avoid").addEventListener("click", () => { state.avoid.push({ sector: "", hex: "" }); render(); });
$("add-fueldump").addEventListener("click", () => { ensureFleet(); state.fleet.fuel_dumps.push({ sector: "", hex: "" }); render(); });

document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
  $("tab-fleet").hidden = t.dataset.tab !== "fleet";
  $("tab-route").hidden = t.dataset.tab !== "route";
  $("tab-json").hidden = t.dataset.tab !== "json";
  $("tab-txs").hidden = t.dataset.tab !== "txs";
  $("tab-buy").hidden = t.dataset.tab !== "buy";
  $("tab-inv").hidden = t.dataset.tab !== "inv";
  $("tab-chars").hidden = t.dataset.tab !== "chars";
  if (t.dataset.tab === "json") $("json-editor").value = JSON.stringify(state, null, 2);
  if (t.dataset.tab === "txs") renderTxns();
  if (t.dataset.tab === "buy") loadCatalogue();
  if (t.dataset.tab === "inv") renderBoughtItems();
  if (t.dataset.tab === "chars") renderChars();
}));

$("export-json").addEventListener("click", () => {
  $("json-editor").value = JSON.stringify(state, null, 2);
});
$("load-json").addEventListener("click", () => {
  try {
    const parsed = JSON.parse($("json-editor").value);
    state = normalize(parsed);
    state.fleet = (state.game.fleets && state.game.fleets.length) ? state.game.fleets[0] : null;
    refreshGameSelect();
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
      body: JSON.stringify({ config: Object.assign({}, state, {
        // the route form's date/capital inputs now edit the game's own state;
        // the backend still expects the legacy top-level start_date / capital
        start_date: (state.game && state.game.current_date) || { year: 1105, day: 1 },
        capital: txTotals().balance,
      }) }),
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
let lastFirstStep = null; // first_step payload from the most recent plan response

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
  lastFirstStep = (data.first_step && typeof data.first_step === "object") ? data.first_step : null;
  let html = renderMarkdown(lastMarkdown);
  if (lastFirstStep && lastFirstStep.to && lastFirstStep.to.name) {
    html += `<button id="route-take-first-step" class="primary">Take first step → ${esc(lastFirstStep.to.name)}</button>`;
  }
  $("route-output").innerHTML = html;
  $("results").scrollIntoView({ behavior: "smooth", block: "start" });
}

// Advance an in-game date by `days` (365-day years, no leap years — matches
// the backend's Date.add_days: day rolls over 365 → year++).
function addDays(date, days) {
  const d = (date && typeof date === "object") ? date : { year: 1105, day: 1 };
  let day = parseInt(d.day, 10) || 1;
  let year = parseInt(d.year, 10) || 1105;
  let n = parseInt(days, 10) || 0;
  day += n;
  while (day > 365) { day -= 365; year++; }
  while (day < 1) { day += 365; year--; }
  return { year, day };
}

// Post the first step's ledger line items, advance the game date, move the
// fleet, persist via the normal save path and re-render the affected views.
function takeFirstStep() {
  const fs = lastFirstStep;
  if (!fs) return;
  if (!state.fleet) return alert("Select a fleet first");
  const from = (fs.from && fs.from.name) || "";
  const to = (fs.to && fs.to.name) || "";

  // day/year of the posted transactions = the STARTING (pre-advance) date
  const start = (state.game && state.game.current_date && typeof state.game.current_date === "object")
    ? state.game.current_date : { year: 1105, day: 1 };
  const adv = addDays(start, fs.duration_days);

  const round2 = (v) => Math.round(Number(v) * 100) / 100;
  // One transaction per non-zero line item; amount is always positive.
  // trade_profit's type depends on its sign; everything else is fixed.
  const lineItems = [
    { key: "fuel_cost", type: "expense", category: "Fuel", note: `Fuel: ${from} → ${to}` },
    { key: "running_cost", type: "expense", category: "Running Costs", note: `Running costs: ${from} → ${to}` },
    { key: "monthly_income", type: "income", category: "Income", note: "Monthly income", min: 0 },
    { key: "mortgage_payment", type: "expense", category: "Mortgage", note: "Mortgage payment", min: 0 },
    { key: "passenger_revenue", type: "income", category: "Passengers", note: `Passengers: ${from} → ${to}`, min: 0 },
    { key: "trade_profit", type: null, category: "Trade", note: `Trade: ${from} → ${to}`, signed: true },
    { key: "cut", type: "expense", category: "Contract Cut", note: "Contract cut", min: 0 },
  ];

  ensureLedger();
  lineItems.forEach((li) => {
    const v = fs[li.key];
    if (v == null || !isFinite(Number(v))) return;
    const rounded = round2(v);
    if (rounded === 0) return; // skip zero line items
    if (li.min != null && v <= li.min) return; // only positive for min:0 items
    const type = li.signed ? (v > 0 ? "income" : "expense") : li.type;
    state.game.transactions.push({
      id: txId(),
      day: start.day,
      year: start.year,
      type,
      amount: Math.abs(rounded),
      category: li.category,
      note: li.note,
    });
  });

  lastDay = adv.day; lastYear = adv.year;
  state.game.current_date = adv;
  state.fleet.location = to;
  if (fs.to) state.start = { sector: fs.to.sector || "", hex: fs.to.hex || "" };
  if (!persistCurrentGame()) alert("Save the game first — give it a name on the Games bar");
  render();
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest && e.target.closest("#route-take-first-step");
  if (btn) takeFirstStep();
});

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
// One-time migration: if the old 'travellerweb.fleets' key exists and no games
// have been saved yet, fold every saved fleet into a default 'Pirates of
// Drinax' game (fleets keep name + ships; the game sums fleet opening balances
// and concatenates fleet transactions, preserving day/year), persist it under
// the new key, then drop the old key.
function migrateLegacyData() {
  if (localStorage.getItem(GAMES_KEY)) return;
  let legacy;
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_FLEETS_KEY)); } catch (_) { legacy = null; }
  if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) return;
  const names = Object.keys(legacy).filter((n) => legacy[n] && typeof legacy[n] === "object");
  if (!names.length) return;

  const game = { name: "Pirates of Drinax", opening_balance: 0, current_date: { year: 1105, day: 1 }, transactions: [], fleets: [] };
  names.forEach((n) => {
    const f = legacy[n];
    game.fleets.push({
      name: n,
      location: "",
      ships: Array.isArray(f.ships) ? f.ships : [],
      fuel_dumps: Array.isArray(f.fuel_dumps) ? f.fuel_dumps : [],
      contract: (f.contract && typeof f.contract === "object") ? f.contract : { type: "none" },
    });
    if (Number.isFinite(Number(f.opening_balance))) game.opening_balance += Number(f.opening_balance);
    if (Array.isArray(f.transactions)) {
      game.transactions = game.transactions.concat(normalizeTxns(f.transactions));
    }
  });

  const games = loadGames();
  games[game.name] = game;
  persistGames(games);
  localStorage.removeItem(LEGACY_FLEETS_KEY);
}

async function init() {
  await bootstrapGames();
  migrateLegacyData();
  refreshGameSelect();
  resetTxForm();
  render();
  loadCatalogue();
}
init();