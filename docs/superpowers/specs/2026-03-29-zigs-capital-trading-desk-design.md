# Zigs Capital Trading Desk Design

**Date:** 2026-03-29 (rev 2: 2026-03-30)
**Status:** Draft
**Scope:** Add an intraday/short-term trading desk to the existing Zigs Capital company alongside the current research desk.

---

## Context

Zigs Capital currently operates as a financial research company with 6 analysts + 1 CEO, optimized for medium-term, valuation-first, catalyst-confirmed LEAP plays. The company wants to expand into intraday and short-term trading (1-5 day holds) covering equities, weekly+ options (EOD data), crypto, and futures.

These two operations are fundamentally different:
- **Research desk**: Fundamentals-weighted, multi-analyst due diligence, thesis-driven, days-to-weeks analysis cycles
- **Trading desk**: Technical-analysis-weighted, speed-oriented, signal-driven, minutes-to-hours analysis cycles

The trading desk will operate as a **loosely coupled** department within the same Paperclip company. It uses the same core services (Alpha Vantage, Exa, LuxAlgo, Neon) plus ProjectX for futures, but with different skill files and agent instructions optimized for short-term technical analysis.

### Authoring vs Execution Model

- **Laptop** (this repo) is the **authoring source**. All agent definitions (AGENTS.md), skill files (SKILL.md), and schema migrations are written and version-controlled here.
- **Mac Mini** runs the **Paperclip instance** and is the **execution source of truth**. Agents are provisioned, secrets configured, and heartbeats triggered on the Mac Mini. The Neon database and Notion workspace are live external services accessed from the Mac Mini.
- **Deployment**: Author locally on the laptop, AirDrop (or sync) the `zigs-capital/` directory to the Mac Mini, then manually provision the runtime in the Paperclip UI/CLI on the Mac Mini (create agents, import skills, configure secrets, run schema migrations).

### Data Infrastructure

- **Alpha Vantage premium** ($99.99/month) — 150 req/min, no daily cap, EOD options chain with Greeks/IV, crypto intraday. Options data is end-of-day only. 0DTE is not feasible; minimum options timeframe is weeklies.
- **ProjectX API** (`project-x-py`) — Real-time + historical futures data, 59+ built-in technical indicators, Level 2 order book, WebSocket streaming.
- **Neon Postgres** — Shared database for both desks. Research tables unchanged; new trading desk tables added.
- **Notion** — Human-facing publication layer for both research memos and trading desk signals.

### Phased Rollout

- **Phase 1 (this build):** Agents, skills, schema, Notion trading databases, on-demand analysis only. Manual kick-off via Paperclip issues. Advisory-only — no live order execution.
- **Phase 2 (future):** Scheduled scans, watchlist monitoring, and other automated features after smoke testing.

---

## Organization Structure

```
CEO (Portfolio Manager — expanded to oversee both desks)
│
├── Research Desk (existing — unchanged)
│   ├── Fundamentals Analyst
│   ├── Buffett Analyst (Value & Business Quality)
│   ├── Growth Analyst (Catalysts)
│   ├── Sentiment Analyst (Flow & Narrative)
│   ├── Technical Analyst
│   └── Risk Manager
│
└── Trading Desk (new)
    ├── Head Trader (desk head, reports to CEO)
    ├── Chart Strategist (multi-timeframe TA)
    ├── Quant Analyst (backtesting, probability, statistical validation)
    └── Desk Risk Manager (position sizing, stops, exposure)
```

**Key organizational decisions:**
- Single company, two desks (not two separate companies)
- Head Trader manages the trading desk independently; CEO delegates intraday decisions to Head Trader
- CEO maintains portfolio-level awareness by reading trading desk data from Neon
- Desks are loosely coupled: trading desk can read research theses as optional directional context but is never constrained by them
- 3 desk analysts (not 4): Flow Analyst dropped because Alpha Vantage lacks the advanced flow data (unusual options activity, dark pool, sweeps) needed for that role — that's Unusual Whales territory. Volume analysis absorbed by Chart Strategist.

---

## Trading Desk Agent Definitions

### Head Trader

- **Role:** CEO-equivalent for the trading desk. Synthesizes analyst outputs into actionable signals and setup reports.
- **Reports to:** CEO
- **Adapter:** `codex_local` (model: `codex-mini`)
- **Philosophy:**
  - Price action first. If the chart doesn't confirm, no trade.
  - Technical confluence required — minimum 2 of 3 analysts must agree on direction.
  - Speed over perfection — a good signal now beats a perfect signal in 2 hours.
- **Responsibilities:**
  1. Receive on-demand requests via Paperclip issues
  2. Delegate technical analysis to desk analysts via subtasks
  3. Read analyst findings from Neon `desk_findings` table
  4. Apply confluence filter (requires 2+ of 3 analysts agreeing on direction)
  5. Produce trade signals (structured) and/or setup reports (narrative)
  6. Optionally check research desk `theses` table for directional context
  7. Publish to Notion (Trading Desk Signals database)
  8. Track positions in Neon `intraday_positions` table (see Position Tracking Model below)
