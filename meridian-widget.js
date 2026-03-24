// Meridian iOS Scriptable Widget
// ─────────────────────────────────────────────────────────────────
// SETUP:
//   1. Install "Scriptable" from the App Store (free)
//   2. Paste this entire file into a new script in Scriptable
//   3. Replace YOUR_VPS_IP below with your actual server IP
//   4. Add a Scriptable widget on your home screen
//   5. Select this script and choose "Medium" or "Large" size
// ─────────────────────────────────────────────────────────────────

const VPS_IP   = "YOUR_VPS_IP";   // ← replace with your VPS IP
const PORT     = "3000";
const API_URL  = `http://${VPS_IP}:${PORT}/api/data`;

// ─── Colour palette ───────────────────────────────────────────────
const C = {
  bg:        new Color("#0d1b2a"),
  bgCard:    new Color("#112233"),
  accent:    new Color("#10e890"),
  red:       new Color("#f04f4f"),
  yellow:    new Color("#f5c542"),
  muted:     new Color("#4a5c70"),
  white:     new Color("#e8f0f8"),
  dimWhite:  new Color("#8fa3b8"),
};

// ─── Font helpers ─────────────────────────────────────────────────
const F = {
  bold:    s => Font.boldSystemFont(s),
  mono:    s => Font.regularRoundedSystemFont(s),
  regular: s => Font.regularSystemFont(s),
};

// ─── Fetch data ───────────────────────────────────────────────────
async function fetchData() {
  try {
    const req = new Request(API_URL);
    req.timeoutInterval = 8;
    return await req.loadJSON();
  } catch (e) {
    return null;
  }
}

// ─── Format helpers ───────────────────────────────────────────────
function fmtUsd(n) {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n).toFixed(2);
  return (n >= 0 ? "+$" : "-$") + abs;
}

function fmtAge(mins) {
  if (!mins && mins !== 0) return "—";
  if (mins < 60)   return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
}

function pnlColor(n) {
  return n > 0 ? C.accent : n < 0 ? C.red : C.dimWhite;
}

