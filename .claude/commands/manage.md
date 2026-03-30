# Position Management Cycle

## Steps

1. `node cli.js positions` — list all open positions
2. `node cli.js pnl ADDRESS` — get PnL for each (includes strategy + instruction fields)
3. Apply strategy-specific rules
4. Execute instruction overrides (highest priority)

## Strategy Rules

**custom_ratio_spot:** Close when OOR upside with >10% profit. Claim fees >$5 in-range.

**fee_compounding:** Reinvest claimed fees (>$5) back into liquidity. Close normally when OOR.

**single_sided_reseed:** Don't close on downside OOR if volume holds — withdraw and re-seed at new price with bid_ask.

**partial_harvest:** Extract 50% when total returns reach 10%, let remainder run.

**multi_layer:** Manage each sub-position independently using custom_ratio_spot rules.

## Global Override (any strategy)
Close immediately when:
- OOR upside with PnL > 10%
- Loss < -25% without recovery
- Position > 2h old while OOR downside

Execute all commands sequentially.