- **Fast path:** For time-sensitive setups (intraday timeframe, market moving fast), the Head Trader can generate signals directly using Alpha Vantage / ProjectX data without waiting for full analyst delegation. Triggers: user explicitly requests fast turnaround, or the setup is straightforward with clear levels. Fast-path signals get `confluence_score = 0` and reduced confidence ceiling (max: medium). Analyst output enhances but is not prerequisite.
- **Skills:** `paperclip`, `neon-memory`, `alpha-vantage`, `projectx`, `notion-publish`, `trade-signal`, `setup-report`
- **Environment:** `DATABASE_URL`, `ALPHA_VANTAGE_API_KEY`, `PROJECTX_API_KEY`, `NOTION_API_KEY`

### Chart Strategist

- **Role:** Multi-timeframe technical analysis. The primary analytical lens for the trading desk.
- **Reports to:** Head Trader
- **Adapter:** `opencode_local`
- **Analysis focus:**
  - **Structure:** Trend analysis across daily -> 4H -> 1H -> 15m -> 5m. Higher timeframe establishes bias, lower timeframe provides entries.
  - **Key levels:** Support/resistance, VWAP, prior day high/low/close, pre-market range, pivot points, volume profile POC/VAH/VAL
  - **Patterns:** Breakouts, breakdowns, flags, wedges, cup-and-handle, head-and-shoulders with measured-move targets
  - **Indicators:** EMA ribbons (9/21/50), RSI (14), MACD, Bollinger Bands, ATR for stop distance
  - **Volume analysis:** Relative volume vs. 20-day average, accumulation/distribution, volume at price (absorbed from dropped Flow Analyst)
  - **Crypto-specific:** 24/7 structure, BTC dominance correlation, funding rates context
  - **Futures-specific:** Contract rollover awareness, session structure (RTH vs ETH), volume profile by session
  - **Options-specific:** Key strike clustering (max pain, high OI levels) from EOD options data
- **Output format:**
  - Direction (long/short/neutral)
  - Key levels table (Level Type | Price | Evidence | Timeframe)
  - Pattern identification with measured-move targets
  - Entry zone, stop level, target levels
  - Invalidation criteria
  - Multi-timeframe alignment score (aligned/partial/conflicting)
- **Skills:** `paperclip`, `alpha-vantage`, `projectx`, `luxalgo`, `neon-memory`
- **Environment:** `ALPHA_VANTAGE_API_KEY`, `PROJECTX_API_KEY`, `DATABASE_URL`

### Quant Analyst

- **Role:** Statistical validation, probability assessment, and backtesting.
- **Reports to:** Head Trader
- **Adapter:** `opencode_local`
- **Analysis focus:**
  - **Pattern backtesting:** Historical win rate of identified setups at similar price levels, volume conditions, and market regimes
  - **Expected value:** EV = (win rate * avg win) - (loss rate * avg loss). Reject setups with negative EV.
  - **Correlation analysis:** Ticker vs. sector, ticker vs. broad market, inter-position correlation for open trades
  - **Volatility modeling:** IV rank, IV percentile, HV vs. IV spread (critical for options strategy selection — sell premium when IV > HV, buy when IV < HV). Uses EOD options data.
  - **Mean reversion / momentum:** Z-scores from 20/50-day means, RSI extremes, Bollinger bandwidth for regime detection
  - **Regime classification:** Trending (ADX > 25) vs. range-bound (ADX < 20), high-vol vs. low-vol (ATR percentile)
  - **Futures-specific:** Term structure analysis (contango/backwardation), basis spread, open interest changes
- **Output format:**
  - Probability assessment (setup win rate estimate with confidence interval)
  - Expected value calculation
  - Market regime classification (trending/ranging, high-vol/low-vol)
  - IV analysis (rank, percentile, HV spread — for options setups)
  - Correlation risk (with current open positions)
  - Statistical edge verdict (edge/marginal/no edge)
- **Skills:** `paperclip`, `alpha-vantage`, `projectx`, `neon-memory`, `quant-toolkit`
- **Environment:** `ALPHA_VANTAGE_API_KEY`, `PROJECTX_API_KEY`, `DATABASE_URL`

### Desk Risk Manager

- **Role:** Position sizing, stop management, and short-term exposure tracking.
- **Reports to:** Head Trader
- **Adapter:** `codex_local` (model: `codex-mini`)
- **Core principles:**
  1. Max risk per trade: defined % of trading capital (configurable, default 1-2%)
  2. Max daily drawdown: hard stop (configurable, default 3-5% of trading capital)
  3. Max concurrent positions: limit to prevent overexposure (configurable, default 5)
  4. Correlation awareness: don't stack correlated positions (max 2 positions in same sector/asset class)
  5. Time decay awareness: theta burn on options positions must be factored into hold duration
- **Analysis focus:**
  - Position sizing from entry price + stop distance + account risk tolerance
  - Portfolio heat: total open risk across all intraday/swing positions
  - Correlation between open positions (sector, beta, directional, asset class)
  - Options-specific: theta decay rate, max loss scenarios (EOD Greeks analysis)
  - Futures-specific: margin requirements, contract multiplier impact on position sizing, liquidation levels
  - Crypto-specific: leverage/liquidation levels, exchange risk
  - Daily P&L tracking and drawdown monitoring
