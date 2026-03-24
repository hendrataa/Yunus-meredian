/* Meridian Dashboard – frontend app
 *
 * Connects to /api/stream (SSE). On every push from the server,
 * re-renders all widgets with the new data.
 */

// ── Navigation ────────────────────────────────────────────────────
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`page-${btn.dataset.page}`).classList.add("active");
  });
});

// ── SSE connection ────────────────────────────────────────────────
let es = null;
let retryDelay = 2000;

function connect() {
  es = new EventSource("/api/stream");

  es.onopen = () => {
    retryDelay = 2000;
    setStatus(true);
  };

  es.onmessage = e => {
    try {
      const data = JSON.parse(e.data);
      render(data);
    } catch {}
  };

  es.onerror = () => {
    setStatus(false);
    es.close();
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30_000);
  };
}

function setStatus(live) {
  document.getElementById("status-dot").className   = `dot ${live ? "dot-live" : "dot-offline"}`;
  document.getElementById("status-label").textContent = live ? "LIVE" : "Reconnecting…";
}

// ── Render ────────────────────────────────────────────────────────
function render(d) {
  const ts = new Date(d.timestamp);
  document.getElementById("updated-at").textContent = `Updated ${ts.toLocaleTimeString()}`;

  renderStats(d.overview);
  renderPositions(d.positions || []);
  renderChart(d.cumulative_pnl || []);
  renderHistory(d.performance || []);
  renderLessons(d.lessons || []);
  renderEvents(d.recent_events || []);
}

// ── Stats bar ─────────────────────────────────────────────────────
function renderStats(o) {
  set("s-positions",    o.open_positions ?? "—");
  setColored("s-pnl",  fmt$(o.net_pnl_usd), o.net_pnl_usd);
  set("s-fees",        `$${o.total_fees_claimed ?? "0"}`);
  set("s-winrate",     o.win_rate !== "—" ? `${o.win_rate}%` : "—");
  set("s-profitfactor",o.profit_factor ?? "—");
  set("s-closed",      o.closed_positions ?? "—");
}

// ── Positions ─────────────────────────────────────────────────────
function renderPositions(positions) {
  const grid = document.getElementById("positions-grid");
  if (!positions.length) {
    grid.innerHTML = `<div class="empty-state">No open positions</div>`;
    return;
  }
  grid.innerHTML = positions.map(posCard).join("");
}

function posCard(p) {
  const oor     = !!p.out_of_range_since;
  const strategy= (p.strategy || "bid_ask").replace("_", " ").toUpperCase();
  const stratCls = (p.strategy || "bid_ask") === "spot" ? "spot" : (p.strategy || "") === "curve" ? "curve" : "";

  const binMin = p.bin_range?.min_bin_id ?? p.bin_range?.lower ?? "?";
  const binMax = p.bin_range?.max_bin_id ?? p.bin_range?.upper ?? "?";
  const active = p.active_bin_at_deploy ?? "?";

  // Range bar: clamp active bin position to 0-100%
  let pct = 50;
  if (typeof binMin === "number" && typeof binMax === "number" && typeof active === "number" && binMax !== binMin) {
    pct = Math.min(100, Math.max(0, ((active - binMin) / (binMax - binMin)) * 100));
  }

  const age      = formatAge(p.age_minutes ?? 0);
  const fees     = `$${(p.total_fees_claimed_usd || 0).toFixed(2)}`;
  const shortAddr= (p.position || "").slice(0, 6) + "…" + (p.position || "").slice(-4);
  const oorMins  = p.minutes_out_of_range;

  return `
<div class="pos-card ${oor ? "out-of-range" : ""}">
  <div class="pos-header">
    <span class="pos-name">${esc(p.pool_name || shortAddr)}</span>
    <span class="pos-strategy ${stratCls}">${strategy}</span>
  </div>
  <span class="pos-status ${oor ? "oor" : "in-range"}">${oor ? `OOR ${oorMins}m` : "IN RANGE"}</span>
  <div class="pos-range-bar">
    <div class="pos-range-labels">
      <span>Bin ${binMin}</span>
      <span>Active ${active}</span>
      <span>Bin ${binMax}</span>
    </div>
    <div class="range-track">
      <div class="range-fill" style="width:${pct}%"></div>
      <div class="range-cursor" style="left:${pct}%"></div>
    </div>
  </div>
  <div class="pos-stats">
    <div class="pos-stat-row">
      <span class="pos-stat-label">FEES CLAIMED</span>
      <span class="pos-stat-val green">${fees}</span>
    </div>
    <div class="pos-stat-row">
      <span class="pos-stat-label">AGE</span>
      <span class="pos-stat-val">${age}</span>
    </div>
    <div class="pos-stat-row">
      <span class="pos-stat-label">BIN STEP</span>
      <span class="pos-stat-val">${p.bin_step ?? "—"}</span>
    </div>
    <div class="pos-stat-row">
      <span class="pos-stat-label">REBALANCES</span>
      <span class="pos-stat-val">${p.rebalance_count ?? 0}</span>
    </div>
  </div>
</div>`;
}

