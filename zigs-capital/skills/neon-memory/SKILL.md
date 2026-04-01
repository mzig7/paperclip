---
name: neon-memory
description: >
  Read and write to the shared Neon Postgres database — the company's system
  of record. Use for storing findings, reading cached data, querying portfolio
  state, writing theses, and tracking trading desk signals and fills.
allowed-tools:
  - Bash
---

# Neon Memory Skill

Shared memory layer for Zigs Capital. Neon Postgres is the system of record for both desks. It stores tool cache, research findings, theses, holdings, desk findings, trade signals, setup reports, and manually entered short-term fills.

## Connection

Requires `DATABASE_URL`.

```bash
psql "$DATABASE_URL" -c "SELECT 1;"
```

Use `psql` with parameterized variables or carefully quoted heredocs. Never interpolate raw user input directly into SQL.

## Schema Reference

Combined Phase 1 schema: 15 tables and 7 views.

### Existing Research Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `tickers` | Master ticker registry | `symbol`, `sector`, `industry`, `last_enriched` |
| `watchlist` | Research monitoring configuration | `symbol`, `status`, `monitoring_mode` |
| `holdings` | Manually entered research positions | `symbol`, `instrument_type`, `quantity`, `entry_price`, `thesis_id`, `status` |
| `tool_cache` | Cached tool responses with TTL | `cache_key`, `tool`, `endpoint`, `expires_at` |
| `research_runs` | Research session metadata | `paperclip_issue_id`, `run_type`, `budget_mode`, `av_requests_used`, `px_requests_used`, `lx_requests_used`, `av_cache_hits` |
| `research_findings` | Research analyst outputs | `research_run_id`, `symbol`, `analyst_role`, `finding_type`, `structured_data` |
| `theses` | Versioned investment theses | `symbol`, `thesis_type`, `conviction`, `price_target_bull/base/bear`, `status` |
| `signals` | Research alerts and events | `symbol`, `signal_type`, `severity`, `thesis_id` |
| `market_snapshots` | Market-wide context | `snapshot_type`, `data` |
| `decisions` | Human decision audit trail | `symbol`, `decision_type`, `thesis_id`, `rationale` |

### New Trading Desk Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `desk_runs` | Trading desk analysis sessions | `paperclip_issue_id`, `run_type`, `symbols`, `status`, `av_requests_used`, `px_requests_used`, `av_cache_hits` |
| `desk_findings` | Trading desk analyst outputs | `desk_run_id`, `symbol`, `analyst_role`, `finding_type`, `direction`, `structured_data` |
| `trade_signals` | Head Trader signal output | `symbol`, `direction`, `instrument_type`, `signal_type`, `entry_price`, `stop_price`, `target_1`, `status`, `confluence_score`, `fast_path`, `expires_at` |
| `setups` | Detailed setup reports | `symbol`, `direction`, `setup_type`, `technical_context`, `quant_context`, `risk_context`, `position_size`, `expires_at` |
| `intraday_positions` | Manually entered short-term fills | `symbol`, `direction`, `instrument_type`, `entry_price`, `exit_price`, `size`, `signal_id`, `status`, `pnl`, `r_multiple` |

### Views

| View | Returns |
|------|---------|
| `v_open_positions` | Existing research holdings with thesis context |
| `v_active_watchlist` | Existing active watchlist rows |
| `v_pending_signals` | Existing unacknowledged research signals |
| `v_recent_research` | Existing recent research runs |
| `v_active_signals` | Active trading signals still within shelf life |
| `v_desk_performance` | Closed intraday position performance by instrument and direction |
| `v_open_intraday` | Open intraday positions joined with signal context |

## Common Operations

### Register or Refresh a Ticker
```sql
INSERT INTO tickers (symbol, name, exchange, sector, industry, market_cap, description, last_enriched)
VALUES ($symbol, $name, $exchange, $sector, $industry, $market_cap, $description, NOW())
ON CONFLICT (symbol) DO UPDATE
SET name = EXCLUDED.name,
    exchange = EXCLUDED.exchange,
    sector = EXCLUDED.sector,
    industry = EXCLUDED.industry,
    market_cap = EXCLUDED.market_cap,
    description = EXCLUDED.description,
    last_enriched = NOW(),
    updated_at = NOW();
```

### Start a Research Run
```sql
INSERT INTO research_runs (paperclip_issue_id, run_type, budget_mode, symbols, initiated_by)
VALUES ($issue_id, $run_type, $budget_mode, ARRAY[$symbols], $agent_id)
RETURNING id;
```

### Start a Desk Run
```sql
INSERT INTO desk_runs (paperclip_issue_id, run_type, symbols, initiated_by, status)
VALUES ($issue_id, 'on_demand', ARRAY[$symbols], $agent_id, 'running')
RETURNING id;
```

### Write a Research Finding
```sql
INSERT INTO research_findings (
    research_run_id, symbol, analyst_role, agent_id,
    finding_type, title, body, confidence, sentiment,
    is_material, structured_data, data_sources
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);
```

### Write a Desk Finding
```sql
INSERT INTO desk_findings (
    desk_run_id, symbol, analyst_role, agent_id,
    finding_type, title, body, confidence, direction,
    structured_data, data_sources
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);
```

### Read Desk Findings for Confluence
```sql
SELECT analyst_role, finding_type, title, body, confidence, direction, structured_data, created_at
FROM desk_findings
WHERE desk_run_id = $run_id
  AND symbol = $symbol
ORDER BY analyst_role, created_at;
```