- **Output format:**
  - Position size (shares/contracts/coins) with math
  - Risk/reward ratio
  - Portfolio impact (new heat %, sector concentration change, directional exposure change)
  - Stop placement validation (is the stop at a logical technical level, not just a % away?)
  - Max loss scenario
  - Risk-adjusted recommendation (Green/Yellow/Red)
- **Skills:** `paperclip`, `alpha-vantage`, `projectx`, `neon-memory`, `portfolio-context`
- **Environment:** `ALPHA_VANTAGE_API_KEY`, `PROJECTX_API_KEY`, `DATABASE_URL`

---

## Position Tracking Model (Phase 1)

Phase 1 is **advisory-only** — the trading desk produces signals and setup reports but does not execute orders. Position tracking in `intraday_positions` follows a **manually-entered fills** model:

- When the user acts on a signal (enters a trade), they report the fill to the Head Trader via a Paperclip issue comment (e.g., "Filled NVDA long 100 shares @ $142.50, stop $140.00").
- The Head Trader records the fill in `intraday_positions` with the actual entry price, size, stop, and target from the signal.
- When the user exits, they report the exit similarly. The Head Trader updates the position with exit price, exit time, exit reason, and computes PnL, PnL%, and R-multiple.
- If the user doesn't report an exit and the signal expires, the Head Trader marks the position with `exit_reason = 'expired'` and computes PnL based on market price at expiry (from Alpha Vantage / ProjectX).

**This means:**
- `v_desk_performance` (win rate, avg R, total PnL) reflects **actual fills the user reported**, not theoretical signal outcomes.
- Portfolio heat and exposure in the Desk Risk Manager's analysis reflects real open positions, not hypothetical.
- If the user doesn't act on a signal, no position is created — the signal stays in `trade_signals` with status tracking only.

**Not supported in Phase 1:** Paper trading simulation, automatic fill detection, or broker integration.

---

## New Skills

### `trade-signal` (Head Trader)

Defines the structured signal output format and lifecycle.

**Required signal fields:**
- `ticker`, `direction` (long/short), `instrument_type` (equity/option/crypto/future)
- `entry_price` or `entry_zone` (range)
- `stop_price` (hard invalidation)
- `target_1`, `target_2`, `target_3` (progressive targets)
- `timeframe` (intraday/swing)
- `confluence_score` (number of analysts agreeing, 0-3)
- `confidence` (high/medium/low)
- `expires_at` (signal shelf life)
- For options: `contract_spec` (expiry, strike, type), `premium`, `greeks_snapshot` (from EOD data)
- For crypto: `exchange`, `pair`
- For futures: `contract_spec` (product, expiry, exchange), `margin_required`, `tick_value`

**Signal lifecycle:** `active` -> `triggered` / `stopped` / `target_hit` / `expired` / `cancelled`

**Assembly process:**
1. Read desk analyst findings from Neon `desk_findings`
2. Apply confluence filter (2+ of 3 analysts must agree on direction)
3. Check research desk `theses` for optional context
4. Build signal with all required fields
5. Store in Neon `trade_signals` table
6. If setup warrants detail, also produce a setup report (see `setup-report` skill)
7. Publish to Notion Trading Desk Signals database

**Fast-path assembly** (Head Trader solo, no analyst delegation):
1. Pull intraday/daily data from Alpha Vantage or ProjectX
2. Compute key levels and indicators
3. Build signal with confluence_score = 0 (self-generated) and reduced confidence
4. Store in Neon with `fast_path = true` flag

### `setup-report` (Head Trader)

Short-form analysis template for higher-conviction setups.

**Sections:**
1. **Header:** Ticker, Direction, Instrument, Timeframe, Current Price, Date
2. **Setup Summary:** 2-3 sentences — what's the setup and why now
3. **Technical Context:** Chart Strategist findings (levels, patterns, multi-TF alignment, volume)
4. **Statistical Edge:** Quant Analyst findings (win rate, EV, regime, IV analysis)
5. **Risk Parameters:** Desk Risk Manager output (sizing, R:R, stops, portfolio impact)
6. **Research Context (optional):** If a research thesis exists on this ticker, summarize the directional alignment or divergence
7. **Trade Plan:** Entry, stop, targets, position size, max loss, time stop (when to exit if neither target nor stop hit)
8. **Invalidation:** What kills the trade — specific, measurable criteria

### `quant-toolkit` (Quant Analyst)

Statistical analysis methods using Alpha Vantage, ProjectX, and Neon historical data.

**Capabilities:**
- **Historical pattern analysis:** Query `desk_findings` and `trade_signals` for historical win rates by setup type, ticker, market regime
- **Expected value computation:** Win rate * avg win - loss rate * avg loss, using historical `intraday_positions` outcomes
- **Volatility analysis:** Compute HV (20-day, 60-day), compare to IV from EOD options chain data. IV rank and IV percentile from historical IV data stored in Neon.
- **Correlation matrix:** Compute rolling correlation between ticker and SPY, QQQ, sector ETF, BTC using daily returns
- **Regime detection:** ADX for trend strength, ATR percentile for volatility regime, Bollinger bandwidth for squeeze detection
- **Z-score computation:** Distance from N-day mean in standard deviations for mean-reversion signals
- **Futures-specific:** Term structure analysis, basis spread computation, volume-weighted settlement tracking

