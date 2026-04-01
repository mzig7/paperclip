---
name: quant-toolkit
description: >
  Statistical analysis methods for the trading desk Quant Analyst. Covers
  expected value computation, volatility modeling, regime detection, correlation
  analysis, backtesting patterns, and futures term structure analysis.
allowed-tools:
  - Bash
  - Read
  - Grep
---

# Quant Toolkit Skill

Statistical analysis methods for Zigs Capital's trading desk. The Quant Analyst is the primary consumer. All computations use data from Alpha Vantage, ProjectX, and Neon historical records.

## Expected Value Computation

The core decision metric for every setup:

```
EV = (win_rate × avg_win_R) - (loss_rate × avg_loss_R)
```

Where R = risk unit = |entry - stop|.

### Computation Steps

1. Define the setup type (breakout, breakdown, reversal, momentum, mean_reversion).
2. Query historical outcomes from `intraday_positions`:
   ```sql
   SELECT
     COUNT(*) as total,
     COUNT(*) FILTER (WHERE pnl > 0) as wins,
     AVG(r_multiple) FILTER (WHERE pnl > 0) as avg_win_r,
     AVG(ABS(r_multiple)) FILTER (WHERE pnl <= 0) as avg_loss_r
   FROM intraday_positions ip
   JOIN trade_signals ts ON ip.signal_id = ts.id
   WHERE ts.signal_type = $setup_type
     AND ts.instrument_type = $instrument_type
     AND ip.status = 'closed';
   ```
3. If insufficient position history (n < 20), fall back to price-series backtesting:
   - Pull TIME_SERIES_DAILY from Alpha Vantage (or ProjectX for futures)
   - Simulate the setup criteria against historical price data
   - Compute hypothetical R-multiples
4. Report with confidence interval: `win_rate ± 1.96 × sqrt(p(1-p)/n)`

### Edge Classification

| EV (in R) | Verdict | Recommendation |
|-----------|---------|----------------|
| > 0.5 | **Edge** | Setup is statistically favorable |
| 0 - 0.5 | **Marginal** | Thin edge; flag to Head Trader |
| ≤ 0 | **No edge** | Reject the setup |

## Volatility Modeling

### Historical Volatility (HV)

Compute from daily log returns:

```python
import numpy as np
returns = np.log(closes[1:] / closes[:-1])
hv_20 = np.std(returns[-20:]) * np.sqrt(252)  # 20-day annualized
hv_60 = np.std(returns[-60:]) * np.sqrt(252)  # 60-day annualized
```

### Implied Volatility (IV) from EOD Options

Pull from Alpha Vantage `HISTORICAL_OPTIONS` endpoint:

```sql
-- Check cache first
SELECT response_data FROM tool_cache
WHERE cache_key = sha256('alpha_vantage|HISTORICAL_OPTIONS|symbol=$TICKER')
  AND expires_at > NOW();
```

Extract IV from at-the-money options (nearest strike to current price, nearest expiry).

### IV Rank and Percentile

```python
# IV Rank: where current IV sits in the 52-week range
iv_rank = (current_iv - iv_52w_low) / (iv_52w_high - iv_52w_low)

# IV Percentile: % of trading days in past year with lower IV
iv_percentile = sum(1 for iv in past_year_ivs if iv < current_iv) / len(past_year_ivs)
```

Store historical IV values in `desk_findings` (structured_data JSONB) for tracking over time.

### HV vs. IV Spread

```
spread = IV - HV_20
```

| Spread | Meaning | Options Strategy Implication |
|--------|---------|------------------------------|
| IV >> HV | Premium is rich | Favor selling premium (credit spreads) |
| IV ≈ HV | Fair value | Neutral — strategy depends on directional view |
| IV << HV | Premium is cheap | Favor buying premium (long calls/puts) |

## Regime Detection

### Trend Strength (ADX)

Compute Average Directional Index from Alpha Vantage daily data or ProjectX built-in indicator:

| ADX Value | Classification | Viable Setups |
|-----------|---------------|---------------|
| > 25 | **Trending** | Breakouts, momentum, trend continuation |
| 20 - 25 | **Transitional** | Caution — wait for confirmation |
| < 20 | **Range-bound** | Mean reversion, range plays |

### Volatility Regime (ATR Percentile)

```python
atr_14 = compute_atr(highs, lows, closes, period=14)
atr_percentile = percentileofscore(atr_history_252, atr_14[-1])
```

