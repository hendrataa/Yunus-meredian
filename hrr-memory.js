/**
 * HRR Memory — Holographic Reduced Representations for cross-session recall.
 *
 * Facts are stored as superposed complex-valued unit vectors.
 * Recall is algebraic (~1ms), zero external dependencies.
 * Facts recalled >= PROMOTE_THRESHOLD times get added to permanent context
 * and injected into every system prompt.
 *
 * Usage:
 *   remember("strategy:spot:vol:3", "profit:4.2%")
 *   recall("strategy:spot:vol:3")  → { value: "profit:4.2%", similarity: 0.87, recalls: 4 }
 *   getPromotedContext()           → formatted string for system prompt
 */

import fs from "fs";
import { log } from "./logger.js";

const HRR_FILE = "./hrr-memory.json";
const DIM = 256;              // vector dimensionality — 256 is plenty for this use case
const PROMOTE_THRESHOLD = 3; // recalls before promoting to permanent context

// ─── PRNG ─────────────────────────────────────────────────────────────────────
// Deterministic seed from string → reproducible key vectors without storing them

function stringHash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function mulberry32(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Vector ops ──────────────────────────────────────────────────────────────
// Vectors are plain objects { re: number[], im: number[] } for JSON compat

function makeKeyVector(str) {
  const rand = mulberry32(stringHash(str));
  const re = new Array(DIM);
  const im = new Array(DIM);
  for (let d = 0; d < DIM; d++) {
    const phase = rand() * 2 * Math.PI;
    re[d] = Math.cos(phase);
    im[d] = Math.sin(phase);
  }
  return { re, im };
}

function bind(a, b) {
  const re = new Array(DIM);
  const im = new Array(DIM);
  for (let d = 0; d < DIM; d++) {
    re[d] = a.re[d] * b.re[d] - a.im[d] * b.im[d];
    im[d] = a.re[d] * b.im[d] + a.im[d] * b.re[d];
  }
  return { re, im };
}

function unbind(mem, key) {
  // Multiply by conjugate of key to recover bound value
  const re = new Array(DIM);
  const im = new Array(DIM);
  for (let d = 0; d < DIM; d++) {
    re[d] = mem.re[d] * key.re[d] + mem.im[d] * key.im[d];
    im[d] = -mem.re[d] * key.im[d] + mem.im[d] * key.re[d];
  }
  return { re, im };
}

function superpose(a, b) {
  const re = new Array(DIM);
  const im = new Array(DIM);
  for (let d = 0; d < DIM; d++) {
    re[d] = a.re[d] + b.re[d];
    im[d] = a.im[d] + b.im[d];
  }
  return { re, im };
}

function cosine(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let d = 0; d < DIM; d++) {
    dot  += a.re[d] * b.re[d] + a.im[d] * b.im[d];
    magA += a.re[d] * a.re[d] + a.im[d] * a.im[d];
    magB += b.re[d] * b.re[d] + b.im[d] * b.im[d];
  }
  return dot / (Math.sqrt(magA * magB) + 1e-9);
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function loadDb() {
  if (!fs.existsSync(HRR_FILE)) {
    return { facts: {}, superposition: null, promoted: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(HRR_FILE, "utf8"));
  } catch {
    return { facts: {}, superposition: null, promoted: [] };
  }
}

function saveDb(db) {
  fs.writeFileSync(HRR_FILE, JSON.stringify(db, null, 2));
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Store a key-value fact into HRR memory.
 * Duplicate key-value pairs are silently ignored (idempotent).
 *
 * @param {string} key   - e.g. "strategy:spot:vol:3"
 * @param {string} value - e.g. "profit:4.2%"
 */
export function remember(key, value) {
  const db = loadDb();
  const kv = `${key}::${value}`;

  if (db.facts[kv]) return; // already stored

  db.facts[kv] = {
    key,
    value,
    recalls: 0,
    promoted: false,
    stored_at: new Date().toISOString(),
  };

  const kVec = makeKeyVector(key);
  const vVec = makeKeyVector(value);
  const binding = bind(kVec, vVec);

  db.superposition = db.superposition
    ? superpose(db.superposition, binding)
    : binding;

  saveDb(db);
  log("hrr-memory", `Stored: ${key} → ${value}`);
}

/**
 * Recall the best-matching value for a key.
 * Increments recall count; promotes to permanent context if threshold reached.
 *
 * @param {string} key
 * @returns {{ value: string, similarity: number, recalls: number } | null}
 */
export function recall(key) {
  const db = loadDb();
  if (!db.superposition || Object.keys(db.facts).length === 0) return null;

  const kVec  = makeKeyVector(key);
  const query = unbind(db.superposition, kVec);

  let best    = null;
  let bestSim = -Infinity;

  for (const kv of Object.keys(db.facts)) {
    const fact = db.facts[kv];
    if (fact.key !== key) continue;
    const vVec = makeKeyVector(fact.value);
    const sim  = cosine(query, vVec);
    if (sim > bestSim) {
      bestSim = sim;
      best    = fact;
    }
  }

  if (!best) return null;

  best.recalls += 1;
  best.last_recalled_at = new Date().toISOString();

  if (best.recalls >= PROMOTE_THRESHOLD && !best.promoted) {
    best.promoted = true;
    if (!db.promoted) db.promoted = [];
    db.promoted.push({
      key:          best.key,
      value:        best.value,
      promoted_at:  new Date().toISOString(),
    });
    log("hrr-memory", `PROMOTED: ${best.key} → ${best.value} (recalled ${best.recalls}x)`);
  }

  saveDb(db);
  return { value: best.value, similarity: Math.round(bestSim * 1000) / 1000, recalls: best.recalls };
}

/**
 * Recall all stored values for a key, ranked by similarity.
 * Useful for reviewing all recorded outcomes for a strategy type.
 *
 * @param {string} key
 * @returns {Array<{ value: string, similarity: number, recalls: number, promoted: boolean }>}
 */
export function recallAll(key) {
  const db = loadDb();
  if (!db.superposition || Object.keys(db.facts).length === 0) return [];

  const kVec  = makeKeyVector(key);
  const query = unbind(db.superposition, kVec);

  const results = [];
  for (const kv of Object.keys(db.facts)) {
    const fact = db.facts[kv];
    if (fact.key !== key) continue;
    const vVec = makeKeyVector(fact.value);
    const sim  = cosine(query, vVec);
    results.push({
      value:     fact.value,
      similarity: Math.round(sim * 1000) / 1000,
      recalls:   fact.recalls,
      promoted:  fact.promoted,
    });
  }

  return results.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Get all promoted facts as a formatted string for injection into the system prompt.
 * Returns null if no facts have been promoted yet.
 */
export function getPromotedContext() {
  const db = loadDb();
  if (!db.promoted || db.promoted.length === 0) return null;

  const lines = db.promoted.map((p) => `  [${p.key}]: ${p.value}`);
  return `HRR FLEX MEMORY (patterns recalled ${PROMOTE_THRESHOLD}+ times across sessions):\n${lines.join("\n")}`;
}

/**
 * Return a stats snapshot for diagnostics.
 */
export function getHrrStats() {
  const db = loadDb();
  const facts = Object.values(db.facts);
  return {
    total_facts: facts.length,
    promoted_facts: db.promoted?.length ?? 0,
    total_recalls: facts.reduce((s, f) => s + f.recalls, 0),
    keys: [...new Set(facts.map((f) => f.key))],
  };
}
