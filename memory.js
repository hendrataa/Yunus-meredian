/**
 * Nuggets holographic memory — self-contained implementation.
 * Provides cross-session learning via a simple JSON file store.
 * Replaces the external 'nuggets' package dependency.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAVE_DIR = path.join(__dirname, "data", "nuggets");

// ─── Built-in NuggetShelf ────────────────────────────────────────────────────

class Nugget {
  constructor(name) {
    this.name = name;
    this._data = {}; // key → { value, hits }
  }

  remember(key, value) {
    this._data[key] = { value, hits: this._data[key]?.hits ?? 0 };
  }

  recall(key) {
    if (this._data[key]) {
      this._data[key].hits++;
      return { found: true, key, answer: this._data[key].value, confidence: 1.0 };
    }
    // Partial match fallback
    const lower = key.toLowerCase();
    for (const [k, v] of Object.entries(this._data)) {
      if (k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase())) {
        v.hits++;
        return { found: true, key: k, answer: v.value, confidence: 0.7 };
      }
    }
    return { found: false };
  }

  facts() {
    return Object.entries(this._data).map(([k, v]) => ({ key: k, value: v.value, hits: v.hits }));
  }

  toJSON() { return this._data; }

  fromJSON(data) { this._data = data ?? {}; }
}

class NuggetShelf {
  constructor({ saveDir, autoSave = false }) {
    this.saveDir = saveDir;
    this.autoSave = autoSave;
    this._nuggets = {};
    fs.mkdirSync(saveDir, { recursive: true });
  }

  get size() { return Object.keys(this._nuggets).length; }

  loadAll() {
    try {
      const files = fs.readdirSync(this.saveDir).filter(f => f.endsWith(".json"));
      for (const file of files) {
        const name = file.replace(".json", "");
        const nugget = new Nugget(name);
        const raw = JSON.parse(fs.readFileSync(path.join(this.saveDir, file), "utf8"));
        nugget.fromJSON(raw);
        this._nuggets[name] = nugget;
      }
    } catch { /* ok if dir is empty */ }
  }

  _save(name) {
    if (!this.autoSave) return;
    try {
      fs.writeFileSync(
        path.join(this.saveDir, `${name}.json`),
        JSON.stringify(this._nuggets[name].toJSON(), null, 2)
      );
    } catch { /* best-effort */ }
  }

  getOrCreate(name) {
    if (!this._nuggets[name]) this._nuggets[name] = new Nugget(name);
    return this._nuggets[name];
  }

  get(name) { return this._nuggets[name]; }

  list() { return Object.keys(this._nuggets).map(name => ({ name })); }

  remember(nuggetName, key, value) {
    this.getOrCreate(nuggetName).remember(key, value);
    this._save(nuggetName);
  }

  recall(key, nuggetName) {
    if (nuggetName && this._nuggets[nuggetName]) {
      return this._nuggets[nuggetName].recall(key);
    }
    // Search all nuggets
    for (const nugget of Object.values(this._nuggets)) {
      const r = nugget.recall(key);
      if (r.found) return r;
    }
    return { found: false };
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let shelf = null;

/**
 * Initialize the memory system. Call once at startup.
 */
export function initMemory() {
  shelf = new NuggetShelf({ saveDir: SAVE_DIR, autoSave: true });
  shelf.loadAll();

  // Ensure core nuggets exist
  shelf.getOrCreate("pools");
  shelf.getOrCreate("strategies");
  shelf.getOrCreate("lessons");
  shelf.getOrCreate("patterns");

  log("memory", `Nuggets memory initialized (${shelf.size} nuggets loaded from ${SAVE_DIR})`);
  return shelf;
}

export function getShelf() {
  if (!shelf) initMemory();
  return shelf;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function rememberPoolOutcome(poolName, result) {
  const s = getShelf();
  const key = poolName.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);
  const value = typeof result === "string" ? result : JSON.stringify(result);
  s.remember("pools", key, value.slice(0, 200));
  log("memory", `Remembered pool outcome: ${key}`);
}

export function rememberStrategy(pattern, result) {
  const s = getShelf();
  const key = pattern.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);
  const value = typeof result === "string" ? result : JSON.stringify(result);
  s.remember("strategies", key, value.slice(0, 200));
  log("memory", `Remembered strategy: ${key}`);
}

function sanitizeKey(str) {
  return str.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);
}

export function recallForScreening(poolData) {
  const s = getShelf();
  const results = [];

  const rawName = poolData?.name || poolData?.pair;
  if (rawName) {
    const r = s.recall(sanitizeKey(rawName), "pools");
    if (r.found) results.push({ source: "pools", ...r });
  }

  if (poolData?.base_token) {
    const r = s.recall(sanitizeKey(poolData.base_token), "pools");
    if (r.found && !results.some(x => x.key === r.key)) results.push({ source: "pools", ...r });
  }

  if (poolData?.bin_step) {
    const r = s.recall(`bid_ask_bs${poolData.bin_step}`, "strategies");
    if (r.found) results.push({ source: "strategies", ...r });
  }

  return results;
}

export function recallForManagement(position) {
  const s = getShelf();
  const results = [];

  const rawKey = position?.pair || position?.pool_name;
  if (rawKey) {
    const r = s.recall(sanitizeKey(rawKey), "pools");
    if (r.found) results.push({ source: "pools", ...r });
  }

  const r = s.recall("management", "lessons");
  if (r.found) results.push({ source: "lessons", ...r });

  return results;
}

export function getMemoryContext() {
  const s = getShelf();
  const lines = [];

  for (const { name } of s.list()) {
    try {
      const nugget = s.get(name);
      const relevant = nugget.facts().filter(f => f.hits >= 1);
      if (relevant.length === 0) continue;
      lines.push(`[${name}]`);
      for (const f of relevant.slice(0, 10)) {
        lines.push(`  ${f.key}: ${f.value}`);
      }
    } catch { continue; }
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

export function rememberPositionSnapshot(position) {
  const s = getShelf();
  const pair = position.pair || position.pool_name || "unknown";
  const key = pair.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);

  const inRange = position.in_range ? "in-range" : "OOR";
  const pnl = position.pnl_pct != null ? `${position.pnl_pct.toFixed(1)}%` : "?";
  const fees = position.unclaimed_fees_usd != null ? `$${position.unclaimed_fees_usd}` : "?";
  const age = position.age_minutes != null ? `${position.age_minutes}m` : "?";

  s.remember("pools", key, `${inRange}, PnL ${pnl}, fees ${fees}, age ${age}`);

  if (position.fee_tvl_ratio != null) {
    s.getOrCreate("patterns");
    s.remember("patterns", `${key}_feeTvl`, `fee/TVL=${position.fee_tvl_ratio} at ${new Date().toISOString().slice(11, 16)}`);
  }

  log("memory", `Snapshot stored: ${key}`);
}

export function rememberFact(nuggetName, key, value) {
  const s = getShelf();
  s.getOrCreate(nuggetName);
  s.remember(nuggetName, key, value);
  log("memory", `LLM stored fact in ${nuggetName}: ${key}`);
  return { saved: true, nugget: nuggetName, key };
}

export function recallMemory(query, nuggetName) {
  const s = getShelf();
  const result = s.recall(query, nuggetName || undefined);
  log("memory", `LLM recall "${query}" → ${result.found ? result.answer : "not found"}`);
  return result;
}
