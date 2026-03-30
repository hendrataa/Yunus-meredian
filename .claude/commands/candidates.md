---
description: Fetch top pool candidates and cross-reference OKX smart money signals
---
1. Get pool candidates (limit 5):
```
!`node cli.js candidates --limit 5`
```

2. Cross-reference OKX smart money signals on Solana:
```
!`onchainos signal list --chain solana --wallet-type 1`
```

3. Check OKX trending tokens:
```
!`onchainos token trending --chain solana`
```

Rank candidates by:
- fee/TVL ratio (higher = better, aim for >0.1)
- organic score (min 60, prefer 70+)
- OKX smart money conviction (soldRatioPercent <20% = strong buy signal, >80% = skip)
- bot % (reject if >30%)
- top10 holders (flag if >60%)

Give ranked deployment recommendations with reasoning.
