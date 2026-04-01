-- ============================================================
-- Zigs Capital Trading Desk — Phase 1 Neon Schema Additions
-- ============================================================
-- Apply after 001_research_schema.sql.
-- Phase 1 is advisory-only: signals and setup reports are produced by
-- agents, while intraday_positions reflects manually entered actual fills.
-- ============================================================

-- ---- DESK RUNS ----------------------------------------------

CREATE TABLE IF NOT EXISTS desk_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paperclip_issue_id  VARCHAR(100),
    run_type            VARCHAR(30) NOT NULL
                        CHECK (run_type IN ('on_demand', 'scheduled_scan', 'watchlist_alert')),
    symbols             VARCHAR(32)[] NOT NULL,
    initiated_by        VARCHAR(100),
    av_requests_used    INT DEFAULT 0,
    exa_requests_used   INT DEFAULT 0,
    lx_requests_used    INT DEFAULT 0,
    px_requests_used    INT DEFAULT 0,
    av_cache_hits       INT DEFAULT 0,
    status              VARCHAR(20) DEFAULT 'running'
                        CHECK (status IN ('running', 'completed', 'failed')),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    completed_at        TIMESTAMPTZ
);

-- ---- DESK FINDINGS ------------------------------------------

CREATE TABLE IF NOT EXISTS desk_findings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    desk_run_id         UUID NOT NULL REFERENCES desk_runs(id),
    symbol              VARCHAR(32) NOT NULL,
    analyst_role        VARCHAR(30) NOT NULL
                        CHECK (analyst_role IN ('chart_strategist', 'quant_analyst', 'desk_risk_manager')),
    agent_id            VARCHAR(100),
    finding_type        VARCHAR(50) NOT NULL
                        CHECK (finding_type IN ('technical_analysis', 'quant_analysis', 'risk_assessment')),
    title               VARCHAR(255) NOT NULL,
    body                TEXT NOT NULL,
    confidence          VARCHAR(10)
                        CHECK (confidence IN ('high', 'medium', 'low')),
    direction           VARCHAR(10)
                        CHECK (direction IN ('bullish', 'bearish', 'neutral')),
    structured_data     JSONB,
    data_sources        TEXT[],
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ---- SETUPS -------------------------------------------------

