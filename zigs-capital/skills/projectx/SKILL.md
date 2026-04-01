---
name: projectx
description: >
  Fetch futures market data from the ProjectX API. Use for historical bars,
  real-time quotes, Level 2 order book, and built-in technical indicators.
  Covers CME, CBOT, NYMEX, and COMEX listed products.
allowed-tools:
  - Bash
  - Read
  - Grep
---

# ProjectX Skill

Futures data layer for Zigs Capital's trading desk. ProjectX provides real-time and historical futures data via the `project-x-py` Python SDK (v3.5.9+, async, Python 3.12+).

## Authentication

Requires `PROJECTX_API_KEY` environment variable.

The SDK uses an async session model via the `TradingSuite` class:

```python
from projectx import TradingSuite
import asyncio

async def main():
    suite = TradingSuite(api_key=os.environ['PROJECTX_API_KEY'])
    # ... use suite for data access
    await suite.close()

asyncio.run(main())
```

## Instrument Coverage

| Symbol | Product | Exchange | Point Value |
|--------|---------|----------|-------------|
| ES | S&P 500 E-mini | CME | $50/point |
| NQ | Nasdaq 100 E-mini | CME | $20/point |
| YM | Dow E-mini | CBOT | $5/point |
| CL | Crude Oil | NYMEX | $1,000/point |
| GC | Gold | COMEX | $100/point |
| SI | Silver | COMEX | $5,000/point |
| ZB | 30-Year Treasury | CBOT | $1,000/point |
| ZN | 10-Year Treasury | CBOT | $1,000/point |

Any CME Group, CBOT, NYMEX, or COMEX listed product is accessible.

### Contract Naming

Futures contracts use standard month codes:

| Code | Month | Code | Month |
|------|-------|------|-------|
| F | January | N | July |
| G | February | Q | August |
| H | March | U | September |
| J | April | V | October |
| K | May | X | November |
| M | June | Z | December |

Example: `ESM6` = E-mini S&P 500, June 2026. `CLQ6` = Crude Oil, August 2026.

Always use the front-month contract unless the analysis specifically requires a back month (term structure analysis, roll studies).

## Core Data Access Patterns

### Historical Bars

```python
bars = await suite.get_historical_bars(
    symbol="ES",
    timeframe="1h",       # 1m, 5m, 15m, 30m, 1h, 4h, 1d
    start="2026-03-01",
    end="2026-03-30"
)
# Returns: list of {timestamp, open, high, low, close, volume}
```

### Real-Time Quote

```python
quote = await suite.get_quote("ES")
# Returns: {bid, ask, last, volume, timestamp}
```

Note: Real-time data is only meaningful within a heartbeat execution window. Between heartbeats, use historical bars with the most recent timestamp.

### Level 2 Order Book

```python
depth = await suite.get_market_depth("ES")
# Returns: {bids: [{price, size}], asks: [{price, size}]}
```

Use for:
- Entry/exit level validation (is there liquidity at the proposed level?)
- Support/resistance confirmation (large resting orders)
- Market microstructure context

### Built-In Technical Indicators

ProjectX provides 59+ indicators computed server-side:

```python
rsi = await suite.calculate_indicator("ES", "RSI", {"period": 14})
sma = await suite.calculate_indicator("ES", "SMA", {"period": 50})
macd = await suite.calculate_indicator("ES", "MACD", {"fast": 12, "slow": 26, "signal": 9})
```

Available indicators include: RSI, SMA, EMA, MACD, Bollinger Bands, ATR, ADX, Stochastic, CCI, Williams %R, Fair Value Gaps, Order Blocks, and more.

**Prefer built-in indicators** over computing locally when using ProjectX data. Each indicator call is a single request vs. pulling raw bars and computing.

### Session Filtering

Futures trade in multiple sessions. Filter by session when relevant:

```python
# Regular Trading Hours only (RTH)
bars_rth = await suite.get_historical_bars(
    symbol="ES",
    timeframe="1h",
    start="2026-03-30",
    end="2026-03-30",
    session="rth"     # rth = 9:30-16:00 ET for ES
)

# Extended/Electronic Trading Hours (ETH/Globex)
bars_eth = await suite.get_historical_bars(
    symbol="ES",
    timeframe="1h",
    start="2026-03-30",
    end="2026-03-30",
    session="eth"
)
```

RTH volume profiles are more meaningful for support/resistance. ETH can show gap levels and overnight sentiment.

## Cache Protocol

Before every API call, check Neon `tool_cache`:

### Cache Key Construction

```
sha256("projectx|{endpoint}|{sorted_params}")
```

Example: `sha256("projectx|historical_bars|session=rth&symbol=ES&timeframe=1h")`

### Cache Check

```sql
SELECT response_data, fetched_at, expires_at
FROM tool_cache
WHERE cache_key = $1 AND expires_at > NOW();
```

If a row is returned, use `response_data`. Do not call the API.

### Cache Write

```sql
INSERT INTO tool_cache (cache_key, tool, endpoint, symbol, request_params, response_data, expires_at)
VALUES ($1, 'projectx', $2, $3, $4, $5, NOW() + INTERVAL '$TTL')
ON CONFLICT (cache_key) DO UPDATE
SET response_data = EXCLUDED.response_data,
    fetched_at = NOW(),
    expires_at = EXCLUDED.expires_at;
```

### TTL Reference

| Data Type | TTL | Rationale |
|-----------|-----|-----------|
| Real-time quote | 1 min | Near-real-time price |
| Intraday bars (1m-30m) | 5 min | Intraday freshness |
| Hourly+ bars | 4 hours | Stable after session close |
| Daily bars | 12 hours | Stable end-of-day data |
| Level 2 snapshot | 1 min | Order book changes rapidly |
| Built-in indicators (intraday) | 5 min | Tied to bar freshness |
| Built-in indicators (daily) | 4 hours | Daily recalculation |

### Budget Tracking

After each live API request, increment the ProjectX counter:

```sql
UPDATE desk_runs
SET px_requests_used = px_requests_used + 1
WHERE id = $run_id;
```

After each cache hit:

```sql
UPDATE desk_runs
SET av_cache_hits = av_cache_hits + 1
WHERE id = $run_id;
```

## Contract Rollover Awareness

Futures contracts expire. The front-month contract rolls quarterly (ES, NQ) or monthly (CL, GC).

**Roll schedule awareness:**
- ES/NQ/YM: Third Friday of March, June, September, December
- CL: ~20th of the month prior to delivery
- GC/SI: Varies by contract month

**During roll periods (5 business days before expiry):**
- Volume shifts from front month to back month
- Spread between contracts narrows
- Technical analysis should use the back-month contract or continuous-contract data
- Alert the Head Trader if a signal is on a contract approaching roll

## Known Limitations

- **Third-party wind-down risk:** ProjectX has been winding down some third-party service partnerships. Monitor access stability. If ProjectX becomes unavailable, futures data alternatives include Databento and CQG direct.
- **Heartbeat-bound streaming:** WebSocket streaming only works within a heartbeat window. Between heartbeats, use historical bar snapshots.
- **No options on futures:** ProjectX covers futures only. Options-on-futures data would require a separate source.

## What This Skill Does NOT Do

- Does not interpret data or make trading decisions. It fetches, caches, and provides access patterns.
- Does not cover equities, crypto, or options. Those use Alpha Vantage.
- Does not execute trades or manage positions.
- Does not call Alpha Vantage, Exa, LuxAlgo, or Notion.
