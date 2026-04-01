---
name: trade-signal
description: >
  Signal output format, lifecycle, assembly process, and fast-path rules for the
  trading desk. Defines the required fields, confluence filter, and Neon storage
  patterns for all trade signals.
allowed-tools:
  - Bash
  - Read
  - Grep
---

# Trade Signal Skill

Structured signal output layer for Zigs Capital's trading desk. This skill defines how signals are assembled, validated, stored, and published. The Head Trader is the primary consumer.

## Signal Format

Every trade signal must include these fields:

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `ticker` | text | Symbol (e.g., AAPL, BTC, ES) |
| `direction` | text | `long` or `short` |
| `instrument_type` | text | `equity`, `option`, `crypto`, or `future` |
| `signal_type` | text | `breakout`, `breakdown`, `reversal`, `momentum`, or `mean_reversion` |
| `entry_price` | numeric | Ideal entry price |
| `stop_price` | numeric | Hard invalidation level |
| `target_1` | numeric | Primary target |
| `timeframe` | text | `intraday` or `swing` |
| `confidence` | text | `high`, `medium`, or `low` |
| `confluence_score` | int | Number of analysts agreeing on direction (0-3) |
| `expires_at` | timestamptz | Signal shelf life — after this, the setup is stale |

### Optional Fields

| Field | Type | When |
|-------|------|------|
| `entry_zone_low` / `entry_zone_high` | numeric | Range entries instead of single price |
| `target_2` / `target_3` | numeric | Progressive take-profit levels |
| `fast_path` | boolean | `true` if Head Trader generated solo |
| `contract_spec` | jsonb | Options: `{expiry, strike, type, premium, greeks}`. Futures: `{product, expiry, exchange, margin, tick_value}` |
| `crypto_spec` | jsonb | Crypto: `{exchange, pair}` |
| `setup_id` | uuid FK | Links to detailed setup report in `setups` table |
| `research_thesis_id` | uuid FK | Loose coupling to research desk thesis |

### Options Contract Spec

For options signals, `contract_spec` must include:

```json
{
  "expiry": "2026-04-10",
  "strike": 145.00,
  "type": "call",
  "premium": 3.20,
  "greeks": {
    "delta": 0.55,
    "gamma": 0.08,
    "theta": -0.12,
    "vega": 0.15,
    "iv": 0.32
  }
}
```

Greeks come from EOD options data (Alpha Vantage HISTORICAL_OPTIONS). These are end-of-day snapshots, not real-time.

### Futures Contract Spec

For futures signals, `contract_spec` must include:

```json
{
  "product": "ES",
  "expiry": "2026-06",
  "exchange": "CME",
  "margin_required": 15400,
  "tick_value": 12.50,
  "point_value": 50.00
}
```

## Signal Lifecycle

```
active → triggered | stopped | target_hit | expired | cancelled
```

| Status | Meaning |
|--------|---------|
| `active` | Signal is live and within shelf life |
| `triggered` | User entered the trade (position recorded in `intraday_positions`) |
| `stopped` | Stop price hit |
| `target_hit` | At least one target reached |
| `expired` | `expires_at` passed without action |
| `cancelled` | Manually cancelled by Head Trader |

Status transitions are recorded via `updated_at` timestamp in Neon.

## Assembly Process (Standard Flow)

1. **Read desk findings** — Query `desk_findings` for the current `desk_run_id` and symbol:
   ```sql
   SELECT analyst_role, direction, confidence, structured_data, body
   FROM desk_findings
   WHERE desk_run_id = $run_id AND symbol = $symbol
   ORDER BY analyst_role;
   ```

2. **Apply confluence filter** — Count analysts agreeing on direction:
   - 3/3 agree: Proceed with highest confidence level any analyst reported
   - 2/3 agree: Proceed with majority direction; note dissent
   - 1/3 or 0/3: No signal. Report "no confluence" with reasoning. Stop here.

3. **Check research context (optional)** — Query active research theses:
   ```sql
   SELECT thesis_type, conviction, title, summary
   FROM theses
   WHERE symbol = $symbol AND status = 'active'
   ORDER BY created_at DESC LIMIT 1;
   ```
   Note alignment or divergence. This is context, never a constraint.

4. **Assemble signal fields** — Pull entry/stop/targets from Chart Strategist, sizing from Desk Risk Manager, statistical edge from Quant Analyst.

5. **Validate completeness** — All required fields must be present. Missing fields = do not store.

6. **Store in Neon:**
   ```sql
   INSERT INTO trade_signals (
     symbol, direction, instrument_type, signal_type,
     entry_price, entry_zone_low, entry_zone_high,
     stop_price, target_1, target_2, target_3,
     timeframe, confidence, confluence_score, fast_path,
     contract_spec, crypto_spec, setup_id, desk_run_id,
     research_thesis_id, status, expires_at
   ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, 'active', $22)
   RETURNING id;
   ```

7. **Publish to Notion** — Create page in Trading Desk Signals database. Resolve database by stored ID or exact-name lookup under the `Trading Desk` container page (never create ad hoc).

## Fast-Path Assembly

For time-sensitive setups where the Head Trader generates a signal solo:

1. Pull intraday/daily data from Alpha Vantage or ProjectX.
2. Compute key levels and indicators locally.
3. Build signal with:
   - `confluence_score = 0`
   - `fast_path = true`
   - Maximum `confidence = 'medium'` (never high on fast-path)
4. Store in Neon and publish to Notion as normal.

Fast-path signals skip the analyst delegation cycle entirely. The tradeoff is reduced confidence.

## Confidence Calibration

| Confluence | Regime Alignment | EV | Max Confidence |
|-----------|-----------------|-----|----------------|
| 3/3 | Aligned | Edge | High |
| 3/3 | Aligned | Marginal | Medium |
| 2/3 | Aligned | Edge | Medium |
| 2/3 | Any | Marginal | Low |
| Fast path | Any | Any | Medium |

Confidence can be downgraded from the max but never upgraded above it.

## What This Skill Does NOT Do

- Does not interpret or analyze data. It defines the signal format and assembly process.
- Does not execute trades or interact with brokers.
- Does not make directional calls. The confluence filter and analyst findings drive direction.
- Does not call Alpha Vantage, ProjectX, or any API directly. The agents do that.