CREATE TABLE IF NOT EXISTS setups (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol              VARCHAR(32) NOT NULL,
    direction           VARCHAR(10) NOT NULL
                        CHECK (direction IN ('long', 'short')),
    instrument_type     VARCHAR(20) NOT NULL
                        CHECK (instrument_type IN ('equity', 'option', 'crypto', 'future')),
    setup_type          VARCHAR(30) NOT NULL
                        CHECK (setup_type IN ('breakout', 'breakdown', 'reversal', 'momentum', 'mean_reversion')),
    summary             TEXT NOT NULL,
    technical_context   JSONB NOT NULL,
    quant_context       JSONB,
    risk_context        JSONB NOT NULL,
    research_context    JSONB,
    entry_zone          JSONB NOT NULL,
    stop_price          DECIMAL(18,8) NOT NULL,
    targets             JSONB NOT NULL,
    position_size       JSONB NOT NULL,
    timeframe           VARCHAR(20) NOT NULL
                        CHECK (timeframe IN ('intraday', 'swing')),
    confidence          VARCHAR(10)
                        CHECK (confidence IN ('high', 'medium', 'low')),
    research_thesis_id  UUID REFERENCES theses(id),
    desk_run_id         UUID NOT NULL REFERENCES desk_runs(id),
    status              VARCHAR(20) DEFAULT 'active'
                        CHECK (status IN ('active', 'triggered', 'stopped', 'target_hit', 'expired')),
    expires_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ---- TRADE SIGNALS ------------------------------------------

CREATE TABLE IF NOT EXISTS trade_signals (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol              VARCHAR(32) NOT NULL,
    direction           VARCHAR(10) NOT NULL
                        CHECK (direction IN ('long', 'short')),
    instrument_type     VARCHAR(20) NOT NULL
                        CHECK (instrument_type IN ('equity', 'option', 'crypto', 'future')),
    signal_type         VARCHAR(30) NOT NULL
                        CHECK (signal_type IN ('breakout', 'breakdown', 'reversal', 'momentum', 'mean_reversion')),
    entry_price         DECIMAL(18,8) NOT NULL,
    entry_zone_low      DECIMAL(18,8),
    entry_zone_high     DECIMAL(18,8),
    stop_price          DECIMAL(18,8) NOT NULL,
    target_1            DECIMAL(18,8) NOT NULL,
    target_2            DECIMAL(18,8),
    target_3            DECIMAL(18,8),
    timeframe           VARCHAR(20) NOT NULL
                        CHECK (timeframe IN ('intraday', 'swing')),
    confidence          VARCHAR(10)
                        CHECK (confidence IN ('high', 'medium', 'low')),
    confluence_score    INT NOT NULL DEFAULT 0
                        CHECK (confluence_score BETWEEN 0 AND 3),
    fast_path           BOOLEAN DEFAULT FALSE,
    contract_spec       JSONB,
    crypto_spec         JSONB,
    setup_id            UUID REFERENCES setups(id),
    desk_run_id         UUID NOT NULL REFERENCES desk_runs(id),
    research_thesis_id  UUID REFERENCES theses(id),
    status              VARCHAR(20) DEFAULT 'active'
                        CHECK (status IN ('active', 'triggered', 'stopped', 'target_hit', 'expired', 'cancelled')),
    expires_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ---- INTRADAY POSITIONS ------------------------------------

CREATE TABLE IF NOT EXISTS intraday_positions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol              VARCHAR(32) NOT NULL,
    direction           VARCHAR(10) NOT NULL
                        CHECK (direction IN ('long', 'short')),
    instrument_type     VARCHAR(20) NOT NULL
                        CHECK (instrument_type IN ('equity', 'option', 'crypto', 'future')),
    contract_spec       JSONB,
    entry_price         DECIMAL(18,8) NOT NULL,
    entry_time          TIMESTAMPTZ NOT NULL,
    size                DECIMAL(18,8) NOT NULL,
    stop_price          DECIMAL(18,8) NOT NULL,
    target_price        DECIMAL(18,8) NOT NULL,
    exit_price          DECIMAL(18,8),
    exit_time           TIMESTAMPTZ,
    exit_reason         VARCHAR(20)
                        CHECK (exit_reason IN ('target_hit', 'stopped', 'time_stop', 'manual', 'expired') OR exit_reason IS NULL),
    pnl                 DECIMAL(18,8),
    pnl_pct             DECIMAL(18,8),
    r_multiple          DECIMAL(18,8),
    signal_id           UUID NOT NULL REFERENCES trade_signals(id),
    status              VARCHAR(20) DEFAULT 'open'
                        CHECK (status IN ('open', 'closed')),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ---- INDEXES -----------------------------------------------

CREATE INDEX IF NOT EXISTS idx_desk_runs_issue_id
    ON desk_runs (paperclip_issue_id);

CREATE INDEX IF NOT EXISTS idx_desk_runs_status
    ON desk_runs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_desk_findings_run_symbol
    ON desk_findings (desk_run_id, symbol);

CREATE INDEX IF NOT EXISTS idx_desk_findings_role
    ON desk_findings (analyst_role, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_setups_run_symbol
    ON setups (desk_run_id, symbol);

CREATE INDEX IF NOT EXISTS idx_setups_status
    ON setups (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_trade_signals_symbol_status
    ON trade_signals (symbol, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_signals_run_id
    ON trade_signals (desk_run_id);

CREATE INDEX IF NOT EXISTS idx_trade_signals_expires
    ON trade_signals (expires_at);

CREATE INDEX IF NOT EXISTS idx_intraday_positions_signal
    ON intraday_positions (signal_id);

CREATE INDEX IF NOT EXISTS idx_intraday_positions_status
    ON intraday_positions (status, entry_time DESC);

CREATE INDEX IF NOT EXISTS idx_intraday_positions_symbol
    ON intraday_positions (symbol, status);

-- ---- VIEWS -------------------------------------------------

DROP VIEW IF EXISTS v_active_signals;
CREATE VIEW v_active_signals AS
SELECT *
FROM trade_signals
WHERE status = 'active'
  AND (expires_at IS NULL OR expires_at > NOW())
ORDER BY created_at DESC;

DROP VIEW IF EXISTS v_desk_performance;
CREATE VIEW v_desk_performance AS
SELECT
    instrument_type,
    direction,
    COUNT(*) AS total_trades,
    COUNT(*) FILTER (WHERE pnl > 0) AS wins,
    COUNT(*) FILTER (WHERE pnl <= 0) AS losses,
    ROUND(
        COUNT(*) FILTER (WHERE pnl > 0)::numeric / NULLIF(COUNT(*), 0) * 100,
        1
    ) AS win_rate_pct,
    ROUND(AVG(r_multiple)::numeric, 2) AS avg_r_multiple,
    ROUND(SUM(pnl)::numeric, 2) AS total_pnl
FROM intraday_positions
WHERE status = 'closed'
GROUP BY instrument_type, direction;

DROP VIEW IF EXISTS v_open_intraday;
CREATE VIEW v_open_intraday AS
SELECT
    ip.*,
    ts.confluence_score,
    ts.fast_path,
    ts.signal_type
FROM intraday_positions ip
JOIN trade_signals ts ON ip.signal_id = ts.id
WHERE ip.status = 'open'
ORDER BY ip.entry_time DESC;
