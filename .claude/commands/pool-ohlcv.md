---
description: Fetch price and volume history for a Meteora pool
argument-hint: [pool_address]
---
Fetch price and volume history for this pool:

1. Get OHLCV candles (1h timeframe, last 24 periods):
```
!`curl -s "https://dlmm.datapi.meteora.ag/pools/$ARGUMENTS/ohlcv?timeframe=1h"`
```

2. Get volume history:
```
!`curl -s "https://dlmm.datapi.meteora.ag/pools/$ARGUMENTS/volume/history?timeframe=1h"`
```

Analyse:
- Price direction (uptrend, downtrend, consolidation)
- Volume movement (increasing, decreasing, anomalous spikes)
- Volume behaviour (steady vs erratic bursts)
- Entry signal (rising volume + stable/rising price = favourable; diminishing volume = caution)
