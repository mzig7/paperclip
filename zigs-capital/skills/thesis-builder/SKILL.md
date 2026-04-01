---
name: thesis-builder
description: >
  Create, version, and manage investment theses in Neon. Handles thesis
  creation with 3 price targets, versioning when theses are updated,
  invalidation tracking, and linking theses to holdings and research runs.
allowed-tools:
  - Bash
---

# Thesis Builder Skill

Manages the lifecycle of investment theses in Neon. A thesis is the core output of the research company — it captures the investment case, price targets, timeframe, and invalidation criteria that the user needs for trade decisions.

## Thesis Lifecycle

```
Created → Active → Invalidated / Expired / Realized
                  ↘ Updated (new version) → Active
```

- **Active:** Current thesis driving monitoring and decisions
- **Invalidated:** Thesis killed by an invalidation criterion being met
- **Expired:** Target date passed without the thesis playing out
- **Realized:** User acted on the thesis and the position has been closed

## Creating a New Thesis

After the CEO synthesizes analyst findings and decides there's an actionable thesis:

```sql
-- Get current price for reference
-- (should already be in tool_cache from the research run)

INSERT INTO theses (
    symbol,
    version,
    thesis_type,
    status,
    title,
    summary,
    conviction,
    current_price_at_creation,
    price_target_bull,
    price_target_base,
    price_target_bear,
    time_horizon,
    target_date,
    review_by_date,
    key_assumptions,
    invalidation_criteria,
    disconfirming_evidence,
    supporting_finding_ids,
    risk_rating,
    max_loss_scenario,
    research_run_id,
    created_by
) VALUES (
    $symbol,
    1,                          -- first version
    $thesis_type,               -- 'bull', 'bear', 'base', or 'trade'
    'active',
    $title,
    $summary,
    $conviction,                -- 'high', 'medium', 'low'
    $current_price,
    $bull_target,
    $base_target,
    $bear_target,
    $time_horizon,              -- 'weeks', '1_month', '3_months', etc.
    $target_date,
    $review_by_date,
    $key_assumptions,
    $invalidation_criteria,
    $disconfirming_evidence,
    $finding_ids,               -- UUID array of supporting research_findings
    $risk_rating,
    $max_loss_scenario,
    $research_run_id,
    $agent_id
)
RETURNING id;
```

### Required Fields Checklist

Before creating a thesis, verify ALL of these are present:

| Field | Required | Why |
|-------|----------|-----|
| `price_target_bull` | YES | LEAP strike selection requires all 3 targets |
| `price_target_base` | YES | LEAP strike selection requires all 3 targets |
| `price_target_bear` | YES | LEAP strike selection requires all 3 targets |
| `time_horizon` | YES | Maps to LEAP expiration selection |
| `conviction` | YES | Drives position sizing |
| `invalidation_criteria` | YES | Defines exit triggers — thesis without invalidation is a wish |
| `key_assumptions` | YES | What must be true |
| `disconfirming_evidence` | YES | The counter-case |
| `supporting_finding_ids` | YES | Traceability back to the research |

Do not create a thesis with NULL price targets. If the analysis didn't produce specific numbers, the thesis isn't ready.

## Versioning a Thesis

When new information materially changes an existing thesis (price targets shift, new catalyst, invalidation criterion nearly triggered but survived):

```sql
-- 1. Get the current version
SELECT id, version FROM theses
WHERE symbol = $symbol AND status = 'active' AND thesis_type = $type
ORDER BY version DESC LIMIT 1;

-- 2. Create new version linked to the old one
INSERT INTO theses (
    symbol, version, thesis_type, status,
    title, summary, conviction,
    current_price_at_creation,
    price_target_bull, price_target_base, price_target_bear,
    time_horizon, target_date, review_by_date,
    key_assumptions, invalidation_criteria, disconfirming_evidence,
    supporting_finding_ids, risk_rating, max_loss_scenario,
    previous_version_id, research_run_id, created_by
) VALUES (
    $symbol, $old_version + 1, $type, 'active',
    -- ... updated fields ...
    $old_thesis_id,     -- previous_version_id
    $new_run_id,
    $agent_id
)
RETURNING id;

-- 3. Deactivate the old version (it's superseded, not invalidated)
UPDATE theses SET status = 'expired' WHERE id = $old_thesis_id;
```

## Invalidating a Thesis

When an invalidation criterion is met:

```sql
UPDATE theses
SET status = 'invalidated',
    invalidated_at = NOW(),
    invalidation_reason = $reason
WHERE id = $thesis_id;
```

Also create a signal for visibility:

```sql
INSERT INTO signals (
    symbol, signal_type, severity, title, description, thesis_id
) VALUES (
    $symbol, 'thesis_invalidated', 'high',
    'Thesis invalidated: ' || $thesis_title,
    $reason,
    $thesis_id
);
```

If the user has an open position linked to this thesis, the signal severity should be `critical`.

## Marking a Thesis as Realized

When the user closes a position that was based on this thesis:

```sql
UPDATE theses
SET status = 'realized',
    realized_at = NOW(),
    realized_notes = $notes
WHERE id = $thesis_id;
```

## Linking a Thesis to a Holding

When the user reports taking a position based on a thesis:

```sql
-- Record the holding
INSERT INTO holdings (
    symbol, instrument_type, quantity, entry_price, entry_date,
    strike_price, expiration_date, thesis_id, broker, account_label
) VALUES ($1, $2, $3, $4, $5, $6, $7, $thesis_id, $8, $9);

-- Record the decision
INSERT INTO decisions (
    symbol, decision_type, thesis_id, research_run_id, rationale, decided_by
) VALUES ($symbol, 'buy', $thesis_id, $run_id, $rationale, 'user');
```

## Thesis Review Queries

### Active theses due for review
```sql
SELECT symbol, title, thesis_type, conviction,
       price_target_bull, price_target_base, price_target_bear,
       time_horizon, review_by_date, created_at
FROM theses
WHERE status = 'active'
  AND review_by_date <= CURRENT_DATE
ORDER BY review_by_date;
```

### Thesis history for a ticker
```sql
SELECT version, thesis_type, status, title, conviction,
       price_target_bull, price_target_base, price_target_bear,
       created_at, invalidated_at, invalidation_reason
FROM theses
WHERE symbol = $symbol
ORDER BY version DESC;
```

### Theses approaching target date without realization
```sql
SELECT symbol, title, thesis_type, target_date,
       (target_date - CURRENT_DATE) AS days_remaining
FROM theses
WHERE status = 'active'
  AND target_date <= CURRENT_DATE + INTERVAL '14 days'
ORDER BY target_date;
```

## What This Skill Does NOT Do

- Does not generate thesis content. The CEO synthesizes; this skill structures and persists.
- Does not call external APIs.
- Does not publish to Notion. Use notion-publish after the thesis is stored.
- Does not suggest strikes, expirations, or position sizes.
