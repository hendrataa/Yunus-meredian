/**
 * copytrade-watcher.js
 *
 * Real-time WebSocket watcher that mirrors DLMM LP positions from target wallets.
 * Uses onLogs with "processed" commitment — fires the moment a TX lands at the
 * validator, before it is confirmed, for minimum latency.
 *
 * Flow:
 *   1. Subscribe to onLogs for every wallet in smart-wallets.json
 *   2. On any log mentioning "InitializePosition" → fetch the TX
 *   3. Extract lb_pair (pool) address from the DLMM instruction accounts
 *   4. Call executeTool("deploy_position") immediately — no filters
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { listSmartWallets } from "./smart-wallets.js";
import { executeTool } from "./tools/executor.js";
import { getWalletBalances } from "./tools/wallet.js";
import { computeDeployAmount } from "./config.js";
import { emit } from "./notifier.js";
import { log } from "./logger.js";
import { config } from "./config.js";

const DLMM_PROGRAM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";

// Signatures we've already acted on — prevents duplicate fires
const _seen = new Set();

// wallet address → WebSocket subscription ID
const _subs = new Map();

let _conn = null;
let _enabled = false;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Start watching all smart wallets for DLMM position opens.
 * Safe to call multiple times — re-subscribes cleanly.
 */
export function startCopytradeWatcher() {
  if (!config.copytrade.enabled) {
    log("copytrade", "Disabled in config (copytrade.enabled = false). Set it to true to activate.");
    return;
  }

  const { wallets } = listSmartWallets();
  if (!wallets.length) {
    log("copytrade", "No wallets configured — add wallets via add_smart_wallet then restart.");
    return;
  }

  // Build WebSocket endpoint from RPC URL
  const rpcUrl = process.env.RPC_URL || "";
  const wsUrl = rpcUrl.replace(/^https?:\/\//, (m) => (m === "https://" ? "wss://" : "ws://"));

  _conn = new Connection(rpcUrl, {
    commitment: "processed",
    wsEndpoint: wsUrl,
  });

  _enabled = true;

  for (const wallet of wallets) {
    _subscribe(wallet);
  }

  log("copytrade", `Watching ${wallets.length} wallet(s) for DLMM deploys`);
}

/**
 * Stop all subscriptions.
 */
export function stopCopytradeWatcher() {
  _enabled = false;
  if (!_conn) return;
  for (const [, subId] of _subs) {
    _conn.removeOnLogsListener(subId).catch(() => {});
  }
  _subs.clear();
  log("copytrade", "Watcher stopped");
}

/**
 * Add a single wallet to the watch list at runtime (no restart needed).
 */
export function addCopytradeTarget(wallet) {
  if (!_conn || !_enabled) return;
  _subscribe(wallet);
  log("copytrade", `Added live watch: ${wallet.name || wallet.address.slice(0, 8)}`);
}

// ─── Internal ────────────────────────────────────────────────────────────────

function _subscribe(wallet) {
  if (_subs.has(wallet.address)) return; // already subscribed

  let pubkey;
  try {
    pubkey = new PublicKey(wallet.address);
  } catch {
    log("copytrade_warn", `Invalid address for ${wallet.name}: ${wallet.address}`);
    return;
  }

  const label = wallet.name || wallet.address.slice(0, 8);

  const subId = _conn.onLogs(
    pubkey,
    async ({ signature, logs, err }) => {
      if (err) return;
      if (_seen.has(signature)) return;

      // Fast pre-filter: check if any log line mentions DLMM position init
      const isLPOpen = logs.some(
        (l) =>
          l.includes("InitializePositionAndAddLiquidity") ||
          l.includes("initializePositionAndAddLiquidity")
      );
      if (!isLPOpen) return;

      _seen.add(signature);
      _trimSeen();

      log("copytrade", `LP open detected — ${label} | sig: ${signature.slice(0, 20)}...`);

      try {
        // Fetch the full TX — retry up to 4 times in case it hasn't propagated yet
        const tx = await _fetchTx(signature);
        if (!tx) {
          log("copytrade_warn", `TX not available after retries: ${signature.slice(0, 20)}`);
          return;
        }

        const poolAddress = _extractPool(tx);
        if (!poolAddress) {
          log("copytrade_warn", `Could not extract pool from ${signature.slice(0, 20)}`);
          return;
        }

        // Compute deploy amount from current wallet balance
        const balances = await getWalletBalances({}).catch(() => null);
        const amountSol =
          config.copytrade.amountSol ??
          (balances ? computeDeployAmount(balances.sol) : config.management.deployAmountSol);

        log("copytrade", `Mirroring pool ${poolAddress.slice(0, 8)} from ${label} — ${amountSol} SOL`);

        emit("copytrade_detected", {
          source: label,
          pool: poolAddress,
          amountSol,
          sig: signature,
        });

        const result = await executeTool("deploy_position", {
          pool_address: poolAddress,
          amount_y: amountSol,
          amount_x: 0,
        });

        if (result?.success) {
          log("copytrade", `Mirrored ✓ position: ${result.position?.slice(0, 8)} tx: ${result.txs?.[0]?.slice(0, 20)}`);
        } else {
          log("copytrade_warn", `Mirror deploy blocked/failed: ${result?.reason || result?.error || "unknown"}`);
        }
      } catch (e) {
        log("copytrade_error", `Error processing ${signature.slice(0, 20)}: ${e.message}`);
      }
    },
    "processed"
  );

  _subs.set(wallet.address, subId);
  log("copytrade", `Subscribed to ${label}`);
}

/**
 * Fetch a transaction with retries (up to 4x, 400 ms apart).
 */
async function _fetchTx(signature) {
  for (let i = 0; i < 4; i++) {
    const tx = await _conn.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    }).catch(() => null);
    if (tx) return tx;
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return null;
}

/**
 * Extract the lb_pair (pool) address from a DLMM transaction.
 *
 * In DLMM's initializePositionAndAddLiquidityByStrategy instruction,
 * the account layout is:
 *   [0] position   (new keypair)
 *   [1] lb_pair    ← this is the pool address we want
 *   [2] position_bin_array_lower
 *   ...
 */
function _extractPool(tx) {
  const message = tx.transaction.message;

  // staticAccountKeys works for both legacy Message and MessageV0
  const staticKeys = message.staticAccountKeys || message.accountKeys || [];

  // compiledInstructions (v0) or instructions (legacy)
  const ixs = message.compiledInstructions || message.instructions || [];

  for (const ix of ixs) {
    const programIdx = ix.programIdIndex;
    const programKey = staticKeys[programIdx]?.toString();
    if (programKey !== DLMM_PROGRAM) continue;

    // accountKeyIndexes (v0) or accounts (legacy) — both are arrays of u8 indices
    const accounts = ix.accountKeyIndexes || ix.accounts || [];
    const lbPairIdx = accounts[1]; // lb_pair is always at slot 1
    if (lbPairIdx != null) {
      return staticKeys[lbPairIdx]?.toString() ?? null;
    }
  }
  return null;
}

/**
 * Keep the _seen set from growing unbounded.
 * Drop oldest half once it exceeds 1000 entries.
 */
function _trimSeen() {
  if (_seen.size < 1000) return;
  const iter = _seen.values();
  for (let i = 0; i < 500; i++) _seen.delete(iter.next().value);
}