**Data strategy:**
- Equities/crypto/options: Alpha Vantage TIME_SERIES_DAILY, TIME_SERIES_INTRADAY, HISTORICAL_OPTIONS, CRYPTO_INTRADAY
- Futures: ProjectX API for real-time + historical bars, Level 2 data, built-in indicators
- Store computed metrics in Neon `desk_findings` with `finding_type = 'quant_analysis'` and structured_data JSONB
- Cache historical computations to avoid recomputing on every heartbeat

### `projectx` (Chart Strategist, Quant Analyst, Desk Risk Manager, Head Trader)

Futures data layer via the ProjectX API (`project-x-py` Python SDK v3.5.9).

**Authentication:** `PROJECTX_API_KEY` environment variable. Async session management via `TradingSuite` class.

**Core capabilities:**
- **Historical bars:** Retrieve OHLCV with customizable timeframes and date ranges for any futures product
- **Real-time streaming:** WebSocket quotes, trades, and account updates (Note: within heartbeat execution windows only)
- **Level 2 order book:** Market depth analysis for entry/exit level validation
- **Built-in indicators:** 59+ indicators (RSI, SMA, MACD, Fair Value Gaps, Order Blocks, etc.) — TA-Lib compatible
- **Session filtering:** RTH (regular trading hours) vs. ETH (extended) session data
- **Multi-instrument:** Query multiple futures products in a single session

**Instrument coverage:**
- ES (S&P 500 E-mini), NQ (Nasdaq E-mini), YM (Dow E-mini)
- CL (Crude Oil), GC (Gold), SI (Silver)
- ZB (30-Year Treasury), ZN (10-Year Treasury)
- Any CME Group, CBOT, NYMEX, COMEX listed product

**Data access patterns:**
- `get_historical_bars(symbol, timeframe, start, end)` — historical OHLCV
- `get_market_depth(symbol)` — Level 2 order book snapshot
- `get_quote(symbol)` — current bid/ask/last
- `calculate_indicator(symbol, indicator, params)` — built-in TA computation

**Cache protocol:** Before API calls, check Neon `tool_cache`. TTLs: 1 min (quotes), 5 min (intraday bars), 4 hours (daily bars), 24 hours (indicators on historical data).

**Tools allowed:** Bash (for Python SDK execution)

---

## Neon Schema Additions

New tables coexisting with the existing research schema. The `neon-memory` SKILL.md will be updated to document these.

### Phase 1 Tables

#### `desk_runs` (trading desk analysis sessions)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `paperclip_issue_id` | text | |
| `run_type` | text | on_demand (Phase 1 only; scheduled_scan, watchlist_alert in Phase 2) |
| `symbols` | text[] | |
| `initiated_by` | uuid | Agent ID |
| `av_requests_used` | int | |
| `exa_requests_used` | int | |
| `lx_requests_used` | int | |
| `px_requests_used` | int | ProjectX API calls |
| `av_cache_hits` | int | |
| `status` | text | running, completed, failed |
| `created_at` | timestamptz | |
| `completed_at` | timestamptz | |

#### `desk_findings` (trading desk analyst outputs)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `desk_run_id` | uuid FK -> desk_runs | |
| `symbol` | text | |
| `analyst_role` | text | chart_strategist, quant_analyst, desk_risk_manager |
| `agent_id` | uuid | |
| `finding_type` | text | technical_analysis, quant_analysis, risk_assessment |
| `title` | text | |
| `body` | text | Markdown narrative |
| `confidence` | text | high/medium/low |
| `direction` | text | bullish/bearish/neutral |
| `structured_data` | jsonb | Programmatic data (levels, indicators, metrics) |
| `data_sources` | text[] | Which AV/ProjectX endpoints used |
| `created_at` | timestamptz | |

#### `trade_signals` (signal output)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `symbol` | text | |
| `direction` | text | long/short |
| `instrument_type` | text | equity/option/crypto/future |
| `signal_type` | text | breakout/breakdown/reversal/momentum/mean_reversion |
| `entry_price` | numeric | |
| `entry_zone_low` | numeric | nullable, for range entries |
| `entry_zone_high` | numeric | nullable |
| `stop_price` | numeric | |
| `target_1` | numeric | |
| `target_2` | numeric | nullable |
| `target_3` | numeric | nullable |
| `timeframe` | text | intraday/swing |
| `confidence` | text | high/medium/low |
| `confluence_score` | int | 0-3 (number of analysts agreeing) |
| `fast_path` | boolean | true if Head Trader generated solo |
| `contract_spec` | jsonb | nullable — options (expiry, strike, type, premium, greeks) or futures (product, expiry, exchange, margin, tick_value) |
| `crypto_spec` | jsonb | nullable — for crypto (exchange, pair) |
| `setup_id` | uuid FK -> setups | nullable — links to detailed setup report |
| `desk_run_id` | uuid FK -> desk_runs | |
| `research_thesis_id` | uuid FK -> theses | nullable — loose coupling to research |
| `status` | text | active/triggered/stopped/target_hit/expired/cancelled |
| `expires_at` | timestamptz | Signal shelf life |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

