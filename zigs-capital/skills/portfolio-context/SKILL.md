---
name: portfolio-context
description: >
  Query portfolio state from Neon across both desks — research holdings,
  active trade signals, open intraday positions, exposure, and performance.
  Used by the CEO and desk risk roles for position-aware decisions.
allowed-tools:
  - Bash
---

# Portfolio Context Skill

Provides cross-desk portfolio awareness for Zigs Capital. This skill is read-only. It helps the CEO and risk agents understand what is already in the book across both the research desk and the advisory-only trading desk.

## Connection

Uses `DATABASE_URL`.

## Core Queries

### Research Desk Open Positions
```sql
SELECT
    h.symbol,
    h.instrument_type,
    h.quantity,
    h.entry_price,
    h.entry_date,
    h.strike_price,
    h.expiration_date,
    h.broker,
    h.account_label,
    t.title AS thesis_title,
    t.conviction,
    t.price_target_bull,
    t.price_target_base,
    t.price_target_bear,
    tk.sector,
    tk.industry
FROM holdings h
LEFT JOIN theses t ON h.thesis_id = t.id
LEFT JOIN tickers tk ON h.symbol = tk.symbol
WHERE h.status = 'open'
ORDER BY h.entry_date DESC;
```

### Trading Desk Open Positions
```sql
SELECT
    ip.symbol,
    ip.direction,
    ip.instrument_type,
    ip.entry_price,
    ip.entry_time,
    ip.size,
    ip.stop_price,
    ip.target_price,
    ip.contract_spec,
    ts.signal_type,
    ts.confluence_score,
    ts.fast_path,
    tk.sector,
    tk.industry
FROM v_open_intraday ip
LEFT JOIN tickers tk ON ip.symbol = tk.symbol
LEFT JOIN trade_signals ts ON ip.signal_id = ts.id
ORDER BY ip.entry_time DESC;
```

### Active Trading Signals
```sql
SELECT
    symbol,
    direction,
    instrument_type,
    signal_type,
    entry_price,
    stop_price,
    target_1,
    confidence,
    confluence_score,
    fast_path,
    expires_at,
    created_at
FROM v_active_signals
ORDER BY created_at DESC;
```

### Combined Open Exposure Across Both Desks
```sql
WITH research_exposure AS (
    SELECT
        'research' AS source_desk,
        h.symbol,
        CASE
            WHEN h.instrument_type IN ('shares', 'leap_call', 'call') THEN 'long'
            WHEN h.instrument_type IN ('leap_put', 'put') THEN 'short'
        END AS direction,
        tk.sector,
        (h.quantity * h.entry_price) AS notional_exposure
    FROM holdings h
    LEFT JOIN tickers tk ON h.symbol = tk.symbol
    WHERE h.status = 'open'
),
trading_exposure AS (
    SELECT
        'trading' AS source_desk,
        ip.symbol,
        ip.direction,
        tk.sector,
        CASE
            WHEN ip.instrument_type = 'future'
                THEN COALESCE((ip.contract_spec->>'margin_required')::numeric, 0) * ip.size
            ELSE ip.entry_price * ip.size
        END AS notional_exposure
    FROM intraday_positions ip
    LEFT JOIN tickers tk ON ip.symbol = tk.symbol
    WHERE ip.status = 'open'
)
SELECT *
FROM (
    SELECT * FROM research_exposure
    UNION ALL
    SELECT * FROM trading_exposure
) combined
ORDER BY notional_exposure DESC;
```

