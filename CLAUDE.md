# Trust — Claude Code Instructions

## Project
A speculation accountability system for NYT political journalism. Extracts falsifiable predictions from NYT articles using Claude Opus 4.6, stores them in SQLite, verifies them against subsequent news, and builds a per-journalist accuracy track record over time.

Owner: Craig McGowan (craigmcg.acc@gmail.com, GitHub: craigmcg)

## Running the code
Node and npm are installed via Homebrew and are NOT on the default PATH. Always use full paths:

```
/opt/homebrew/bin/node dist/index.js <command>
/opt/homebrew/bin/node ./node_modules/.bin/tsc   # build
```

Never use bare `node`, `npm`, or `npx` — they won't be found.

## Key commands
| Command | What it does |
|---------|-------------|
| `node dist/index.js extract` | Fetch new NYT articles since last run |
| `node dist/index.js extract --backfill` | Fetch one month further back toward 2019 |
| `node dist/index.js check` | Verify pending speculations against recent news |
| `node dist/index.js report` | Top 40 journalists by claim volume |
| `node dist/index.js report --sort=accuracy` | Same, sorted by % correct |
| `node dist/index.js report --analysis` | Speculation intensity + timeframe breakdown |
| `node dist/index.js edit` | Correct an existing assessment interactively |
| `node dist/index.js nightly` | Full pipeline (extract + backfill + check + email) |

## Architecture
- `src/db.ts` — SQLite schema and all CRUD functions
- `src/nyt.ts` — NYT Article Search API client with retry logic
- `src/extract.ts` — Fetches articles, extracts claims with Claude in batches of 10
- `src/check.ts` — Verifies pending claims against NYT search + Claude assessment
- `src/report.ts` — Journalist stats tables and analysis mode
- `src/edit.ts` — Interactive CLI for correcting assessments
- `src/nightly.ts` — Orchestrates full pipeline + Gmail email summary
- `src/index.ts` — CLI entry point and command dispatcher

Database: `speculations.db` (SQLite, gitignored, lives in project root)
Logs: `~/Library/Logs/trust-nightly.log`
Cron: 2 AM daily via `scripts/nightly.sh`

## Nightly run modes
- **Filling mode** (while oldest_fetched_date > 2019-01-01): 7 backfill months/night, check skipped
- **Normal mode** (once backfill complete): 3 backfill months + 130 claims checked/night

## Current state (as of 2026-03-15)
- Backfill in progress: oldest_fetched_date = 2025-04-02, target = 2019-01-01
- ~2,376 claims in DB, estimated ~30,000 at completion
- Verification largely unstarted — accuracy numbers are not yet meaningful

## Planned features (do not build yet)
1. **Topic classification** — Claude tags each claim with a topic (Foreign Policy, Elections, Economy, etc.), stored as a `topic` column. One-time enrichment job + nightly incremental. ~$30 for full DB.
2. **Journalist follow-up tracking** — did the journalist write follow-up articles about their own prediction? Measures accountability vs. fear-stoking. Needs `journalist_followup` column and NYT author search.

## Environment variables (.env)
- `NYT_API_KEY` — NYT Article Search API
- `ANTHROPIC_API_KEY` — Claude API
- `GMAIL_USER` / `GMAIL_APP_PASSWORD` — nightly email summary