#### `setups` (detailed setup reports)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `symbol` | text | |
| `direction` | text | long/short |
| `instrument_type` | text | equity/option/crypto/future |
| `setup_type` | text | breakout/breakdown/reversal/momentum/mean_reversion |
| `summary` | text | 2-3 sentence setup thesis |
| `technical_context` | jsonb | Chart Strategist findings |
| `quant_context` | jsonb | Quant Analyst findings |
| `risk_context` | jsonb | Desk Risk Manager findings |
| `research_context` | jsonb | nullable — research thesis summary |
| `entry_zone` | jsonb | {low, high, ideal} |
| `stop_price` | numeric | |
| `targets` | jsonb | [{price, label}] |
| `position_size` | jsonb | {shares/contracts, dollar_amount, risk_pct} |
| `timeframe` | text | intraday/swing |
| `confidence` | text | high/medium/low |
| `research_thesis_id` | uuid FK -> theses | nullable |
| `desk_run_id` | uuid FK -> desk_runs | |
| `status` | text | active/triggered/stopped/target_hit/expired |
| `expires_at` | timestamptz | |
| `created_at` | timestamptz | |

#### `intraday_positions` (short-term position tracking — manually entered fills)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `symbol` | text | |
| `direction` | text | long/short |
| `instrument_type` | text | equity/option/crypto/future |
| `contract_spec` | jsonb | nullable — for options or futures |
| `entry_price` | numeric | Actual fill price reported by user |
| `entry_time` | timestamptz | |
| `size` | numeric | shares/contracts/coins |
| `stop_price` | numeric | |
| `target_price` | numeric | Primary target |
| `exit_price` | numeric | nullable — filled on close (user-reported or market price at expiry) |
| `exit_time` | timestamptz | nullable |
| `exit_reason` | text | nullable — target_hit/stopped/time_stop/manual/expired |
| `pnl` | numeric | nullable — computed from actual entry/exit prices |
| `pnl_pct` | numeric | nullable |
| `r_multiple` | numeric | nullable — PnL / risk |
| `signal_id` | uuid FK -> trade_signals | |
| `status` | text | open/closed |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### Phase 1 Views

```sql
CREATE VIEW v_active_signals AS
SELECT * FROM trade_signals
WHERE status = 'active' AND (expires_at IS NULL OR expires_at > NOW())
ORDER BY created_at DESC;

CREATE VIEW v_desk_performance AS
SELECT
  instrument_type, direction,
  COUNT(*) as total_trades,
  COUNT(*) FILTER (WHERE pnl > 0) as wins,
  COUNT(*) FILTER (WHERE pnl <= 0) as losses,
  ROUND(COUNT(*) FILTER (WHERE pnl > 0)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as win_rate_pct,
  ROUND(AVG(r_multiple), 2) as avg_r_multiple,
  ROUND(SUM(pnl), 2) as total_pnl
FROM intraday_positions WHERE status = 'closed'
GROUP BY instrument_type, direction;

CREATE VIEW v_open_intraday AS
SELECT ip.*, ts.confluence_score, ts.fast_path, ts.signal_type
FROM intraday_positions ip
JOIN trade_signals ts ON ip.signal_id = ts.id
WHERE ip.status = 'open'
ORDER BY ip.entry_time DESC;
```

### Phase 2 Tables (future — deferred)

- `desk_watchlist` — Alert conditions, direction bias, source tracking, trigger state
- `scanner_results` — Scan type, composite score, flags, promotion tracking

---

## Notion Publishing Updates

The `notion-publish` skill is updated to support trading desk output alongside research output.

**Operating rules:**
1. **Neon stores facts. Notion stores deliverables.** Only CEO-synthesized (research) or Head Trader-synthesized (trading) output goes to Notion. Never publish intermediate analyst findings.
2. **Publish into databases, not loose pages.** Thesis docs are always pages inside Research Memos. Trading signals are always pages inside Trading Desk Signals. Position logs are always pages inside Trading Desk Positions Log. Nothing is created as a loose child page under Zigs Capital or its desk containers.
3. **Resolve by stored ID or exact-name lookup.** Publishing flows must look up their target database by stored Notion ID (preferred) or exact name match — never create containers ad hoc. If a database cannot be found, fail loudly; do not create a new one.

### Notion Workspace Hierarchy

```
Zigs Capital                       (top-level page)
├── Research Desk                  (container page)
│   ├── Research Memos             (database — thesis docs)
│   ├── Watchlist                  (database — future, not Phase 1 trading)
│   └── Decision Log               (database — future, not Phase 1 trading)
├── Zigs Capital Trading Desk      (container page)
│   ├── Trading Desk Signals       (database — signal + setup report pages)
│   └── Trading Desk Positions Log (database — manually entered fills)
└── Portfolio Dashboard            (page — cross-desk summary)
```