### Store a Trade Signal
```sql
INSERT INTO trade_signals (
    symbol, direction, instrument_type, signal_type,
    entry_price, entry_zone_low, entry_zone_high,
    stop_price, target_1, target_2, target_3,
    timeframe, confidence, confluence_score, fast_path,
    contract_spec, crypto_spec, setup_id, desk_run_id,
    research_thesis_id, status, expires_at
) VALUES (
    $1, $2, $3, $4,
    $5, $6, $7,
    $8, $9, $10, $11,
    $12, $13, $14, $15,
    $16, $17, $18, $19,
    $20, 'active', $21
)
RETURNING id;
```

### Store a Setup Report
```sql
INSERT INTO setups (
    symbol, direction, instrument_type, setup_type, summary,
    technical_context, quant_context, risk_context, research_context,
    entry_zone, stop_price, targets, position_size,
    timeframe, confidence, research_thesis_id, desk_run_id,
    status, expires_at
) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8, $9,
    $10, $11, $12, $13,
    $14, $15, $16, $17,
    'active', $18
)
RETURNING id;
```

### Record a Manually Entered Fill
```sql
INSERT INTO intraday_positions (
    symbol, direction, instrument_type, contract_spec,
    entry_price, entry_time, size, stop_price, target_price,
    signal_id, status
) VALUES (
    $1, $2, $3, $4,
    $5, $6, $7, $8, $9,
    $10, 'open'
)
RETURNING id;
```

### Close a Position From User-Reported Exit
```sql
UPDATE intraday_positions
SET exit_price = $exit_price,
    exit_time = $exit_time,
    exit_reason = $exit_reason,
    pnl = $pnl,
    pnl_pct = $pnl_pct,
    r_multiple = $r_multiple,
    status = 'closed',
    updated_at = NOW()
WHERE id = $position_id;
```

### Cache Check
```sql
SELECT response_data
FROM tool_cache
WHERE cache_key = $key
  AND expires_at > NOW();
```

### Cache Write
```sql
INSERT INTO tool_cache (cache_key, tool, endpoint, symbol, request_params, response_data, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, NOW() + $ttl_interval)
ON CONFLICT (cache_key) DO UPDATE
SET response_data = EXCLUDED.response_data,
    fetched_at = NOW(),
    expires_at = EXCLUDED.expires_at;
```

### Increment Run Counters

Research:
```sql
UPDATE research_runs
SET av_requests_used = av_requests_used + 1
WHERE id = $run_id;
```

Trading desk:
```sql
UPDATE desk_runs
SET av_requests_used = av_requests_used + 1
WHERE id = $run_id;
```

ProjectX:
```sql
UPDATE desk_runs
SET px_requests_used = px_requests_used + 1
WHERE id = $run_id;
```

Cache hit:
```sql
UPDATE desk_runs
SET av_cache_hits = av_cache_hits + 1
WHERE id = $run_id;
```

## Query Patterns for Agents

### Fundamentals or Buffett: prior research on a ticker
```sql
SELECT finding_type, title, body, structured_data, created_at
FROM research_findings
WHERE symbol = $symbol
  AND analyst_role IN ('fundamentals', 'buffett')
ORDER BY created_at DESC
LIMIT 10;
```

### Head Trader: active research context on the same ticker
```sql
SELECT id, thesis_type, title, summary, conviction,
       price_target_bull, price_target_base, price_target_bear,
       time_horizon, status, created_at
FROM theses
WHERE symbol = $symbol
  AND status = 'active'
ORDER BY created_at DESC
LIMIT 1;
```

### CEO or Desk Risk Manager: active desk state
```sql
SELECT * FROM v_active_signals;

SELECT * FROM v_open_intraday;
```

### Quant Analyst: historical setup outcomes
```sql
SELECT
    ts.signal_type,
    ts.instrument_type,
    COUNT(*) AS trades,
    AVG(ip.r_multiple) AS avg_r,
    AVG(ip.pnl) AS avg_pnl
FROM intraday_positions ip
JOIN trade_signals ts ON ip.signal_id = ts.id
WHERE ip.status = 'closed'
GROUP BY ts.signal_type, ts.instrument_type
ORDER BY trades DESC;
```

## Rules

- Always use parameterized queries or correctly quoted values.
- `research_findings`, `desk_findings`, `theses`, `decisions`, `trade_signals`, and `intraday_positions` are append-only audit surfaces.
- For `trade_signals`, updates are limited to lifecycle fields such as `status`, `updated_at`, and optional back-reference metadata.
- For `intraday_positions`, updates are limited to fill completion fields such as `exit_price`, `exit_time`, `exit_reason`, `pnl`, `pnl_pct`, `r_multiple`, `status`, and `updated_at`.
- Do not delete desk findings, trade signals, or position rows to “clean up” mistakes. Append corrective records or update the allowed lifecycle fields only.
- Use `ON CONFLICT ... DO UPDATE` for `tickers`, `watchlist`, and `tool_cache`.
- Every `research_findings` row must have a `research_run_id`.
- Every `desk_findings` row must have a `desk_run_id`.
- If the user never acts on a signal, do not create an `intraday_positions` row.

## What This Skill Does NOT Do

- It does not interpret the data.
- It does not call Alpha Vantage, ProjectX, Exa, or Notion.
- It does not execute trades or mutate broker state.
