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
  Claude Opus 4.6 (batches of 10, structured output via zod)
        ↓
  Extract discrete, falsifiable claims
  e.g. "The housing order could collapse bipartisan legislation"
        ↓
  SQLite — speculations table (status: pending)
```

- **Normal mode** fetches articles published since the last run (keeps the DB current)
- **Backfill mode** works backwards N months at a time from the oldest fetched date, stopping at 2019-01-01. Pass `--months=N` to fetch multiple months in one call (default: 1)
- **Refetch mode** (`--refetch=YYYY-MM`) re-fetches a specific month without moving the state pointer — useful for filling gaps
- Duplicates are silently ignored via a unique index on `(article_url, verbatim)`
- Claude responses are parsed using `zodOutputFormat` for reliable structured extraction

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

Reads the database and displays a journalist summary table: total claims, confirmed, partial, refuted, pending. Supports:
- `--sort=accuracy` — re-sort by % correct instead of claim volume
- `--analysis` — speculation intensity and timeframe breakdown (via `npm run report:analysis`)

### 4. Nightly (`npm run nightly`)

Orchestrates the full pipeline automatically:
1. Fetch new articles (extract, normal mode)
2. Run backfill — **7 months** in filling mode (while oldest_fetched_date > 2019-01-01), **3 months** in normal mode
3. Check up to 130 pending speculations — **skipped in filling mode**
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
| `npm run extract:backfill` | Fetch one month further back (use `--months=N` for more) |
| `npm run extract:refetch` | Re-fetch a specific month (`--refetch=YYYY-MM`) without moving state |
| `npm run check`      | Verify pending speculations against recent news     |
| `npm run check:qa`   | Same, with interactive review before saving         |
| `npm run report`     | Journalist summary table (top 40 by claim volume)   |
| `npm run report:accuracy` | Same, sorted by % correct                     |
| `npm run report:analysis` | Speculation intensity and timeframe breakdown  |
| `npm run edit`       | Correct an existing assessment                      |
| `npm run nightly`    | Run the full pipeline and email a summary           |

---

## Source Files

| File | Description |
|------|-------------|
| `src/index.ts` | CLI entry point. Reads `process.argv` to dispatch to the correct command handler (`extract`, `check`, `report`, `edit`, `nightly`), passing flags like `--backfill`, `--qa`, and `--sort=accuracy`. |
| `src/db.ts` | All SQLite logic. Defines the `Speculation` type and `Status` enum, creates the `speculations` and `state` tables on first open, and exports CRUD functions: `insertSpeculation`, `getPending`, `updateStatus`, `getAll`, `getState`, `setState`, `getDbStats`. |
| `src/nyt.ts` | NYT Article Search API client. `fetchArticles()` pages through results for a date range (used by extract); `searchArticles()` queries by keyword (used by check). Includes exponential-backoff retry on 429 rate-limit responses, plus `toNytDate()` and `subtractMonths()` date helpers. |
| `src/extract.ts` | Fetches articles from `nyt.ts` and sends them to Claude in batches of 10 to extract falsifiable claims using structured output (`zodOutputFormat`). Handles normal mode (articles since last run), backfill mode (N months further back each call, stopping at 2019-01-01), and refetch mode (specific YYYY-MM without moving state). Writes new claims to the DB via `insertSpeculation` and updates `oldest_fetched_date` / `newest_fetched_date` in the `state` table. |
| `src/check.ts` | Verifies pending speculations. For each one, searches NYT for related articles, then asks Claude to assess the outcome (`confirmed` / `partial` / `refuted` / `pending`). In `--qa` mode, shows Claude's reasoning interactively and lets the user accept or override before saving. Updates the DB via `updateStatus`. |
| `src/report.ts` | Reads the full database and prints a summary table of the top 40 journalists by claim volume, with columns for total claims and % correct / partial / incorrect / pending. Accepts a `sort` argument: `"volume"` (default) or `"accuracy"` (re-sorts the top 40 by % correct). |
| `src/edit.ts` | Interactive CLI for correcting an existing assessment. Lists all speculations with their current status, prompts for a number, shows the full record, then lets the user change the status and update the evidence note. |
| `src/nightly.ts` | Orchestrates the full pipeline: (1) fetch new articles, (2) run up to 7 backfill months in filling mode or 3 in normal mode, (3) check up to 130 pending speculations (skipped in filling mode), (4) email a summary report via nodemailer/Gmail SMTP. Reads `GMAIL_USER` and `GMAIL_APP_PASSWORD` from `.env`; if absent, prints the email body to stdout instead. |

---

## Key Design Decisions

**Claims must be falsifiable** — Claude is instructed to extract only specific, checkable predictions, not vague sentiment or characterisation. "The policy may be controversial" is rejected; "The order could collapse bipartisan legislation" is kept.

**Multi-author bylines are split** — if an article has two journalists, the claim is attributed to each individually so per-journalist track records are meaningful.

**Conservative verification** — the check step defaults to `pending` when evidence is ambiguous. Only clear confirmation or refutation changes the status.

**Backfill is resumable** — progress is stored in the `state` table, so backfill can be interrupted and resumed across multiple days without re-fetching already-covered date ranges.