| ATR Percentile | Classification |
|---------------|---------------|
| > 75th | High volatility — wider stops, smaller positions |
| 25th - 75th | Normal volatility |
| < 25th | Low volatility — squeeze candidate |

### Bollinger Bandwidth Squeeze

```python
bb_bandwidth = (upper_band - lower_band) / middle_band
```

When bandwidth is at a 6-month low, a volatility expansion is imminent. Direction is uncertain — the squeeze detects the event, not the direction.

## Correlation Analysis

### Rolling Correlation Matrix

Compute 20-day rolling correlation between the target ticker and benchmarks:

```python
import pandas as pd
corr_spy = returns_ticker.rolling(20).corr(returns_spy)
corr_qqq = returns_ticker.rolling(20).corr(returns_qqq)
corr_sector = returns_ticker.rolling(20).corr(returns_sector_etf)
```

### Portfolio Correlation Risk

Query open positions and compute pairwise correlation:

```sql
SELECT symbol FROM intraday_positions WHERE status = 'open';
```

Then compute correlation between each open position and the proposed new position. Flag if any pairwise correlation > 0.7.

## Z-Score (Mean Reversion)

```python
z_20 = (current_price - sma_20) / std_20
z_50 = (current_price - sma_50) / std_50
```

| Z-Score | Signal |
|---------|--------|
| > 2.0 | Overbought — potential short reversion (in ranging regime only) |
| < -2.0 | Oversold — potential long reversion (in ranging regime only) |
| -2.0 to 2.0 | No mean-reversion signal |

**Critical caveat:** Z-scores in trending regimes are NOT reversion signals. A Z-score of 2.5 in a strong uptrend is trend strength, not overbought. Always combine with regime detection.

## Futures Term Structure Analysis

### Contango vs. Backwardation

```python
front_month_price = get_quote(front_contract)
back_month_price = get_quote(back_contract)
basis = front_month_price - back_month_price
```

| Structure | Meaning | Implication |
|-----------|---------|-------------|
| Contango (basis < 0) | Front < back | Normal carry; roll cost for longs |
| Backwardation (basis > 0) | Front > back | Supply squeeze signal; positive carry for longs |

### Basis Spread Tracking

Store basis spread in `desk_findings` structured_data for trend tracking:

```json
{
  "product": "ES",
  "front_contract": "ESM6",
  "back_contract": "ESU6",
  "basis": -2.50,
  "basis_pct": -0.05,
  "structure": "contango"
}
```

### Open Interest Analysis

Rising OI + rising price = new longs entering (bullish confirmation)
Rising OI + falling price = new shorts entering (bearish confirmation)
Falling OI + rising price = short covering (potentially weak rally)
Falling OI + falling price = long liquidation (potentially weak decline)

## Neon Storage

All computed metrics go to `desk_findings` with `finding_type = 'quant_analysis'`:

```sql
INSERT INTO desk_findings (
  desk_run_id, symbol, analyst_role, agent_id,
  finding_type, title, body, confidence, direction,
  structured_data, data_sources
) VALUES (
  $run_id, $symbol, 'quant_analyst', $agent_id,
  'quant_analysis', $title, $body, $confidence, $direction,
  $structured_data, $data_sources
);
```

The `structured_data` JSONB should contain all computed metrics in a queryable format:

```json
{
  "ev": 1.4,
  "win_rate": 0.67,
  "sample_size": 34,
  "confidence_interval": [0.59, 0.75],
  "regime": "trending",
  "adx": 28.5,
  "atr_percentile": 62,
  "iv_rank": 0.45,
  "iv_percentile": 0.52,
  "hv_20": 0.28,
  "hv_iv_spread": -0.04,
  "correlation_spy": 0.72,
  "z_score_20": 1.3
}
```

## Cache Strategy

Historical computations (HV, correlation matrices, regime classification on historical data) should be cached in Neon `tool_cache` to avoid recomputation:

- Cache key: `sha256("quant_toolkit|{metric}|{symbol}|{date_range}")`
- TTL: 4 hours for daily-frequency metrics, 1 hour for intraday-frequency metrics
- Always check cache before computing. Increment `av_cache_hits` on cache hit.

## What This Skill Does NOT Do

- Does not interpret results or make trade recommendations. It provides computation methods.
- Does not call external APIs directly. The Quant Analyst agent uses Alpha Vantage and ProjectX skills.
- Does not define the signal format. That's the `trade-signal` skill.
