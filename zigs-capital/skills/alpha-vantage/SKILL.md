---
name: alpha-vantage
description: >
  Fetch structured financial data from the Alpha Vantage API. Use for price
  history, fundamentals, earnings, options chains, crypto, insider activity,
  and market context. Always check Neon cache before making a live request.
allowed-tools:
  - Bash
  - Read
  - Grep
---

# Alpha Vantage Skill

Structured market-data layer for Zigs Capital. This is the primary source for equities, end-of-day options chains, and crypto across both the research desk and the trading desk.

## Authentication

Requires `ALPHA_VANTAGE_API_KEY`. Base URL: `https://www.alphavantage.co/query`

## Budget Awareness

Alpha Vantage premium tier: **150 requests/minute**, no daily cap.

Use the same operating rule on both desks:

1. Check Neon `tool_cache` before every request.
2. Use cached data if it is still fresh.
3. Only make a live request on cache miss or expiry.

**Budget tracking**

- Research desk runs increment counters on `research_runs`
- Trading desk runs increment counters on `desk_runs`
- Every live Alpha Vantage request increments `av_requests_used`
- Every cache hit increments `av_cache_hits`

Prefer one broader time-series request plus local computation over several narrow endpoint calls.

## Core Endpoints

### Price Data

**TIME_SERIES_DAILY** — Daily OHLCV. Default workhorse for longer-horizon context.
```
?function=TIME_SERIES_DAILY&symbol={TICKER}&outputsize=full&apikey={KEY}
```
Cache TTL: 4 hours during market hours, 12 hours after close

**GLOBAL_QUOTE** — Current/latest price snapshot.
```
?function=GLOBAL_QUOTE&symbol={TICKER}&apikey={KEY}
```
Cache TTL: 5 minutes

**TIME_SERIES_INTRADAY** — Intraday OHLCV for equities.
```
?function=TIME_SERIES_INTRADAY&symbol={TICKER}&interval=5min&outputsize=compact&apikey={KEY}
```
Use `5min`, `15min`, `30min`, or `60min` based on the setup.
Cache TTL: 5 minutes

### Options Data

**HISTORICAL_OPTIONS** — End-of-day options chain snapshots with IV and Greeks.
```
?function=HISTORICAL_OPTIONS&symbol={TICKER}&apikey={KEY}
```

Notes:
- End-of-day only. Do not treat this as live flow or live chain data.
- Suitable for weeklies+ and swing context.
- Not suitable for 0DTE or intraminute options decisions.

Cache TTL: 60 minutes (EOD snapshot cadence)

### Crypto Data

**CRYPTO_INTRADAY** — Intraday crypto bars.
```
?function=CRYPTO_INTRADAY&symbol={SYMBOL}&market=USD&interval=5min&apikey={KEY}
```
Examples: BTC/USD, ETH/USD
Cache TTL: 5 minutes

### Fundamentals

**OVERVIEW** — Company profile, sector, market cap, valuation, analyst target.
```
?function=OVERVIEW&symbol={TICKER}&apikey={KEY}
```
Cache TTL: 24 hours

**INCOME_STATEMENT**
```
?function=INCOME_STATEMENT&symbol={TICKER}&apikey={KEY}
```
Cache TTL: 24 hours

**BALANCE_SHEET**
```
?function=BALANCE_SHEET&symbol={TICKER}&apikey={KEY}
```
Cache TTL: 24 hours

**CASH_FLOW**
```
?function=CASH_FLOW&symbol={TICKER}&apikey={KEY}
```
Cache TTL: 24 hours

**EARNINGS**
```
?function=EARNINGS&symbol={TICKER}&apikey={KEY}
```
Cache TTL: 24 hours

### Sentiment and Ownership

**NEWS_SENTIMENT**
```
?function=NEWS_SENTIMENT&tickers={TICKER}&apikey={KEY}
```
Cache TTL: 1 hour

**INSIDER_TRANSACTIONS**
```
?function=INSIDER_TRANSACTIONS&symbol={TICKER}&apikey={KEY}
```
Cache TTL: 24 hours

**INSTITUTIONAL_OWNERSHIP**
```
?function=INSTITUTIONAL_OWNERSHIP&symbol={TICKER}&apikey={KEY}
```
Cache TTL: 24 hours

### Market Context

**TOP_GAINERS_LOSERS**
```
?function=TOP_GAINERS_LOSERS&apikey={KEY}
```
Cache TTL: 1 hour

**VIX proxy**

Alpha Vantage does not provide a guaranteed clean VIX product feed. Use `GLOBAL_QUOTE` on a VIX symbol when available or fall back to an alternate source and label it as such.

## Cache Protocol

### Cache Key Construction

Generate a deterministic key:
```
sha256("alpha_vantage|{endpoint}|{sorted_params}")
```

Example:
```
sha256("alpha_vantage|OVERVIEW|symbol=AAPL")
```

### Cache Check
```sql
SELECT response_data, fetched_at, expires_at
FROM tool_cache
WHERE cache_key = $1
  AND expires_at > NOW();
```

### Cache Write
```sql
INSERT INTO tool_cache (cache_key, tool, endpoint, symbol, request_params, response_data, expires_at)
VALUES ($1, 'alpha_vantage', $2, $3, $4, $5, NOW() + INTERVAL '$TTL')
ON CONFLICT (cache_key) DO UPDATE
SET response_data = EXCLUDED.response_data,
    fetched_at = NOW(),
    expires_at = EXCLUDED.expires_at;
```

### TTL Reference

| Data Type | TTL | Notes |
|-----------|-----|-------|
| GLOBAL_QUOTE | 5 min | Near-real-time price snapshot |
| TIME_SERIES_INTRADAY | 5 min | Equity intraday freshness |
| CRYPTO_INTRADAY | 5 min | 24/7 crypto bars |
| HISTORICAL_OPTIONS | 60 min | EOD chain snapshot |
| TIME_SERIES_DAILY | 4-12 hours | Stable after close |
| OVERVIEW | 24 hours | Company metadata |
| Financial statements | 24 hours | Quarterly cadence |
| EARNINGS | 24 hours | Quarterly cadence |
| NEWS_SENTIMENT | 1 hour | Narrative shifts faster |
| INSIDER / INSTITUTIONAL | 24 hours | Filing cadence |
| TOP_GAINERS_LOSERS | 1 hour | Market context |

## Neon Output

Normalize Alpha Vantage output into the table appropriate for the active run:

- `research_findings` for research desk runs
- `desk_findings` for trading desk runs

Examples:

### Research desk finding
```sql
INSERT INTO research_findings (
    research_run_id, symbol, analyst_role, agent_id,
    finding_type, title, body, confidence, sentiment,
    is_material, structured_data, data_sources
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);
```

### Trading desk finding
```sql
INSERT INTO desk_findings (
    desk_run_id, symbol, analyst_role, agent_id,
    finding_type, title, body, confidence, direction,
    structured_data, data_sources
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);
```

`structured_data` should contain the metrics, levels, or chain context agents will query later. `body` should hold the narrative explanation.

## Error Handling

- **Rate limit / premium access issue:** Stop making requests and log the failure. Do not retry in a loop.
- **Invalid API key:** Fail loudly. Do not cache the error.
- **Malformed or empty response:** Treat as a failed fetch and skip cache write.
- **Options endpoint misuse:** If the setup requires live chain behavior or 0DTE context, state that Alpha Vantage cannot provide it.

## What This Skill Does NOT Do

- It does not interpret the data. Agents decide what the numbers mean.
- It does not provide live options flow, dark-pool, or sweep data.
- It does not execute trades or publish to Notion.
