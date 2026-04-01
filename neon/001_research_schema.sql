-- ============================================================
-- Paperclip Investment Research Company — Neon Schema
-- ============================================================
-- System of record for the research company's shared memory.
-- All agents read/write this database via Neon skills.
-- Designed for Neon Postgres (standard PG, no extensions required).
--
-- Tables:
--   tickers           Master ticker registry with metadata
--   watchlist          Monitoring configuration per ticker
--   holdings           Portfolio positions (shares + LEAPs)
--   tool_cache         Cached API responses with TTL
--   research_runs      Research session metadata and budget tracking
--   research_findings  Individual analyst outputs (normalized)
--   theses             Versioned investment theses with price targets
--   signals            Alerts, setups, invalidations, events
--   market_snapshots   Market-wide context captures
--   decisions          Human decision audit trail
-- ============================================================

-- ---- TICKERS ------------------------------------------------
-- Master registry. Source of truth for ticker metadata.
-- Agents enrich this on first encounter via AV.GetFundamentalSnapshot.

CREATE TABLE tickers (
    symbol          VARCHAR(10) PRIMARY KEY,
    name            VARCHAR(255),
    exchange        VARCHAR(20),
    sector          VARCHAR(100),
    industry        VARCHAR(150),
    market_cap      BIGINT,                     -- raw market cap in USD
    description     TEXT,                        -- company description from AV overview
    last_enriched   TIMESTAMPTZ,                -- when metadata was last refreshed
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ---- WATCHLIST ----------------------------------------------
-- Which tickers the company is actively monitoring.
-- Controls heartbeat behavior: monitoring_mode drives budget allocation.

CREATE TABLE watchlist (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol              VARCHAR(10) NOT NULL REFERENCES tickers(symbol),
    status              VARCHAR(20) DEFAULT 'active'
                        CHECK (status IN ('active', 'paused', 'archived')),
    monitoring_mode     VARCHAR(20) DEFAULT 'standard'
                        CHECK (monitoring_mode IN ('lean', 'standard', 'deep')),
    monitoring_interval INT DEFAULT 60,          -- minutes between checks
    priority            VARCHAR(10) DEFAULT 'medium'
                        CHECK (priority IN ('critical', 'high', 'medium', 'low')),
    reason              TEXT,                    -- why this ticker is on the watchlist
    added_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (symbol)                              -- one entry per ticker
);

-- ---- HOLDINGS -----------------------------------------------
-- Portfolio positions. Manually entered after user executes trades.
-- Agents query this to make research position-aware.
-- Supports shares and LEAP option contracts.

CREATE TABLE holdings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol              VARCHAR(10) NOT NULL REFERENCES tickers(symbol),
    instrument_type     VARCHAR(20) NOT NULL
                        CHECK (instrument_type IN (
                            'shares', 'leap_call', 'leap_put',
                            'call', 'put'
                        )),
    -- Position details
    quantity            DECIMAL(12,4) NOT NULL,  -- shares or contracts
    entry_price         DECIMAL(12,4) NOT NULL,  -- per share or per contract
    entry_date          DATE NOT NULL,
    -- Options-specific (NULL for shares)
    strike_price        DECIMAL(12,4),
    expiration_date     DATE,
    contract_multiplier INT DEFAULT 100,
    -- Context
    thesis_id           UUID,                    -- FK added after theses table
    broker              VARCHAR(50),
    account_label       VARCHAR(50),             -- e.g. "Roth IRA", "Taxable"
    notes               TEXT,
    -- Lifecycle
    status              VARCHAR(20) DEFAULT 'open'
                        CHECK (status IN ('open', 'closed', 'partial')),
    exit_price          DECIMAL(12,4),
    exit_date           DATE,
    realized_pnl        DECIMAL(14,4),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ---- TOOL CACHE ---------------------------------------------
-- Cached API responses with TTL-based expiration.
-- Every tool skill checks here before making an external request.
-- Cache key = deterministic hash of (tool + endpoint + params).

CREATE TABLE tool_cache (
    cache_key       VARCHAR(500) PRIMARY KEY,    -- sha256(tool|endpoint|sorted_params)
    tool            VARCHAR(50) NOT NULL         -- alpha_vantage, perplexity, luxalgo
                    CHECK (tool IN ('alpha_vantage', 'perplexity', 'luxalgo')),
    endpoint        VARCHAR(200) NOT NULL,       -- e.g. TIME_SERIES_DAILY, OVERVIEW
    symbol          VARCHAR(10),                 -- NULL for non-ticker-specific calls
    request_params  JSONB NOT NULL,              -- original request parameters
    response_data   JSONB NOT NULL,              -- full normalized response
    fetched_at      TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,        -- skill sets TTL per data type
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ---- RESEARCH RUNS ------------------------------------------
-- A research session: one or more tickers investigated together.
-- Links to Paperclip issue for traceability.
-- Tracks budget consumption across tools.

CREATE TABLE research_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paperclip_issue_id  VARCHAR(100),            -- Paperclip issue identifier
    run_type            VARCHAR(30) NOT NULL
                        CHECK (run_type IN (
                            'deep_dive', 'monitoring_check', 'post_event',
                            'daily_brief', 'thesis_review', 'ad_hoc'
                        )),
    budget_mode         VARCHAR(20) DEFAULT 'standard'
                        CHECK (budget_mode IN ('lean', 'standard', 'deep')),
    symbols             VARCHAR(10)[] NOT NULL,   -- tickers under investigation
    status              VARCHAR(20) DEFAULT 'in_progress'
                        CHECK (status IN (
                            'in_progress', 'completed', 'partial', 'failed'
                        )),
    initiated_by        VARCHAR(100),            -- agent ID or 'user'
    -- Budget tracking
    av_requests_used    INT DEFAULT 0,
    px_requests_used    INT DEFAULT 0,
    lx_requests_used    INT DEFAULT 0,
    av_cache_hits       INT DEFAULT 0,           -- how many AV calls were served from cache
    -- Timing
    started_at          TIMESTAMPTZ DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    -- Output
    summary             TEXT,                    -- CEO synthesis (markdown)
    action_recommendation VARCHAR(30)
                        CHECK (action_recommendation IN (
                            'buy', 'sell', 'hold', 'add', 'trim',
                            'watch', 'research_more', 'avoid', NULL
                        )),
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ---- RESEARCH FINDINGS --------------------------------------
-- Individual analyst outputs. The core unit of shared knowledge.
-- Each finding is attributed to an analyst role and research run.
-- Structured data stored in JSONB for role-specific metrics.

CREATE TABLE research_findings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    research_run_id     UUID REFERENCES research_runs(id),
    symbol              VARCHAR(10) NOT NULL REFERENCES tickers(symbol),
    -- Attribution
    analyst_role        VARCHAR(30) NOT NULL
                        CHECK (analyst_role IN (
                            'fundamentals', 'buffett', 'growth',
                            'sentiment', 'technical', 'risk', 'ceo'
                        )),
    agent_id            VARCHAR(100),            -- Paperclip agent ID
    -- Content
    finding_type        VARCHAR(50) NOT NULL,     -- e.g. financial_summary, quality_assessment,
                                                  -- growth_signal, sentiment_shift, technical_setup,
                                                  -- risk_flag, catalyst, narrative_conflict
    title               VARCHAR(255) NOT NULL,
    body                TEXT NOT NULL,            -- markdown content
    -- Assessment
    confidence          DECIMAL(3,2)             -- 0.00 to 1.00
                        CHECK (confidence BETWEEN 0 AND 1),
    sentiment           VARCHAR(10)
                        CHECK (sentiment IN ('bullish', 'bearish', 'neutral', 'mixed')),
    is_material         BOOLEAN DEFAULT FALSE,   -- warrants escalation to CEO
    -- Structured output (role-specific)
    -- Examples:
    --   fundamentals: { revenue_growth: 0.12, pe_ratio: 25.3, debt_to_equity: 0.8 }
    --   technical:    { setup_type: "breakout", entry: 150, stop: 142, target: 175 }
    --   risk:         { max_drawdown: -0.15, beta: 1.3, correlation_spy: 0.85 }
    structured_data     JSONB,
    -- Provenance
    data_sources        JSONB,                   -- array of { tool, endpoint, cache_key }
    supersedes_id       UUID REFERENCES research_findings(id),
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ---- THESES -------------------------------------------------
-- Versioned investment theses. The core output of the research company.
-- Each thesis has price targets and timeframes — the input you need
-- to manually select strikes and execute trades.

CREATE TABLE theses (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol                  VARCHAR(10) NOT NULL REFERENCES tickers(symbol),
    version                 INT NOT NULL DEFAULT 1,
    thesis_type             VARCHAR(20) NOT NULL
                            CHECK (thesis_type IN ('bull', 'base', 'bear', 'trade')),
    status                  VARCHAR(20) DEFAULT 'active'
                            CHECK (status IN (
                                'active', 'invalidated', 'expired', 'realized'
                            )),
    -- Core thesis
    title                   VARCHAR(255) NOT NULL,
    summary                 TEXT NOT NULL,        -- markdown
    conviction              VARCHAR(10)
                            CHECK (conviction IN ('high', 'medium', 'low')),
    -- Price targets (the key output for trade decisions)
    current_price_at_creation DECIMAL(12,4),
    price_target_bull       DECIMAL(12,4),
    price_target_base       DECIMAL(12,4),
    price_target_bear       DECIMAL(12,4),
    -- Time frames (the other key output for LEAP selection)
    time_horizon            VARCHAR(20)
                            CHECK (time_horizon IN (
                                'days', 'weeks', '1_month', '3_months',
                                '6_months', '12_months', '18_months'
                            )),
    target_date             DATE,                 -- when the thesis should play out
    review_by_date          DATE,                 -- when to re-evaluate
    -- Evidence and reasoning
    key_assumptions         TEXT,                  -- what must be true
    invalidation_criteria   TEXT,                  -- what would prove this wrong
    disconfirming_evidence  TEXT,                  -- known counter-arguments
    supporting_finding_ids  UUID[],               -- references to research_findings
    -- Risk assessment
    risk_rating             VARCHAR(10)
                            CHECK (risk_rating IN ('high', 'medium', 'low')),
    max_loss_scenario       TEXT,
    -- Versioning
    previous_version_id     UUID REFERENCES theses(id),
    research_run_id         UUID REFERENCES research_runs(id),
    created_by              VARCHAR(100),          -- agent ID or 'user'
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    -- Lifecycle
    invalidated_at          TIMESTAMPTZ,
    invalidation_reason     TEXT,
    realized_at             TIMESTAMPTZ,
    realized_notes          TEXT,

    UNIQUE (symbol, version, thesis_type)
);

-- Now add the FK from holdings to theses
ALTER TABLE holdings
    ADD CONSTRAINT fk_holdings_thesis
    FOREIGN KEY (thesis_id) REFERENCES theses(id);

-- ---- SIGNALS ------------------------------------------------
-- Events that demand attention: technical setups hitting,
-- thesis invalidation triggers firing, earnings surprises,
-- narrative regime shifts, price target breaches.

CREATE TABLE signals (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol              VARCHAR(10) NOT NULL REFERENCES tickers(symbol),
    signal_type         VARCHAR(50) NOT NULL,     -- technical_setup, thesis_invalidation,
                                                  -- earnings_surprise, narrative_shift,
                                                  -- price_target_hit, stop_loss_breach,
                                                  -- catalyst_approaching, unusual_volume
    severity            VARCHAR(10) DEFAULT 'info'
                        CHECK (severity IN ('critical', 'warning', 'info')),
    title               VARCHAR(255) NOT NULL,
    description         TEXT,
    -- Links
    thesis_id           UUID REFERENCES theses(id),
    finding_id          UUID REFERENCES research_findings(id),
    triggered_by        VARCHAR(100),            -- agent ID
    -- Context
    conditions          JSONB,                   -- what triggered this signal
    current_price       DECIMAL(12,4),           -- price at signal time
    -- Lifecycle
    is_acknowledged     BOOLEAN DEFAULT FALSE,
    acknowledged_at     TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ---- MARKET SNAPSHOTS ---------------------------------------
-- Periodic captures of market-wide context.
-- Used by Risk Manager and CEO for regime awareness.
-- Agents compare current snapshot to prior ones for change detection.

CREATE TABLE market_snapshots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_type   VARCHAR(30) NOT NULL
                    CHECK (snapshot_type IN (
                        'pre_market', 'market_open', 'midday',
                        'market_close', 'after_hours', 'macro_update'
                    )),
    -- Structured market data
    -- { spy: { price, change_pct }, vix: 18.5, sectors: {...},
    --   top_gainers: [...], top_losers: [...], economic_events: [...] }
    data            JSONB NOT NULL,
    captured_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ---- DECISIONS ----------------------------------------------
-- Audit trail of human decisions based on research output.
-- Closes the loop: research → thesis → decision → holding.

CREATE TABLE decisions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol              VARCHAR(10) REFERENCES tickers(symbol),
    decision_type       VARCHAR(20) NOT NULL
                        CHECK (decision_type IN (
                            'buy', 'sell', 'hold', 'add', 'trim',
                            'watch', 'pass', 'close'
                        )),
    -- Links back to research
    thesis_id           UUID REFERENCES theses(id),
    research_run_id     UUID REFERENCES research_runs(id),
    holding_id          UUID REFERENCES holdings(id),
    -- Content
    rationale           TEXT NOT NULL,            -- why this decision was made
    -- Metadata
    decided_by          VARCHAR(100) DEFAULT 'user',
    decided_at          TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- INDEXES
-- ============================================================

-- Cache: fast lookup by key, cleanup by expiration, filter by ticker
CREATE INDEX idx_cache_expires ON tool_cache (expires_at);
CREATE INDEX idx_cache_tool_symbol ON tool_cache (tool, symbol);

-- Findings: query by ticker, run, analyst role, materiality
CREATE INDEX idx_findings_symbol ON research_findings (symbol);
CREATE INDEX idx_findings_run ON research_findings (research_run_id);
CREATE INDEX idx_findings_analyst ON research_findings (analyst_role);
CREATE INDEX idx_findings_material ON research_findings (symbol, is_material)
    WHERE is_material = TRUE;
CREATE INDEX idx_findings_created ON research_findings (created_at DESC);

-- Theses: active theses per ticker, version lookup
CREATE INDEX idx_theses_symbol_active ON theses (symbol, status)
    WHERE status = 'active';
CREATE INDEX idx_theses_review ON theses (review_by_date)
    WHERE status = 'active';

-- Holdings: open positions, positions by ticker
CREATE INDEX idx_holdings_open ON holdings (symbol, status)
    WHERE status = 'open';
CREATE INDEX idx_holdings_thesis ON holdings (thesis_id);

-- Signals: unacknowledged, by severity, by ticker
CREATE INDEX idx_signals_unacked ON signals (severity, created_at DESC)
    WHERE is_acknowledged = FALSE;
CREATE INDEX idx_signals_symbol ON signals (symbol, created_at DESC);

-- Watchlist: active monitoring targets
CREATE INDEX idx_watchlist_active ON watchlist (status, priority)
    WHERE status = 'active';

-- Research runs: recent runs, by status
CREATE INDEX idx_runs_recent ON research_runs (started_at DESC);
CREATE INDEX idx_runs_status ON research_runs (status)
    WHERE status = 'in_progress';

-- Market snapshots: recent captures
CREATE INDEX idx_snapshots_recent ON market_snapshots (captured_at DESC);

-- Decisions: by ticker and time
CREATE INDEX idx_decisions_symbol ON decisions (symbol, decided_at DESC);


-- ============================================================
-- HELPER VIEWS
-- ============================================================

-- Current portfolio: open holdings with unrealized P&L placeholder.
-- Agents join this with live price data to compute actual P&L.
CREATE VIEW v_open_positions AS
SELECT
    h.id,
    h.symbol,
    h.instrument_type,
    h.quantity,
    h.entry_price,
    h.entry_date,
    h.strike_price,
    h.expiration_date,
    h.contract_multiplier,
    h.account_label,
    h.thesis_id,
    t.title AS thesis_title,
    t.conviction,
    t.price_target_base,
    t.status AS thesis_status,
    t.invalidation_criteria,
    h.notes
FROM holdings h
LEFT JOIN theses t ON h.thesis_id = t.id
WHERE h.status = 'open'
ORDER BY h.entry_date DESC;

-- Active watchlist with latest thesis info
CREATE VIEW v_active_watchlist AS
SELECT
    w.symbol,
    w.monitoring_mode,
    w.monitoring_interval,
    w.priority,
    w.reason,
    tk.name AS company_name,
    tk.sector,
    -- Latest active thesis
    latest_thesis.title AS current_thesis,
    latest_thesis.conviction,
    latest_thesis.thesis_type,
    latest_thesis.price_target_base,
    latest_thesis.time_horizon,
    latest_thesis.review_by_date,
    -- Has open position?
    EXISTS (
        SELECT 1 FROM holdings h
        WHERE h.symbol = w.symbol AND h.status = 'open'
    ) AS has_open_position
FROM watchlist w
JOIN tickers tk ON w.symbol = tk.symbol
LEFT JOIN LATERAL (
    SELECT * FROM theses th
    WHERE th.symbol = w.symbol AND th.status = 'active'
    ORDER BY th.version DESC
    LIMIT 1
) latest_thesis ON TRUE
WHERE w.status = 'active'
ORDER BY w.priority, w.symbol;

-- Unacknowledged signals requiring attention
CREATE VIEW v_pending_signals AS
SELECT
    s.id,
    s.symbol,
    s.signal_type,
    s.severity,
    s.title,
    s.description,
    s.current_price,
    s.conditions,
    s.created_at,
    -- Is there an open position on this ticker?
    EXISTS (
        SELECT 1 FROM holdings h
        WHERE h.symbol = s.symbol AND h.status = 'open'
    ) AS has_open_position,
    -- Active thesis info
    t.title AS thesis_title,
    t.conviction
FROM signals s
LEFT JOIN theses t ON s.thesis_id = t.id
WHERE s.is_acknowledged = FALSE
ORDER BY
    CASE s.severity
        WHEN 'critical' THEN 1
        WHEN 'warning' THEN 2
        ELSE 3
    END,
    s.created_at DESC;

-- Research activity summary: recent runs with finding counts
CREATE VIEW v_recent_research AS
SELECT
    r.id,
    r.run_type,
    r.budget_mode,
    r.symbols,
    r.status,
    r.started_at,
    r.completed_at,
    r.av_requests_used,
    r.px_requests_used,
    r.av_cache_hits,
    r.action_recommendation,
    (SELECT COUNT(*) FROM research_findings f WHERE f.research_run_id = r.id) AS finding_count,
    (SELECT COUNT(*) FROM research_findings f
     WHERE f.research_run_id = r.id AND f.is_material = TRUE) AS material_finding_count
FROM research_runs r
ORDER BY r.started_at DESC
LIMIT 50;


-- ============================================================
-- CACHE TTL HELPER
-- ============================================================

-- Function to clean expired cache entries.
-- Run periodically or before cache lookups.
CREATE OR REPLACE FUNCTION clean_expired_cache()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM tool_cache WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- SUGGESTED TTL POLICY (reference, not enforced in schema)
-- ============================================================
-- Alpha Vantage endpoints:
--   OVERVIEW:              24 hours (company metadata is stable)
--   INCOME_STATEMENT:      24 hours (quarterly, rarely changes intra-day)
--   BALANCE_SHEET:         24 hours
--   CASH_FLOW:             24 hours
--   EARNINGS:              12 hours (more sensitive around earnings dates)
--   TIME_SERIES_DAILY:     4 hours  (refreshes after market close)
--   TIME_SERIES_INTRADAY:  15 min   (real-time-ish)
--   GLOBAL_QUOTE:          5 min    (current price)
--   NEWS_SENTIMENT:        1 hour   (changes moderately)
--   TOP_GAINERS_LOSERS:    30 min
--   ECONOMIC_INDICATORS:   24 hours
--
-- Perplexity queries:
--   Narrative/catalyst:    2 hours  (news cycle moves)
--   Bull/bear comparison:  6 hours  (narratives shift slowly)
--   Source packs:          4 hours
--
-- LuxAlgo:
--   Strategy specs:        24 hours (derived from thesis, not volatile)
--   Indicator specs:       24 hours