`Zigs Capital`, `Research Desk`, and `Zigs Capital Trading Desk` are container pages — they hold databases, not content. The Portfolio Dashboard is a standalone page at the top level that aggregates both desks.

### Trading Desk Signals Database

Parent: `Zigs Capital Trading Desk` container page.

Properties:
- **Ticker** (title)
- **Direction** (select: Long / Short)
- **Instrument** (select: Equity / Option / Crypto / Future)
- **Signal Type** (select: Breakout / Breakdown / Reversal / Momentum / Mean Reversion)
- **Entry** (number)
- **Stop** (number)
- **Target 1** (number)
- **Target 2** (number)
- **Target 3** (number)
- **Timeframe** (select: Intraday / Swing)
- **Confidence** (select: High / Medium / Low)
- **Confluence Score** (number: 0-3)
- **Fast Path** (checkbox)
- **Status** (select: Active / Triggered / Stopped / Target Hit / Expired / Cancelled)
- **Date** (date)
- **Expires** (date)
- **Neon Signal ID** (text — links back to system of record)

Page content: The full setup report (if one exists) or a concise signal summary.

### Trading Desk Positions Log Database

Parent: `Zigs Capital Trading Desk` container page.

Properties:
- **Ticker** (title)
- **Direction** (select: Long / Short)
- **Instrument** (select: Equity / Option / Crypto / Future)
- **Entry Price** (number)
- **Exit Price** (number)
- **PnL** (number)
- **R-Multiple** (number)
- **Exit Reason** (select: Target Hit / Stopped / Time Stop / Manual / Expired)
- **Signal Link** (relation to Trading Desk Signals)
- **Date Entered** (date)
- **Date Exited** (date)

### Publishing Workflow (Trading Desk)

1. Head Trader reads synthesized findings from Neon `desk_findings`
2. Builds signal/setup report using `trade-signal` or `setup-report` skill
3. Stores in Neon `trade_signals` / `setups` tables
4. Resolves `Trading Desk Signals` database by stored ID or exact-name search under the `Zigs Capital Trading Desk` container
5. Creates page in the resolved database, sets all properties from signal fields
6. Writes setup report as page content (if detailed setup exists)
7. Stores Notion page ID back in Neon for cross-reference

### Publishing Workflow (Research — existing, clarified)

Research Memos, Watchlist, and Decision Log databases live under the `Research Desk` container page. Publishing follows the same resolve-by-ID-or-name pattern. No changes to research publishing logic beyond moving databases under the `Research Desk` container.

### Portfolio Dashboard Updates

The Portfolio Dashboard page (top-level under `Zigs Capital`) is updated to include a "Trading Desk" section showing active signals, open intraday positions, and desk performance summary alongside the existing research desk sections.

---

## Triggering Model

### Phase 1: On-Demand Only

User submits a Paperclip issue to the Head Trader with a ticker and optional direction/instrument preference:

1. User creates issue -> assigned to Head Trader
2. Head Trader delegates to desk analysts via subtasks
3. Analysts write findings to `desk_findings`
4. Head Trader synthesizes -> produces signal and/or setup report
5. Head Trader publishes to Notion Trading Desk Signals database
6. User acts on signal (or not) and reports fills via issue comments
7. Head Trader records fills in `intraday_positions`

For fast turnaround, user can note "fast path" in the issue — Head Trader generates a signal solo without analyst delegation.

### Phase 2 (future): Scheduled Scans + Watchlist Monitoring

Deferred until after Phase 1 smoke testing. Will add:
- CRON-based scan routines (pre-market, open, mid-day, post-market, crypto)
- Watchlist condition polling (every 15 min market hours, every 2 hours crypto)

---

## CEO Role Changes

The existing CEO AGENTS.md receives additions (not replacements):

### New section: Trading Desk Oversight

- CEO reads `trade_signals` and `intraday_positions` from Neon for portfolio-level awareness
- CEO does NOT make intraday trade decisions — Head Trader has full autonomy
- CEO can flag tickers from research theses to the Head Trader for trading consideration (via Paperclip issue)
- CEO reads `v_desk_performance` for periodic desk performance review

### New section: Cross-Desk Coordination

- If research desk produces a new bull/bear thesis, CEO may create an issue for Head Trader: "Consider {TICKER} with {direction} bias based on research thesis"
- If trading desk takes a position contradicting an active research thesis, this is acceptable — different timeframes can have opposing views
- CEO periodically reviews overall exposure across both desks (research `holdings` + trading `intraday_positions`) for total portfolio risk awareness

### New skills for CEO

- Add `portfolio-context` skill (already used by Risk Manager, now CEO needs cross-desk portfolio view)
- Add `projectx` skill (for portfolio awareness of futures positions)

---

## Existing Skill Modifications

### `alpha-vantage/SKILL.md`

- Add EOD options endpoints (`HISTORICAL_OPTIONS`) — note EOD-only limitation, weeklies+ minimum
- Add crypto intraday endpoints (`CRYPTO_INTRADAY`)
- Update budget guidance: remove 25/day free tier references, document 150 req/min premium tier
- Update cache TTLs: GLOBAL_QUOTE -> 5 min, INTRADAY -> 5 min, options chain -> 60 min (EOD)
- Rename "ClawTeam Capital" to "Zigs Capital"