// ─── Build widget ─────────────────────────────────────────────────
async function buildWidget(data) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(14, 14, 14, 14);

  if (!data) {
    // ── Error state ──
    const err = w.addText("⚠ Can't reach server");
    err.textColor   = C.red;
    err.font        = F.bold(14);
    const hint = w.addText(`${VPS_IP}:${PORT}`);
    hint.textColor  = C.muted;
    hint.font       = F.regular(11);
    return w;
  }

  const ov  = data.overview  || {};
  const pos = data.positions || [];

  // ── Header row ──────────────────────────────────────────────────
  const header = w.addStack();
  header.layoutHorizontally();
  header.centerAlignContent();

  const title = header.addText("MERIDIAN");
  title.textColor = C.accent;
  title.font      = F.bold(13);

  header.addSpacer();

  const dot  = header.addText("● LIVE");
  dot.textColor = C.accent;
  dot.font      = F.bold(9);

  w.addSpacer(8);

  // ── Overview stats ──────────────────────────────────────────────
  const stats = w.addStack();
  stats.layoutHorizontally();
  stats.spacing = 8;

  function addStatBox(stack, label, value, color) {
    const box = stack.addStack();
    box.layoutVertically();
    box.backgroundColor = C.bgCard;
    box.cornerRadius    = 8;
    box.setPadding(7, 10, 7, 10);

    const vText = box.addText(value);
    vText.textColor = color || C.white;
    vText.font      = F.bold(15);

    const lText = box.addText(label);
    lText.textColor = C.muted;
    lText.font      = F.regular(9);
  }

  addStatBox(stats, "POSITIONS", String(ov.open_positions ?? "—"), C.white);
  stats.addSpacer(4);
  addStatBox(stats, "FEES", `$${ov.total_fees_claimed ?? "0"}`, C.accent);
  stats.addSpacer(4);
  addStatBox(stats, "WIN RATE", ov.win_rate !== "—" ? `${ov.win_rate}%` : "—", C.white);

  w.addSpacer(10);

  // ── Section label ───────────────────────────────────────────────
  const secLabel = w.addText("OPEN POSITIONS");
  secLabel.textColor = C.muted;
  secLabel.font      = F.bold(9);

  w.addSpacer(5);

  // ── Position rows (max 4) ───────────────────────────────────────
  if (pos.length === 0) {
    const none = w.addText("No open positions");
    none.textColor = C.muted;
    none.font      = F.regular(12);
  } else {
    const visible = pos.slice(0, 4);
    for (const p of visible) {
      const card = w.addStack();
      card.layoutVertically();
      card.backgroundColor = C.bgCard;
      card.cornerRadius    = 7;
      card.setPadding(6, 10, 6, 10);

      // ── Top row: name | fees | age | status ──
      const row = card.addStack();
      row.layoutHorizontally();
      row.centerAlignContent();
      row.spacing = 4;

      const name = row.addText(p.pool_name || "Unknown");
      name.textColor = C.white;
      name.font      = F.bold(11);
      name.lineLimit = 1;

      row.addSpacer();

      const fees = row.addText(`$${(p.total_fees_claimed_usd || 0).toFixed(2)}`);
      fees.textColor = C.accent;
      fees.font      = F.mono(10);

      const age = row.addText(fmtAge(p.age_minutes ?? 0));
      age.textColor = C.dimWhite;
      age.font      = F.regular(10);

      const inRange   = !p.out_of_range_since;
      const statusTxt = inRange ? "● IN" : "● OOR";
      const status    = row.addText(statusTxt);
      status.textColor = inRange ? C.accent : C.red;
      status.font      = F.bold(10);

      // ── Range bar ──────────────────────────────────────
      card.addSpacer(4);
      const barRow = card.addStack();
      barRow.layoutHorizontally();
      barRow.spacing = 3;

      // Compute cursor position (0–1)
      const binMin = p.bin_range?.min_bin_id ?? p.bin_range?.lower  ?? null;
      const binMax = p.bin_range?.max_bin_id ?? p.bin_range?.upper  ?? null;
      const active = p.active_bin_at_deploy  ?? null;

      let pct = 0.5;
      if (binMin !== null && binMax !== null && active !== null && binMax !== binMin) {
        pct = Math.min(1, Math.max(0, (active - binMin) / (binMax - binMin)));
      }

      // Draw bar as two segments: left (filled) + right (empty)
      // Total 20 character-wide blocks scaled by pct
      const TOTAL   = 18;
      const filled  = Math.round(pct * TOTAL);
      const empty   = TOTAL - filled;
      const barColor = inRange ? C.accent : C.red;

      const leftBar = barRow.addText("▮".repeat(Math.max(1, filled)));
      leftBar.textColor = barColor;
      leftBar.font      = Font.boldSystemFont(7);

      const rightBar = barRow.addText("▯".repeat(Math.max(1, empty)));
      rightBar.textColor = C.muted;
      rightBar.font      = Font.boldSystemFont(7);

      // Bin labels
      barRow.addSpacer();
      const binLabel = barRow.addText(
        binMin !== null ? `${binMin}–${binMax}` : "no range"
      );
      binLabel.textColor = C.muted;
      binLabel.font      = F.regular(8);

      w.addSpacer(4);
    }

    if (pos.length > 4) {
      const more = w.addText(`+${pos.length - 4} more positions`);
      more.textColor = C.muted;
      more.font      = F.regular(10);
    }
  }

  w.addSpacer();

  // ── Footer ──────────────────────────────────────────────────────
  const footer = w.addStack();
  footer.layoutHorizontally();

  const updated = footer.addText(`Updated ${new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}`);
  updated.textColor = C.muted;
  updated.font      = F.regular(9);

  footer.addSpacer();

  const closed = footer.addText(`${ov.closed_positions ?? 0} closed`);
  closed.textColor = C.muted;
  closed.font      = F.regular(9);

  return w;
}

// ─── Run ──────────────────────────────────────────────────────────
const data   = await fetchData();
const widget = await buildWidget(data);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  // Preview in app
  widget.presentMedium();
}

Script.complete();
