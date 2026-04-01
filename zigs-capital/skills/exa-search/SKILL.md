---
name: exa-search
description: >
  Search the web for source material using the Exa API. Returns structured
  results with full text extraction. Use for news, filings, analyst reports,
  management background, competitive research, and catalyst discovery.
  Your agent does the analysis — Exa finds the sources.
allowed-tools:
  - Bash
  - Read
---

# Exa Search Skill

Source discovery layer for Zigs Capital. Exa finds the raw content — your agent applies its analytical framework to form conclusions. Do not outsource your analysis to a search engine.

## Authentication

Requires `EXA_API_KEY` environment variable. Base URL: `https://api.exa.ai`

## Operating Rule

**Alpha Vantage for structured data, Exa for source material.**

Do not use Exa to look up financial data that Alpha Vantage provides (financial statements, price data, earnings history). Exa is for the context, narrative, and qualitative information that structured APIs cannot provide:

- News articles about the company
- SEC filings and regulatory actions
- Management background and executive track records
- Competitive landscape and industry analysis
- Analyst commentary and earnings call coverage
- Catalyst-driving events (product launches, partnerships, lawsuits)
- Social/media sentiment and narrative shifts

## Core Endpoints

### Search
Semantic search — finds content based on meaning, not just keywords.

```bash
curl -X POST "https://api.exa.ai/search" \
  -H "x-api-key: $EXA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "AAPL iPhone sales declining China market share 2026",
    "type": "auto",
    "numResults": 10,
    "startPublishedDate": "2026-01-01T00:00:00.000Z",
    "contents": {
      "text": { "maxCharacters": 3000 }
    }
  }'
```

**Key parameters:**

| Parameter | Purpose |
|-----------|---------|
| `query` | Natural language search query — be specific |
| `type` | `"auto"` (let Exa decide), `"neural"` (semantic), or `"keyword"` |
| `numResults` | Number of results (default 10, max 100) |
| `startPublishedDate` | ISO 8601 — filter to recent content |
| `endPublishedDate` | ISO 8601 — upper bound |
| `includeDomains` | Array of domains to restrict to (e.g., `["sec.gov", "reuters.com"]`) |
| `excludeDomains` | Array of domains to exclude |
| `contents.text` | Include extracted text with optional `maxCharacters` |
| `contents.highlights` | Include relevant highlighted passages |

### Get Contents
Fetch full text for specific URLs you already have.

```bash
curl -X POST "https://api.exa.ai/contents" \
  -H "x-api-key: $EXA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "ids": ["https://example.com/article"],
    "text": { "maxCharacters": 5000 }
  }'
```

### Find Similar
Find pages similar to a known relevant source.

```bash
curl -X POST "https://api.exa.ai/findSimilar" \
  -H "x-api-key: $EXA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/good-article",
    "numResults": 5,
    "contents": {
      "text": { "maxCharacters": 3000 }
    }
  }'
```

## Query Patterns by Use Case

### Catalyst Discovery (Growth Analyst)
```json
{
  "query": "{COMPANY} upcoming catalysts product launch earnings guidance 2026",
  "type": "neural",
  "numResults": 10,
  "startPublishedDate": "2026-01-01T00:00:00.000Z",
  "contents": { "text": { "maxCharacters": 3000 } }
}
```

### Management Due Diligence (Buffett Analyst)
```json
{
  "query": "{CEO_NAME} track record SEC investigation shareholder lawsuit previous companies",
  "type": "neural",
  "numResults": 10,
  "includeDomains": ["sec.gov", "reuters.com", "bloomberg.com", "wsj.com"],
  "contents": { "text": { "maxCharacters": 3000 } }
}
```

### Shelf Offering / Dilution History (Buffett Analyst)
```json
{
  "query": "{TICKER} shelf offering secondary offering stock dilution",
  "type": "neural",
  "numResults": 10,
  "includeDomains": ["sec.gov", "marketwatch.com", "seekingalpha.com"],
  "contents": { "text": { "maxCharacters": 3000 } }
}
```