### `neon-memory/SKILL.md`

- Add 5 Phase 1 tables (desk_runs, desk_findings, trade_signals, setups, intraday_positions)
- Add 3 Phase 1 views (v_active_signals, v_desk_performance, v_open_intraday)
- Add trading desk query patterns
- Add `px_requests_used` budget tracking column documentation
- Extend append-only rules to `desk_findings`, `trade_signals`, `intraday_positions`
- Rename "ClawTeam Capital" to "Zigs Capital"

### `portfolio-context/SKILL.md`

- Add cross-desk portfolio queries (combined research holdings + intraday positions)
- Add intraday-specific portfolio heat calculation
- Add futures position awareness (margin, contract value)
- Add correlation queries across both desks' positions

### `notion-publish/SKILL.md`

- Replace flat workspace structure with explicit hierarchy: `Zigs Capital` → `Research Desk` + `Zigs Capital Trading Desk` container pages → databases under each
- Add Trading Desk Signals database (16 properties) under `Zigs Capital Trading Desk` container
- Add Trading Desk Positions Log database (11 properties) under `Zigs Capital Trading Desk` container
- Move existing Research Memos, Watchlist, Decision Log under `Research Desk` container
- Add operating rules: publish into databases only (never loose pages), resolve by stored ID or exact-name lookup (never create ad hoc)
- Add "Do not publish intermediate desk analyst findings — only Head Trader-synthesized output"
- Update Portfolio Dashboard to include trading desk section
- Rename "ClawTeam Capital" to "Zigs Capital"

### `exa-search/SKILL.md`

- Rename "ClawTeam Capital" to "Zigs Capital" (no functional changes)

### `luxalgo/SKILL.md`

- Rename "ClawTeam Capital" to "Zigs Capital" (no functional changes)

---

## File Changes Summary

### New files to create

| File | Purpose |
|------|---------|
| `agents/head-trader/AGENTS.md` | Head Trader agent definition |
| `agents/chart-strategist/AGENTS.md` | Chart Strategist agent definition |
| `agents/quant-analyst/AGENTS.md` | Quant Analyst agent definition |
| `agents/desk-risk-manager/AGENTS.md` | Desk Risk Manager agent definition |
| `skills/trade-signal/SKILL.md` | Trade signal output skill |
| `skills/setup-report/SKILL.md` | Setup report template skill |
| `skills/quant-toolkit/SKILL.md` | Quantitative analysis skill |
| `skills/projectx/SKILL.md` | ProjectX futures data skill |

### Existing files to modify

| File | Changes |
|------|---------|
| `agents/ceo/AGENTS.md` | Add trading desk oversight + cross-desk coordination; add portfolio-context + projectx skills |
| `skills/alpha-vantage/SKILL.md` | Add EOD options, crypto intraday, update budget, rename to Zigs Capital |
| `skills/neon-memory/SKILL.md` | Add Phase 1 tables/views/queries, rename to Zigs Capital |
| `skills/portfolio-context/SKILL.md` | Add cross-desk + futures queries |
| `skills/notion-publish/SKILL.md` | Add trading desk databases + publishing workflow, rename to Zigs Capital |
| `skills/exa-search/SKILL.md` | Rename to Zigs Capital |
| `skills/luxalgo/SKILL.md` | Rename to Zigs Capital |
| `.paperclip.yaml` | Rename comment to Zigs Capital (line 4) |

### Database migrations (run on Mac Mini against Neon)

- Create Phase 1 tables: `desk_runs`, `desk_findings`, `trade_signals`, `setups`, `intraday_positions`
- Create Phase 1 views: `v_active_signals`, `v_desk_performance`, `v_open_intraday`

---

## Preflight Checklist (Mac Mini)

Before provisioning the trading desk runtime, verify these external dependencies on the Mac Mini:

### 1. Alpha Vantage Premium Access
```bash
# Verify premium tier (should return real-time data, not "Thank you for using Alpha Vantage! Our standard API rate limit...")
curl "https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=AAPL&interval=5min&apikey=$ALPHA_VANTAGE_API_KEY&outputsize=compact"
# Verify options endpoint access
curl "https://www.alphavantage.co/query?function=HISTORICAL_OPTIONS&symbol=AAPL&apikey=$ALPHA_VANTAGE_API_KEY"
# Verify crypto endpoint access
curl "https://www.alphavantage.co/query?function=CRYPTO_INTRADAY&symbol=BTC&market=USD&interval=5min&apikey=$ALPHA_VANTAGE_API_KEY"
```

### 2. ProjectX API Availability
```bash
# Verify Python SDK installed
pip show project-x-py  # should show v3.5.9+
# Verify API key works (basic connectivity test via Python)
python3 -c "
from projectx import TradingSuite
import asyncio
async def test():
    suite = TradingSuite(api_key='$PROJECTX_API_KEY')
    # Minimal connectivity check
    print('ProjectX SDK loaded, version:', suite.__class__.__module__)
asyncio.run(test())
"
```

