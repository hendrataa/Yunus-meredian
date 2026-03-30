# Full Screening Cycle Protocol

## Steps

1. **Check Discord signals first** — `node cli.js discord-signals` — if any pending, treat as priority candidates
2. **Check wallet** — `node cli.js balance` — must have deployAmountSol + gasReserve
3. **Read lessons** — `node cli.js lessons` — apply learned rules every cycle
4. **Fetch candidates** — `node cli.js candidates --limit 5`
5. **Cross-reference OKX smart money** — `onchainos signal list --chain solana --wallet-type 1`
6. **Deep research top 2** — token info, holders, narrative, pool detail, active bin, LPer study
7. **Deploy or skip** with clear reasoning

## Hard Rejections (never deploy)
- bot % > 30%
- top10 holder concentration > 60%
- organic score < 60
- fee/TVL ratio < 0.05
- launchpad is blocked

## Strong Signals (favour deployment)
- fee/TVL ratio > 0.15
- organic score > 70
- smart money wallets holding
- net buyers positive in last 1h
- discord signal present

## Ranking Priority
1. Discord signal present
2. fee_active_tvl_ratio (higher = better)
3. organic score
4. smart money wallets
5. bundler % (lower = better)

All commands execute sequentially.
