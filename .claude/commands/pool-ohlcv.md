---
description: Fetch price and volume history for a Meteora pool
argument-hint: [pool_address]
---
Fetch OHLCV and volume history for this pool:

1. Price candles (1h, last 24 periods):
```
!`curl -s "https://dlmm.datapi.meteora.ag/pools/$ARGUMENTS/ohlcv?timeframe=1h&limit=24"`
```

2. Volume history (1h):
```
!`curl -s "https://dlmm.datapi.meteora.ag/pools/$ARGUMENTS/volume/history?timeframe=1h"`
```

Summarise: price direction, volume trend, and entry signal assessment.