### 3. Neon Database Connectivity
```bash
# Verify connection and existing schema
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM tickers;"
# Verify migrations haven't already been applied
psql "$DATABASE_URL" -c "SELECT EXISTS(SELECT FROM information_schema.tables WHERE table_name = 'trade_signals');"
# Should return 'f' (false) before migration
```

### 4. Notion Workspace Readiness
- Verify NOTION_API_KEY has access to the workspace
- Verify `Zigs Capital`, `Research Desk`, `Research Memos`, `Zigs Capital Trading Desk`, `Trading Desk Signals`, and `Trading Desk Positions Log` all exist and are accessible
- Verify `Portfolio Dashboard` if it is part of the workspace
- Create only the missing objects and record the final page/database IDs for runtime lookup

### 5. Paperclip Instance
- Verify the Zigs Capital company exists on the Mac Mini Paperclip instance
- Verify existing research desk agents are running correctly
- Verify skill import mechanism works (`POST /api/companies/{companyId}/skills/import` or CLI)

---

## Mac Mini Runtime Setup

After authoring is complete on the laptop and files are synced to the Mac Mini:

1. **Run schema migration** against Neon (create Phase 1 tables + views)
2. **Import updated skills** — scan project for skill changes, import new + modified skills via Paperclip
3. **Create 4 new agents** in Paperclip:
   - Head Trader (codex_local, codex-mini) — reports to CEO
   - Chart Strategist (opencode_local) — reports to Head Trader
   - Quant Analyst (opencode_local) — reports to Head Trader
   - Desk Risk Manager (codex_local, codex-mini) — reports to Head Trader
4. **Configure secrets** for each new agent: `ALPHA_VANTAGE_API_KEY`, `DATABASE_URL`, `PROJECTX_API_KEY`, plus `NOTION_API_KEY` for Head Trader
5. **Sync skills to agents** — assign each agent their specific skill set via `POST /api/agents/{agentId}/skills/sync`
6. **Verify and store Notion hierarchy IDs** — confirm `Zigs Capital`, `Research Desk`, `Research Memos`, `Zigs Capital Trading Desk`, `Trading Desk Signals`, and `Trading Desk Positions Log`; create only missing objects and record their final IDs for lookup
7. **Smoke test** — create a test issue assigned to Head Trader, verify the end-to-end flow

---

## Known Limitations and Future Considerations

1. **LuxAlgo placeholder:** Until implemented, Chart Strategist computes indicators from raw AV/ProjectX price data. ProjectX's 59+ built-in indicators partially fill this gap for futures.

2. **Heartbeat latency:** Full analyst delegation takes multiple heartbeat cycles. The Head Trader's fast path mitigates this for time-sensitive setups.

3. **EOD options data only:** Alpha Vantage premium provides end-of-day options chain data. 0DTE is not feasible. Minimum viable options timeframe is weeklies. Real-time options flow would require Unusual Whales or similar in the future.

4. **No flow analysis:** Advanced flow data (dark pool, unusual options activity, sweep orders) requires Unusual Whales or FlowAlgo. May add as a future data source + reintroduce Flow Analyst.

5. **ProjectX third-party wind-down:** ProjectX has been winding down third-party service for some partners (through Feb 2026). Verify access stability. If ProjectX becomes unavailable, futures data would need an alternative source (Databento, CQG direct, etc.).

6. **Advisory-only in Phase 1:** No order execution, no broker integration. Position tracking is manually entered fills. Performance metrics reflect reported trades, not theoretical outcomes.

7. **Skills are company-level:** All agents see all skills. AGENTS.md controls usage; no enforcement boundary.

8. **Phase 2 deferred:** Scheduled scans, watchlist monitoring, and automated features come after Phase 1 smoke testing.

---

## Verification Plan (Phase 1)

1. **Preflight:** All 5 dependency checks pass on Mac Mini (AV premium, ProjectX, Neon, Notion, Paperclip)
2. **Agent registration:** All 4 new agents appear in Paperclip with correct adapter config, reporting hierarchy, and skill assignments
3. **Schema migration:** Phase 1 tables and views exist in Neon
4. **Skill loading:** New skills (trade-signal, setup-report, quant-toolkit, projectx) imported and visible
5. **Notion hierarchy:** `Zigs Capital` contains `Research Desk` with `Research Memos` and `Zigs Capital Trading Desk` with `Trading Desk Signals` + `Trading Desk Positions Log`; all required page/database IDs are stored for lookup
6. **On-demand equity flow:** Create test issue for equity ticker -> Head Trader delegates -> analysts write findings -> signal produced -> published to Notion
7. **On-demand futures flow:** Create test issue for ES futures -> ProjectX data retrieved -> signal generated
8. **Fast path:** Create test issue with "fast path" -> Head Trader generates signal solo
9. **Position recording:** Report a fill via issue comment -> Head Trader records in intraday_positions -> position visible in v_open_intraday
10. **CEO cross-desk visibility:** CEO can query v_active_signals and v_open_intraday
11. **Naming consistency:** No remaining "ClawTeam Capital" references in any skill or agent file