// ── PnL Chart ─────────────────────────────────────────────────────
function renderChart(series) {
  const canvas = document.getElementById("pnl-chart");
  const empty  = document.getElementById("chart-empty");

  if (series.length < 2) {
    canvas.style.display = "none";
    empty.style.display  = "flex";
    return;
  }
  canvas.style.display = "block";
  empty.style.display  = "none";

  const ctx   = canvas.getContext("2d");
  const W     = canvas.offsetWidth  || canvas.parentElement.offsetWidth  || 600;
  const H     = canvas.offsetHeight || canvas.parentElement.offsetHeight || 160;
  canvas.width  = W;
  canvas.height = H;

  const vals  = series.map(p => p.value);
  const minV  = Math.min(...vals);
  const maxV  = Math.max(...vals);
  const range = maxV - minV || 1;
  const pad   = { t: 16, r: 8, b: 24, l: 48 };

  const x = i => pad.l + (i / (series.length - 1)) * (W - pad.l - pad.r);
  const y = v => pad.t + (1 - (v - minV) / range) * (H - pad.t - pad.b);

  ctx.clearRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = "#1e2e42";
  ctx.lineWidth = 1;
  [0, 0.25, 0.5, 0.75, 1].forEach(t => {
    const yy = pad.t + t * (H - pad.t - pad.b);
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(W - pad.r, yy); ctx.stroke();
    const v = maxV - t * range;
    ctx.fillStyle = "#4a5c70";
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    ctx.fillText(v >= 0 ? `$${v.toFixed(1)}` : `-$${Math.abs(v).toFixed(1)}`, pad.l - 4, yy + 3);
  });

  // Zero line
  if (minV < 0 && maxV > 0) {
    const yy = y(0);
    ctx.strokeStyle = "#4a5c70";
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(W - pad.r, yy); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Gradient fill
  const endColor = vals[vals.length - 1] >= 0 ? "rgba(16,232,144," : "rgba(240,79,79,";
  const grad = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
  grad.addColorStop(0,   endColor + "0.25)");
  grad.addColorStop(1,   endColor + "0.01)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(x(0), y(vals[0]));
  series.forEach((p, i) => ctx.lineTo(x(i), y(p.value)));
  ctx.lineTo(x(series.length - 1), H - pad.b);
  ctx.lineTo(x(0), H - pad.b);
  ctx.closePath(); ctx.fill();

  // Line
  const lineColor = vals[vals.length - 1] >= 0 ? "#10e890" : "#f04f4f";
  ctx.strokeStyle = lineColor;
  ctx.lineWidth   = 2;
  ctx.lineJoin    = "round";
  ctx.beginPath();
  series.forEach((p, i) => i === 0 ? ctx.moveTo(x(0), y(p.value)) : ctx.lineTo(x(i), y(p.value)));
  ctx.stroke();
}

// ── History table ─────────────────────────────────────────────────
function renderHistory(perf) {
  const tbody = document.getElementById("history-body");
  if (!perf.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted center">No history yet</td></tr>`;
    return;
  }
  tbody.innerHTML = perf.map(p => {
    const pnl    = p.pnl_pct ?? 0;
    const pnlCls = pnl > 0 ? "positive" : pnl < 0 ? "negative" : "";
    const hold   = p.minutes_held ? formatAge(p.minutes_held) : "—";
    const ts     = p.timestamp ? new Date(p.timestamp).toLocaleDateString() : "—";
    return `
<tr>
  <td>${esc(p.pool_name || "—")}</td>
  <td>${esc(p.strategy || "—")}</td>
  <td class="${pnlCls}">${pnl > 0 ? "+" : ""}${pnl.toFixed(2)}%</td>
  <td class="${(p.fees_earned_usd||0) > 0 ? "positive" : ""}">$${(p.fees_earned_usd||0).toFixed(2)}</td>
  <td>${hold}</td>
  <td class="muted">${esc(p.close_reason || "—").slice(0, 40)}</td>
  <td class="muted">${ts}</td>
</tr>`;
  }).join("");
}

// ── Lessons ───────────────────────────────────────────────────────
function renderLessons(lessons) {
  const grid = document.getElementById("lessons-grid");
  if (!lessons.length) {
    grid.innerHTML = `<div class="empty-state">No lessons yet</div>`;
    return;
  }
  grid.innerHTML = lessons.map(l => {
    const role    = (l.role || "GENERAL").toLowerCase();
    const tags    = (l.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join("");
    const pinned  = l.pinned ? "pinned" : "";
    return `
<div class="lesson-card ${pinned}">
  <span class="lesson-role ${role}">${l.role || "GENERAL"}</span>
  <div class="lesson-text">${esc(l.rule || "")}</div>
  <div class="lesson-tags">${tags}</div>
</div>`;
  }).join("");
}

// ── Events ────────────────────────────────────────────────────────
function renderEvents(events) {
  const list = document.getElementById("events-list");
  if (!events.length) {
    list.innerHTML = `<div class="empty-state">No events yet</div>`;
    return;
  }
  list.innerHTML = events.map(e => {
    const time   = e.ts ? new Date(e.ts).toLocaleTimeString() : "—";
    const action = e.action || "event";
    const cls    = ["deploy","close","claim"].includes(action) ? action : "other";
    const body   = e.pool_name
      ? `${esc(e.pool_name)}${e.reason ? ` — ${esc(e.reason)}` : ""}`
      : esc(JSON.stringify(e));
    return `
<div class="event-row">
  <span class="event-time">${time}</span>
  <span class="event-action ${cls}">${action.toUpperCase()}</span>
  <span class="event-body">${body}</span>
</div>`;
  }).join("");
}

// ── Helpers ───────────────────────────────────────────────────────
function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setColored(id, text, num) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.style.color = num > 0 ? "var(--green)" : num < 0 ? "var(--red)" : "";
}

function fmt$(n) {
  if (n == null || isNaN(n)) return "—";
  return (n >= 0 ? "$" : "-$") + Math.abs(n).toFixed(2);
}

function formatAge(mins) {
  if (!mins && mins !== 0) return "—";
  if (mins < 60)   return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Redraw chart on resize ────────────────────────────────────────
let lastData = null;
const origRender = render;
window.render = d => { lastData = d; origRender(d); };
window.addEventListener("resize", () => { if (lastData) renderChart(lastData.cumulative_pnl || []); });

// ── Boot ──────────────────────────────────────────────────────────
connect();