### Sector Concentration Across Both Desks
```sql
WITH combined AS (
    SELECT tk.sector, (h.quantity * h.entry_price) AS exposure
    FROM holdings h
    LEFT JOIN tickers tk ON h.symbol = tk.symbol
    WHERE h.status = 'open'
    UNION ALL
    SELECT
        tk.sector,
        CASE
            WHEN ip.instrument_type = 'future'
                THEN COALESCE((ip.contract_spec->>'margin_required')::numeric, 0) * ip.size
            ELSE ip.entry_price * ip.size
        END AS exposure
    FROM intraday_positions ip
    LEFT JOIN tickers tk ON ip.symbol = tk.symbol
    WHERE ip.status = 'open'
)
SELECT sector, COUNT(*) AS positions, SUM(exposure) AS total_exposure
FROM combined
GROUP BY sector
ORDER BY total_exposure DESC NULLS LAST;
```

### Futures Exposure and Margin Context
```sql
SELECT
    symbol,
    direction,
    size,
    contract_spec->>'product' AS product,
    contract_spec->>'expiry' AS contract_expiry,
    (contract_spec->>'margin_required')::numeric AS margin_required_per_contract,
    ((contract_spec->>'margin_required')::numeric * size) AS total_margin_exposure,
    (contract_spec->>'point_value')::numeric AS point_value,
    entry_price,
    stop_price,
    ABS(entry_price - stop_price) * (contract_spec->>'point_value')::numeric * size AS stop_risk_dollars
FROM intraday_positions
WHERE status = 'open'
  AND instrument_type = 'future'
ORDER BY entry_time DESC;
```

### Portfolio Heat From Reported Trading Fills

Phase 1 trading-desk heat is based on **actual reported fills**, not theoretical signal outcomes.

```sql
SELECT
    SUM(
        CASE
            WHEN instrument_type = 'future'
                THEN ABS(entry_price - stop_price) * COALESCE((contract_spec->>'point_value')::numeric, 0) * size
            ELSE ABS(entry_price - stop_price) * size
        END
    ) AS open_trade_risk_dollars
FROM intraday_positions
WHERE status = 'open';
```

### Thesis Overlap Check

Before adding a new research position or trading signal, check for sector and ticker overlap:

```sql
SELECT
    h.symbol,
    h.instrument_type,
    t.title AS thesis_title,
    t.thesis_type,
    t.summary,
    t.conviction,
    tk.sector
FROM holdings h
LEFT JOIN theses t ON h.thesis_id = t.id
LEFT JOIN tickers tk ON h.symbol = tk.symbol
WHERE h.status = 'open'
  AND (
      h.symbol = $symbol
      OR tk.sector = $sector
  )
ORDER BY h.entry_date DESC;
```

### Desk Performance Snapshot

`v_desk_performance` reflects **closed manually entered fills**, not hypothetical signal outcomes.

```sql
SELECT *
FROM v_desk_performance
ORDER BY instrument_type, direction;
```

## Portfolio Summary Output

When the CEO or a risk role needs the full picture, assemble:

1. Research holdings
2. Open intraday positions
3. Active trading signals
4. Combined sector concentration
5. Combined directional exposure
6. Futures margin exposure
7. Desk performance from closed reported fills

### Combined Directional Exposure
```sql
WITH combined AS (
    SELECT
        CASE
            WHEN h.instrument_type IN ('shares', 'leap_call', 'call') THEN 'long'
            WHEN h.instrument_type IN ('leap_put', 'put') THEN 'short'
        END AS direction,
        (h.quantity * h.entry_price) AS exposure
    FROM holdings h
    WHERE h.status = 'open'
    UNION ALL
    SELECT
        ip.direction,
        CASE
            WHEN ip.instrument_type = 'future'
                THEN COALESCE((ip.contract_spec->>'margin_required')::numeric, 0) * ip.size
            ELSE ip.entry_price * ip.size
        END AS exposure
    FROM intraday_positions ip
    WHERE ip.status = 'open'
)
SELECT direction, COUNT(*) AS positions, SUM(exposure) AS total_exposure
FROM combined
GROUP BY direction;
```

## What This Skill Does NOT Do

- It does not modify holdings, theses, signals, or intraday positions.
- It does not fetch live market data.
- It does not score or recommend trades by itself.
- It does not treat unfilled signals as positions.
