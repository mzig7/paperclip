---
name: notion-publish
description: >
  Publish final research and trading-desk output to Notion. Notion is the
  human-facing publication layer — never the system of record.
allowed-tools:
  - Bash
  - Read
  - mcp__notion__create_page
  - mcp__notion__update_page
  - mcp__notion__search
  - mcp__notion__get_page
  - mcp__notion__get_database
  - mcp__notion__query_database
  - mcp__notion__create_database
---

# Notion Publish Skill

Human-facing publication layer for Zigs Capital. Neon stores facts. Notion stores deliverables.

Only CEO-synthesized research output and Head Trader-synthesized trading output belong here. Never publish intermediate analyst findings to Notion.

## Operating Rules

1. **Neon stores facts. Notion stores deliverables.**
2. **Publish into databases only.** Research memos, signals, and fill logs are always pages inside their respective databases.
3. **No loose pages under `Zigs Capital`.** Container pages hold databases and dashboard pages only.
4. **Resolve targets by stored ID first.** Fallback is exact-name lookup under the expected parent page.
5. **Normal publishing never bootstraps the workspace.** If the expected container page or database is missing, fail loudly instead of creating ad hoc structure.
6. **Keep workspace-specific IDs out of the skill file.** Store IDs in runtime configuration or provisioning notes on the Mac Mini.

## Notion Workspace Hierarchy

Use this structure:

- `Zigs Capital` — top-level container page
- `Research Desk` — container page under `Zigs Capital`
- `Research Memos` — database under `Research Desk`
- `Watchlist` — database under `Research Desk` when provisioned
- `Decision Log` — database under `Research Desk` when provisioned
- `Zigs Capital Trading Desk` — container page under `Zigs Capital`
- `Trading Desk Signals` — database under `Zigs Capital Trading Desk`
- `Trading Desk Positions Log` — database under `Zigs Capital Trading Desk`
- `Portfolio Dashboard` — standalone page at the top level under `Zigs Capital` if provisioned

Container pages do not hold thesis or signal content directly.

## Database Definitions

### Research Memos

Parent: `Research Desk`

Properties:
- **Ticker** (title)
- **Direction** (select: Bull / Bear / Pass)
- **Conviction** (select: High / Medium / Low)
- **Date** (date)
- **Timeframe** (select: weeks / 1-3 months / 3-6 months / 6-12 months / 12-18 months)
- **Status** (select: Active / Invalidated / Expired / Realized)
- **Bull Target** (number)
- **Base Target** (number)
- **Bear Target** (number)
- **Neon Thesis ID** (text)

Page content: the full research memo from the `research-memo` skill.

### Watchlist

Parent: `Research Desk`

Properties:
- **Ticker** (title)
- **Sector** (select)
- **Status** (select: Active / Paused / Archived)
- **Monitoring Mode** (select: Lean / Standard / Deep)
- **Last Updated** (date)
- **Notes** (text)

### Decision Log

Parent: `Research Desk`

Properties:
- **Date** (date)
- **Ticker** (title)
- **Decision** (select: Buy / Sell / Hold / Add / Trim / Watch / Pass)
- **Rationale** (text)
- **Thesis Link** (relation to Research Memos)
- **Neon Decision ID** (text)

### Trading Desk Signals

Parent: `Zigs Capital Trading Desk`

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
- **Confluence Score** (number)
- **Fast Path** (checkbox)
- **Status** (select: Active / Triggered / Stopped / Target Hit / Expired / Cancelled)
- **Date** (date)
- **Expires** (date)
- **Neon Signal ID** (text)

Page content: concise signal summary or full setup report.

### Trading Desk Positions Log

Parent: `Zigs Capital Trading Desk`

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

Rows in this database reflect **manually entered fills only**. No fill reported means no row.

## Workspace Bootstrap vs Normal Publishing

### One-Time Workspace Bootstrap

Handled during provisioning on the Mac Mini:

1. Verify `Zigs Capital` exists.
2. Verify `Research Desk`, `Research Memos`, and other research databases.
3. Verify `Zigs Capital Trading Desk`, `Trading Desk Signals`, and `Trading Desk Positions Log`.
4. Verify `Portfolio Dashboard` if used.
5. Store resulting page/database IDs for later lookup.

### Normal Publishing

Every publish flow should:

1. Use the stored Notion ID if available.
2. Fall back to exact-name search under the expected parent container.
3. Fail loudly if the resolved target is missing.
4. Never create a new container page or database during the publish itself.

## Publishing Workflow

### Publish a Research Memo

1. Read the completed thesis and supporting findings from Neon.
2. Format the deliverable with `research-memo`.
3. Resolve the `Research Memos` database by stored ID or exact-name lookup under `Research Desk`.
4. Create or update a page in that database.
5. Set all memo properties.
6. Write the formatted memo as page content.
7. Optionally store the Notion page ID back in Neon.

### Update the Watchlist

1. Query `v_active_watchlist` from Neon.
2. Resolve the `Watchlist` database under `Research Desk`.
3. Sync rows by ticker.
4. Archive or pause rows rather than creating duplicate ticker entries.

### Record a Decision

1. Resolve `Decision Log` under `Research Desk`.
2. Create a new decision row after a user acts on a thesis.
3. Link the row back to the relevant `Research Memos` page.

### Publish a Trading Desk Signal

1. Read the synthesized trading output from Neon `desk_findings`, `trade_signals`, and optional `setups`.
2. Format with `trade-signal` or `setup-report`.
3. Resolve `Trading Desk Signals` by stored ID or exact-name lookup under `Zigs Capital Trading Desk`.
4. Create or update the row with signal properties.
5. Write the setup report or concise signal summary as page content.
6. Optionally store the Notion page ID back in Neon.

### Record a Trading Desk Fill

1. Wait for the user to report an actual fill or exit.
2. Resolve `Trading Desk Positions Log` by stored ID or exact-name lookup under `Zigs Capital Trading Desk`.
3. Create or update the row using the actual reported fill values from `intraday_positions`.
4. Link the position row to the corresponding signal through `Signal Link`.

### Update the Portfolio Dashboard

1. Pull current state from Neon across both desks.
2. Update the top-level `Portfolio Dashboard` page if it exists.
3. Include a trading section with active signals, open intraday positions, and desk performance summary alongside the research summary.

## Formatting Rules

- Use clean markdown. No raw JSON, no SQL dumps, no agent IDs.
- Price targets use currency formatting like `$185.00`.
- Percentages include a sign when applicable.
- Dates should be human-readable in page content.
- Tables are appropriate for analyst convergence, target ladders, and summary comparisons.
- Keep pages scannable with headers and short narrative blocks.

## What This Skill Does NOT Do

- It does not generate analysis.
- It does not replace Neon as the system of record.
- It does not create ad hoc Notion hierarchy during normal publishing.
- It does not publish intermediate analyst findings.
