---
name: research-memo
description: >
  Assemble a final research memo from analyst findings stored in Neon. Used
  by the CEO after synthesis to produce the complete research output with
  all required fields — thesis, 3 price targets, timeframe, conviction,
  assumptions, invalidation, evidence, and counter-case.
allowed-tools:
  - Bash
  - Read
---

# Research Memo Skill

Assembles the final research output from analyst findings in Neon. This is the CEO's formatting and assembly tool — it does not generate analysis, it structures it.

## When to Use

After the CEO has:
1. Read all analyst findings from Neon for the research run
2. Applied the mixed-signal filter (if mixed → pass memo)
3. Decided on direction and conviction
4. Determined price targets from the supporting evidence

## Required Fields

Every research memo MUST include ALL of these fields. A memo missing any field is incomplete.

| # | Field | Source |
|---|-------|--------|
| 1 | **Ticker** | Research run |
| 2 | **Direction** | CEO synthesis (Bull / Bear / Pass) |
| 3 | **Thesis summary** | CEO synthesis — 2-3 sentences, "why this, why now" |
| 4 | **Price target (bull case)** | Fundamentals/Buffett findings + CEO judgment. Must show the math. |
| 5 | **Price target (base case)** | Most likely scenario with supporting logic |
| 6 | **Price target (bear case)** | Downside scenario with supporting logic |
| 7 | **Timeframe** | Growth Analyst catalyst timing + CEO judgment |
| 8 | **Conviction** | CEO assessment (High / Medium / Low) with reasoning |
| 9 | **Position sizing** | Risk Manager recommendation within $1K constraint |
| 10 | **Key assumptions** | What must be true for the thesis to work |
| 11 | **Invalidation criteria** | What kills the thesis — exit triggers |
| 12 | **Supporting evidence** | Analyst findings that support the thesis |
| 13 | **Counter-case** | The opposing view with supporting evidence |
| 14 | **Volatility regime** | Current VIX level and trade expression implications |

## Memo Template

```markdown
# {TICKER} — {DIRECTION} Thesis

**Date:** {DATE}
**Conviction:** {HIGH/MEDIUM/LOW}
**Timeframe:** {TIMEFRAME}
**Current Price:** ${CURRENT_PRICE}

## Thesis

{2-3 sentence summary: why this name, why now}

## Price Targets

| Scenario | Target | Basis |
|----------|--------|-------|
| Bull | ${BULL_TARGET} | {e.g., 25x forward EPS of $7.40 = $185} |
| Base | ${BASE_TARGET} | {most likely scenario math} |
| Bear | ${BEAR_TARGET} | {downside scenario math} |

**Note:** These targets are for LEAP strike selection. No strike or expiration recommendations are provided.

## Position Sizing

{Risk Manager's recommendation — dollar amount within $1K, adjusted for vol regime and conviction}

## Volatility Regime

**VIX:** {LEVEL} ({LOW/ELEVATED/HIGH} regime)

{How current vol affects this trade — premium costs, directional bias, timing considerations}

## Supporting Evidence

### Fundamentals
{Key metrics from Fundamentals Analyst — actual numbers, not vague assessments}

### Business Quality
{Buffett Analyst assessment — moat, management, intrinsic value, margin of safety}

### Growth & Catalysts
{Growth Analyst findings — catalyst inventory with timelines, "why now"}

### Sentiment & Flow
{Sentiment Analyst findings — narrative status, institutional flow, insider activity}

### Technical Levels
{Technical Analyst findings — support/resistance, trend, momentum}

### Risk Assessment
{Risk Manager findings — signal convergence, portfolio impact, key risks}

## Counter-Case

{The bear case on a bull thesis, or vice versa. Must include specific evidence, not just "it could go down."}

## Key Assumptions

{Numbered list of what must be true}

1. {Assumption 1}
2. {Assumption 2}
3. {Assumption 3}

## Invalidation Criteria

{Specific, measurable conditions that kill the thesis. These are exit triggers.}

1. {Criterion 1 — e.g., "Q2 earnings miss by >10%"}
2. {Criterion 2 — e.g., "CEO announces secondary offering"}
3. {Criterion 3 — e.g., "Price breaks below $X support on high volume"}

## Analyst Convergence

| Analyst | Direction | Confidence | Key Finding |
|---------|-----------|------------|-------------|
| Fundamentals | {Bull/Bear/Mixed} | {0-1} | {one-line summary} |
| Buffett | {Bull/Bear/Mixed} | {0-1} | {one-line summary} |
| Growth | {Bull/Bear/Mixed} | {0-1} | {one-line summary} |
| Sentiment | {Bull/Bear/Mixed} | {0-1} | {one-line summary} |
| Technical | {Bull/Bear/Mixed} | {0-1} | {one-line summary} |
| Risk Manager | {Green/Yellow/Red} | — | {risk-adjusted verdict} |
```

## Pass Memo Template

When fundamentals are mixed or there's no edge:

```markdown
# {TICKER} — PASS

**Date:** {DATE}
**Current Price:** ${CURRENT_PRICE}

## Why Pass

{2-3 sentences explaining why there's no actionable thesis}

## What We Found

{Brief summary of analyst findings and where they conflicted}

## What Would Change This

{Specific conditions that would make this ticker worth revisiting}

## Revisit Date

{When to look at this again — next earnings, specific catalyst date, or "no catalyst in sight"}
```

## Assembly Process

1. Query all `research_findings` for the `research_run_id` from Neon
2. Query the `theses` entry if one was created
3. Query `v_open_positions` to check for existing exposure
4. Pull current price via Alpha Vantage `GLOBAL_QUOTE` (or from recent cache)
5. Assemble the memo using the template above
6. Store the completed memo as the `summary` field on the `research_runs` row
7. Hand off to `notion-publish` for human-facing publication

## What This Skill Does NOT Do

- Does not generate analysis. It assembles and formats what the CEO has already decided.
- Does not call external APIs. Price data should already be in cache.
- Does not publish to Notion. Use notion-publish after assembly.
