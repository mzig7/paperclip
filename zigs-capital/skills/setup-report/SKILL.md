---
name: setup-report
description: >
  Setup report template for higher-conviction trading desk setups. Defines the
  7-section report structure, Neon storage, and Notion publishing format.
allowed-tools:
  - Bash
  - Read
---

# Setup Report Skill

Short-form analysis template for Zigs Capital's trading desk. Setup reports are produced by the Head Trader for higher-conviction setups that warrant more detail than a bare signal.

## When to Produce a Setup Report

Not every signal needs a setup report. Produce one when:
- Confluence score is 3/3
- The setup has a compelling statistical edge (EV > 1.0R)
- The position size is significant relative to the account
- The user explicitly requests detailed analysis

A bare signal (from the `trade-signal` skill) is sufficient for standard and fast-path setups.

## Report Structure (7 Sections)

### 1. Header

| Field | Value |
|-------|-------|
| **Ticker** | Symbol |
| **Direction** | Long / Short |
| **Instrument** | Equity / Option / Crypto / Future |
| **Timeframe** | Intraday / Swing |
| **Current Price** | At time of report |
| **Date** | Report date |
| **Signal ID** | Neon `trade_signals.id` |

### 2. Setup Summary

2-3 sentences. What is the setup and why now. This is the thesis in miniature — a reader should know the trade after reading just this section.

Example: "NVDA breaking out of a 2-week consolidation flag at $142 on 1.8x relative volume. 9/21/50 EMAs stacked bullish on the daily. Quant confirms 67% historical win rate for flag breakouts in trending regimes (n=34, EV=1.4R)."

### 3. Technical Context

Chart Strategist's findings, presented as narrative (not raw data dump):
- Key levels (support, resistance, entry zone)
- Pattern identification with measured-move targets
- Multi-timeframe alignment (do the 15-min and daily agree?)
- Volume context (is volume confirming the move?)
- Indicator summary (EMA alignment, RSI, MACD)

### 4. Statistical Edge

Quant Analyst's findings:
- Historical win rate for this setup type in current regime (with sample size)
- Expected value in R-multiples
- Market regime classification (trending/ranging, vol level)
- IV analysis for options setups (rank, percentile, HV spread)
- Correlation with existing positions

### 5. Risk Parameters

Desk Risk Manager's output:
- Position size (shares/contracts/coins) with the math
- R:R ratio for each target
- Portfolio impact (heat %, concentration, directional exposure)
- Stop validation (is the stop at a logical level?)
- Max loss scenario ($, % of capital)
- Risk-adjusted rating (Green/Yellow/Red)

### 6. Research Context (Optional)

Only include if an active research desk thesis exists for this ticker:
- Thesis direction and conviction
- Alignment or divergence with the trading setup
- Relevant fundamental context that supports or contradicts the short-term view

If no research thesis exists, omit this section entirely. Do not pad with "no research context available."

### 7. Trade Plan

The actionable plan:

| Component | Value |
|-----------|-------|
| **Entry** | Price or zone |
| **Stop** | Price (hard invalidation) |
| **Target 1** | Price (partial exit) |
| **Target 2** | Price (if applicable) |
| **Target 3** | Price (if applicable) |
| **Position Size** | Shares/contracts + dollar amount |
| **Max Loss** | Dollar amount |
| **Time Stop** | When to exit if neither target nor stop is hit |

**Invalidation:** What kills the trade — specific, measurable criteria. Not "if the market reverses" but "if NVDA closes below $138.50 on the daily (below the flag support), the pattern is invalidated."

## Neon Storage

Store the setup report in the `setups` table:

```sql
INSERT INTO setups (
  symbol, direction, instrument_type, setup_type, summary,
  technical_context, quant_context, risk_context, research_context,
  entry_zone, stop_price, targets, position_size,
  timeframe, confidence, research_thesis_id, desk_run_id,
  status, expires_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'active', $18)
RETURNING id;
```

Link the setup to the signal: `UPDATE trade_signals SET setup_id = $setup_id WHERE id = $signal_id;`

The JSONB columns (`technical_context`, `quant_context`, `risk_context`, `research_context`, `entry_zone`, `targets`, `position_size`) must contain structured data that other agents can query programmatically.

## Notion Publishing

The setup report is the page content for the signal's page in the Trading Desk Signals database.

Format the report as clean markdown:
- Use the 7-section structure above as headers
- Price targets as currency: `$185.00`
- Percentages with sign: `+12.3%` or `-8.5%`
- Dates as human-readable: `March 30, 2026`
- Tables for structured comparisons
- Bold for key numbers and risk ratings

Resolve the Trading Desk Signals database by stored ID or exact-name lookup under the `Trading Desk` container page. Never create databases ad hoc.

## What This Skill Does NOT Do

- Does not generate analysis. It defines the report template. The agents produce the content.
- Does not make trade recommendations. It structures the Head Trader's synthesis.
- Does not call any external API.
- Does not publish intermediate analyst findings. Only Head Trader-synthesized output.