### Narrative and Sentiment (Sentiment Analyst)
```json
{
  "query": "{TICKER} stock bull bear argument analyst rating 2026",
  "type": "neural",
  "numResults": 15,
  "startPublishedDate": "2026-01-01T00:00:00.000Z",
  "contents": { "text": { "maxCharacters": 2000 }, "highlights": true }
}
```

### Competitive Landscape (Growth Analyst)
```json
{
  "query": "{COMPANY} competitors market share threat {SPECIFIC_MARKET}",
  "type": "neural",
  "numResults": 10,
  "contents": { "text": { "maxCharacters": 3000 } }
}
```

### Event Context — Why Did It Move? (Sentiment Analyst)
```json
{
  "query": "{TICKER} stock price drop surge reason {DATE}",
  "type": "keyword",
  "numResults": 10,
  "startPublishedDate": "{DATE_MINUS_2_DAYS}",
  "endPublishedDate": "{DATE_PLUS_2_DAYS}",
  "contents": { "text": { "maxCharacters": 3000 } }
}
```

### Earnings Anomaly Context (Fundamentals Analyst)
```json
{
  "query": "{TICKER} earnings miss revenue decline Q{X} 2026 reason",
  "type": "neural",
  "numResults": 10,
  "startPublishedDate": "{EARNINGS_DATE_MINUS_7_DAYS}",
  "contents": { "text": { "maxCharacters": 3000 } }
}
```

## Domain Recommendations

For higher-quality results, use `includeDomains` to target authoritative sources:

| Use Case | Recommended Domains |
|----------|-------------------|
| SEC filings | `sec.gov` |
| Financial news | `reuters.com`, `bloomberg.com`, `wsj.com`, `ft.com` |
| Analyst coverage | `seekingalpha.com`, `tipranks.com`, `marketwatch.com` |
| Earnings/fundamentals | `macrotrends.net`, `simplywall.st`, `gurufocus.com` |
| Industry research | `mckinsey.com`, `hbr.org`, domain-specific trade publications |
| General business news | `cnbc.com`, `barrons.com`, `fool.com` |

## Cache Protocol

Cache Exa responses in Neon `tool_cache` with `tool = 'exa'`.

### Cache Key Construction
```
sha256("exa|search|query={normalized_query}&symbol={TICKER}&start={date}")
```
Normalize: lowercase, remove extra whitespace, sort params.

### Cache TTLs

| Query Type | TTL | Rationale |
|------------|-----|-----------|
| Current news/sentiment | 2 hours | News changes fast |
| Catalyst inventory | 6 hours | Catalyst lists are semi-stable |
| Management background | 7 days | Historical facts don't change |
| SEC filings search | 24 hours | Filing cadence is daily at most |
| Competitive landscape | 12 hours | Competitive dynamics shift slowly |
| Event-specific | 4 hours | Post-event coverage stabilizes quickly |

### Budget Tracking
After each Exa call, increment `px_requests_used` on the active `research_runs` row. (Reusing the Perplexity counter column — it tracks non-AV web research requests regardless of provider.)

## Neon Output

Write findings to `research_findings` with:
- `finding_type`: Descriptive — `catalyst`, `narrative_source`, `management_background`, `competitive_analysis`, `event_context`, `filing_reference`
- `body`: Your agent's analysis of the source material (NOT a copy-paste of the raw text). The agent reads the sources and writes its own findings using its analytical framework.
- `data_sources`: `[{"tool": "exa", "query": "...", "urls": ["..."], "cache_key": "..."}]`
- `structured_data`: Extract specific dates, names, numbers, and facts into structured JSON

## Critical Rule

**You are the analyst. Exa is the librarian.**

Exa returns source material. Your agent reads it, applies its AGENTS.md analytical framework, and produces original analysis. If your finding is just a summary of what the articles said, you're not doing your job. The finding should reflect your agent's judgment — supported by the sources, not parroting them.

## What This Skill Does NOT Do

- Does not analyze or synthesize content. It fetches sources. The agent does the thinking.
- Does not replace Alpha Vantage for financial data.
- Does not call Alpha Vantage, LuxAlgo, or Notion.
