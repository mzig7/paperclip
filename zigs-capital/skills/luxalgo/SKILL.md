---
name: luxalgo
description: >
  Placeholder for LuxAlgo Quant integration. Will be used to create persistent
  indicators and strategies from durable research findings. Not yet implemented —
  do not invoke until integration details are decided.
allowed-tools: []
---

# LuxAlgo Skill (Placeholder)

Strategy construction layer for Zigs Capital. LuxAlgo will be used to turn durable research findings into persistent indicators, strategy logic, and alert configurations.

## Status

**Not yet implemented.** The integration approach (API, MCP, or manual workflow) has not been decided.

## Intended Role

- Downstream of thesis formation — only invoked after a finding is durable enough to encode
- Turn validated theses into: entry/exit logic, filters, invalidation alerts, strategy candidate specs
- Primary tool for the Technical Analyst

## When This Gets Built

Once the MVP is running and producing actionable theses, LuxAlgo integration will be designed to:

1. Accept a validated thesis with price targets and timeframe
2. Generate indicator configurations or strategy parameters
3. Optionally persist strategy specs back to Neon for tracking

## Until Then

The Technical Analyst should use Alpha Vantage price data and manual indicator calculation (RSI, MACD, SMA from time series data) for technical analysis. LuxAlgo-specific strategy construction is deferred.
