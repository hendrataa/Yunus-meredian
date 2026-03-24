/**
 * Meridian Dashboard Server
 *
 * Reads the bot's data files (state.json, lessons.json, strategy-library.json)
 * and serves them via REST + Server-Sent Events (SSE).
 *
 * The bot and this server share the same JSON files — no database needed.
 * When a file changes (bot writes it), SSE pushes the update to all browsers.
 *
 * Usage:
 *   node dashboard/server.js
 *   DASHBOARD_PORT=3000 node dashboard/server.js
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(__dirname, "public");
const PORT = process.env.DASHBOARD_PORT || 3000;

// ─── Data file paths ─────────────────────────────────────────────
const FILES = {
  state:      path.join(ROOT, "state.json"),
  lessons:    path.join(ROOT, "lessons.json"),
  strategies: path.join(ROOT, "strategy-library.json"),
};

// ─── SSE clients ─────────────────────────────────────────────────
const clients = new Set();

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch {}
  }
}

// ─── File watchers ────────────────────────────────────────────────
const watchers = new Map();

function watchFiles() {
  for (const [key, filePath] of Object.entries(FILES)) {
    tryWatch(key, filePath);
  }
}

function tryWatch(key, filePath) {
  if (watchers.has(key)) return;
  if (!fs.existsSync(filePath)) {
    // Retry in 10s if file doesn't exist yet
    setTimeout(() => tryWatch(key, filePath), 10_000);
    return;
  }
  let debounce = null;
  const w = fs.watch(filePath, () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => broadcast(buildPayload()), 200);
  });
  w.on("error", () => {
    watchers.delete(key);
    setTimeout(() => tryWatch(key, filePath), 5_000);
  });
  watchers.set(key, w);
}

// ─── Data builders ────────────────────────────────────────────────
function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function buildPayload() {
  const state     = readJSON(FILES.state)      || { positions: {}, recentEvents: [] };
  const lessons   = readJSON(FILES.lessons)    || { lessons: [], performance: [] };
  const strats    = readJSON(FILES.strategies) || { strategies: {}, active: null };

  const allPos    = Object.values(state.positions || {});
  const openPos   = allPos.filter(p => !p.closed);
  const perf      = lessons.performance || [];
  const now       = Date.now();

  // ── Performance stats ──────────────────────────────────────────
  const wins      = perf.filter(p => (p.pnl_pct || 0) > 0);
  const losses    = perf.filter(p => (p.pnl_pct || 0) <= 0);
  const winRate   = perf.length > 0
    ? ((wins.length / perf.length) * 100).toFixed(1)
    : "—";
  const gProfit   = wins.reduce((s, p)  => s + Math.abs(p.pnl_pct || 0), 0);
  const gLoss     = losses.reduce((s, p) => s + Math.abs(p.pnl_pct || 0), 0);
  const profFact  = gLoss > 0 ? (gProfit / gLoss).toFixed(2)
                 : gProfit > 0 ? "∞" : "—";

  // Net PnL = sum of (final - initial + fees) for closed positions
  const netPnlUsd = perf.reduce((s, p) => {
    const il  = (p.final_value_usd || 0) - (p.initial_value_usd || 0);
    const fee = p.fees_earned_usd || 0;
    return s + il + fee;
  }, 0);

  // Cumulative PnL series (for chart)
  const cumulativePnl = [];
  let running = 0;
  for (const p of perf.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))) {
    const il  = (p.final_value_usd || 0) - (p.initial_value_usd || 0);
    running  += il + (p.fees_earned_usd || 0);
    cumulativePnl.push({ ts: p.timestamp, value: +running.toFixed(2) });
  }

  return {
    timestamp: new Date().toISOString(),
    overview: {
      open_positions:    openPos.length,
      closed_positions:  allPos.filter(p => p.closed).length,
      win_rate:          winRate,
      profit_factor:     profFact,
      net_pnl_usd:       +netPnlUsd.toFixed(2),
      total_fees_claimed: allPos.reduce((s, p) => s + (p.total_fees_claimed_usd || 0), 0).toFixed(2),
    },
    positions: openPos.map(p => ({
      ...p,
      age_minutes: p.deployed_at
        ? Math.floor((now - new Date(p.deployed_at).getTime()) / 60_000)
        : 0,
      minutes_out_of_range: p.out_of_range_since
        ? Math.floor((now - new Date(p.out_of_range_since).getTime()) / 60_000)
        : 0,
    })),
    closed_positions: allPos.filter(p => p.closed).slice(-30).reverse(),
    lessons:          (lessons.lessons || []).slice().reverse(),
    performance:      perf.slice(-50).reverse(),
    cumulative_pnl:   cumulativePnl,
    recent_events:    (state.recentEvents || []).slice().reverse(),
    active_strategy:  strats.active,
    strategies:       strats.strategies || {},
  };
}

// ─── MIME types ───────────────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".json": "application/json",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
};

// ─── HTTP server ──────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("X-Content-Type-Options", "nosniff");

  // ── SSE stream ─────────────────────────────────────────────────
  if (url.pathname === "/api/stream") {
    res.writeHead(200, {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
    });
    clients.add(res);
    // Send current data immediately on connect
    res.write(`data: ${JSON.stringify(buildPayload())}\n\n`);
    // Heartbeat to keep connection alive through proxies
    const hb = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 25_000);
    req.on("close", () => { clients.delete(res); clearInterval(hb); });
    return;
  }

  // ── REST snapshot ──────────────────────────────────────────────
  if (url.pathname === "/api/data") {
    const payload = JSON.stringify(buildPayload());
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(payload);
    return;
  }

  // ── Static files ───────────────────────────────────────────────
  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  // Prevent path traversal
  filePath = path.normalize(path.join(PUBLIC, filePath));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "text/plain" });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404); res.end("Not found");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[DASHBOARD] http://localhost:${PORT}  (0.0.0.0:${PORT})`);
});

watchFiles();
