# Position Management Cycle

Run a complete management cycle to monitor and act on open positions.

## Process

1. **List positions** — `node cli.js positions`
2. **Get PnL for each** — `node cli.js pnl <ADDRESS>` (includes strategy and instruction fields)
3. **Apply strategy rules** based on returned strategy type
4. **Execute instruction overrides** if present (highest priority — always follow these)

## Strategy-Specific Rules

**custom_ratio_spot:**
- Close when out-of-range upside with >10% profit (lock gains)
- Close after extended downside OOR without volume recovery
- Claim fees >$5 in-range
- Close when total return (fees + PnL) reaches 10%

**fee_compounding:**
- Claim fees >$5 and reinvest back into liquidity
- Close normally when out-of-range

**single_sided_reseed:**
- Do NOT close during downside OOR if token maintains volume
- Instead: withdraw and re-seed at new price with "bid_ask" strategy

**partial_harvest:**
- Extract 50% of position when total returns reach 10%
- Let remainder continue

**multi_layer:**
- Manage each sub-position independently using custom_ratio_spot rules

## Global Override Conditions (apply regardless of strategy)

Close immediately when:
- Out-of-range upside with PnL > 10%
- Losses below -25% without recovery
- Position > 2 hours old while out-of-range downside

## Important

All commands execute sequentially via Bash — never parallel or background execution.
