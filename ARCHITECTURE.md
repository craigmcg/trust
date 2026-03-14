# Architecture

## Overview

Trust is a speculation accountability system for political journalism. It extracts specific, falsifiable predictions from NYT political articles, stores them in a database, and later searches for evidence of whether those predictions came true.

Over time it builds a track record per journalist — how often their speculative claims are confirmed, refuted, or remain unresolved.

---

## Pipeline

### 1. Extract (`npm run extract` / `npm run extract:backfill`)

```
NYT Article Search API
        ↓
  Fetch articles (abstract, snippet, lead paragraph, byline, date)
        ↓
  Claude Opus 4.6 (batches of 10)
        ↓
  Extract discrete, falsifiable claims
  e.g. "The housing order could collapse bipartisan legislation"
        ↓
  SQLite — speculations table (status: pending)
```

- **Normal mode** fetches articles published since the last run (keeps the DB current)
- **Backfill mode** works backwards one month at a time from the oldest fetched date, stopping at 2019-01-01
- Duplicates are silently ignored via a unique index on `(article_url, verbatim)`

### 2. Check (`npm run check` / `npm run check:qa`)

```
SQLite — pending speculations
        ↓
  For each speculation:
    Search NYT for related articles (using claim text as query)
        ↓
    Claude Opus 4.6
    Assesses: confirmed / partial / refuted / pending
        ↓
  SQLite — update status + evidence summary
```

- Only processes claims with `status = 'pending'`
- `--qa` mode shows evidence and Claude's reasoning interactively, allowing manual override before saving
- Conservative by design — only marks confirmed/refuted when evidence is clear

### 3. Report (`npm run report`)

Reads the database and displays:
- Every claim with its status, verbatim quote, and evidence
- A journalist summary table: total claims, confirmed, partial, refuted, pending

### 4. Nightly (`npm run nightly`)

Orchestrates the full pipeline automatically:
1. Fetch new articles (extract, normal mode)
2. Run backfill for 5 months (working backwards toward 2019)
3. Check all pending speculations
4. Email a summary to craigmcg.acc@gmail.com

Runs daily at 2 AM via cron (`scripts/install-cron.sh`).

---

## Database

SQLite file: `speculations.db`

### `speculations` table

| Column            | Description                                      |
|-------------------|--------------------------------------------------|
| `journalist`      | Individual author name (multi-author bylines split) |
| `article_headline`| Headline of the source article                   |
| `article_url`     | NYT article URL                                  |
| `article_date`    | Publication date (YYYY-MM-DD)                    |
| `claim`           | Clean, checkable restatement of the speculation  |
| `verbatim`        | Exact quote from the article text                |
| `timeframe`       | Implied timeframe, if any (e.g. "within months") |
| `status`          | `pending` / `confirmed` / `partial` / `refuted`  |
| `evidence`        | Summary of evidence found                        |
| `evidence_url`    | URL of the most relevant evidence article        |
| `checked_at`      | When the claim was last verified                 |
| `created_at`      | When the claim was first extracted               |

### `state` table

Tracks fetch progress:

| Key                   | Value                                      |
|-----------------------|--------------------------------------------|
| `oldest_fetched_date` | Oldest date fetched so far (backfill progress) |
| `newest_fetched_date` | Most recent date fetched (for daily updates)   |

---

## Rate Limits & Budget

### NYT API (free tier)
- 500 requests/day, ~5 requests/second
- Each page = 10 articles = 1 request
- ~65 requests per month of backfill data
- Practical limit: ~7 months of backfill per day

### Claude API (Opus 4.6)
- Extraction: ~$0.02 per batch of 10 articles
- Checking: ~$0.01 per speculation
- Estimated cost per nightly backfill run: ~$7
- Estimated cost once backfill complete: ~$0.50–1/day

---

## Commands

| Command              | Description                                         |
|----------------------|-----------------------------------------------------|
| `npm run extract`    | Fetch new articles since last run                   |
| `npm run extract:backfill` | Fetch one month further back                  |
| `npm run check`      | Verify pending speculations against recent news     |
| `npm run check:qa`   | Same, with interactive review before saving         |
| `npm run report`     | Display all claims and journalist summary           |
| `npm run edit`       | Correct an existing assessment                      |
| `npm run nightly`    | Run the full pipeline and email a summary           |

---

## Key Design Decisions

**Claims must be falsifiable** — Claude is instructed to extract only specific, checkable predictions, not vague sentiment or characterisation. "The policy may be controversial" is rejected; "The order could collapse bipartisan legislation" is kept.

**Multi-author bylines are split** — if an article has two journalists, the claim is attributed to each individually so per-journalist track records are meaningful.

**Conservative verification** — the check step defaults to `pending` when evidence is ambiguous. Only clear confirmation or refutation changes the status.

**Backfill is resumable** — progress is stored in the `state` table, so backfill can be interrupted and resumed across multiple days without re-fetching already-covered date ranges.
