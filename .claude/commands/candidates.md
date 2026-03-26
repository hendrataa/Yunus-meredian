---
description: Fetch top pool candidates and cross-reference OKX smart money signals
argument-hint: [limit]
---
Get pool candidates and evaluate with smart money signals:

1. Fetch top candidates:
```
!`node cli.js candidates --limit 5`
```

2. Cross-reference against OKX smart money signals on Solana:
```
!`onchainos signal list --chain solana --wallet-type 1`
```

3. Check OKX trending tokens for context:
```
!`onchainos token trending --chain solana`
```

Evaluate each candidate on:
- fee/TVL ratio (higher is better, aim for >0.1)
- organic score (min 60, prefer 70+)
- bot % (reject if >30%)
- top10 holder concentration (flag if >60%)
- price direction (favor stable or uptrending)
- volume/TVL ratio

If a candidate token appears in OKX smart money signals with soldRatioPercent < 20%, that's a strong conviction signal.
Skip if smart money has already exited (soldRatioPercent > 80%).

Provide ranked deployment recommendations with reasoning.
