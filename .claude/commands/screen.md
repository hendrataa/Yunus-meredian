# Full Screening Cycle Protocol

Run a complete screening cycle to evaluate pool candidates and deploy if conditions are met.

## Process

1. **Check Discord signals first** — run `node cli.js discord-signals` and prioritize any pending signals
2. **Check wallet balance** — run `node cli.js balance` and verify SOL >= deployAmountSol + gasReserve
3. **Read lessons** — run `node cli.js lessons` to load learned rules before evaluating
4. **Fetch candidates** — run `node cli.js candidates --limit 5`
5. **Cross-reference OKX smart money** — run `onchainos signal list --chain solana --wallet-type 1`
6. **Deep research top 2 candidates** — for each, gather:
   - `node cli.js token-info --query <mint>`
   - `node cli.js token-holders --mint <mint>`
   - `node cli.js token-narrative --mint <mint>`
   - `node cli.js pool-detail --pool <addr>`
   - `node cli.js active-bin --pool <addr>`
   - `node cli.js study --pool <addr>`
   - `node cli.js pool-memory --pool <addr>`

## Hard Rejection Criteria (never deploy)

- bot % > 30%
- top10 holder concentration > 60%
- organic score < 60
- launchpad is blocked
- fee/TVL ratio < 0.05

## Ranking Priority

1. Smart money signals (OKX wallet-type 1 with soldRatioPercent < 20%)
2. fee_active_tvl_ratio (higher = better)
3. Organic score
4. LP win rate from pool memory
5. Bundler % (lower = better)

## New Token Rule

If token_age_minutes <= 30 (brand new token), favor 2-sided Spot strategy to support price discovery.

## Important

All commands execute sequentially — never parallel or background execution.
