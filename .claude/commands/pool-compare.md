---
description: Compare all Meteora DLMM pools for a token pair by APR, fee/TVL ratio, and volume
argument-hint: [token_symbol_or_mint]
---
Compare all available Meteora DLMM pools for this token pair:

1. Search pools by token:
```
!`curl -s "https://dlmm.datapi.meteora.ag/pools/groups?query=$ARGUMENTS&sort_by=fee_tvl_ratio&page_size=10"`
```

2. Get protocol-wide stats for context:
```
!`curl -s "https://dlmm.datapi.meteora.ag/stats/protocol_metrics"`
```

For each pool show: bin_step, trade_volume_24h, fees_24h, fee_tvl_ratio, farm_apr, TVL.
Pick the pool with the best fee_tvl_ratio at a bin_step appropriate for the pair's volatility.
