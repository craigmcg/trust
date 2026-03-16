import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { type Article, fetchArticles, toNytDate, subtractMonths } from "./nyt.js";
import { openDb, insertSpeculation, getState, setState } from "./db.js";

const BATCH_SIZE = 10;

const ExtractionSchema = z.object({
  articles: z.array(z.object({
    index: z.number().int(),
    speculations: z.array(z.object({
      claim: z.string(),
      verbatim: z.string(),
      timeframe: z.string(),
    })),
  })),
});

async function extractBatch(anthropic: Anthropic, articles: Article[]): Promise<z.infer<typeof ExtractionSchema>> {
  const text = articles
    .map((a, i) =>
      `[${i}] HEADLINE: ${a.headline}\nJOURNALIST: ${a.journalist}\nDATE: ${a.date}\nABSTRACT: ${a.abstract}\nSNIPPET: ${a.snippet}\nLEAD: ${a.leadParagraph}`
    )
    .join("\n\n---\n\n");

  const response = await anthropic.messages.parse({
    model: "claude-opus-4-6",
    max_tokens: 4096,
    system: `You are an expert at identifying falsifiable speculative claims in political journalism.

Extract ONLY specific, checkable predictions about future real-world events. A good speculation:
- Makes a concrete claim about something that could actually happen or not happen
- Is specific enough that we could later find news evidence confirming or refuting it
- Is about real-world events, not just opinions or characterizations

Good examples:
- "Trump's Iran military action may draw China into the conflict"
- "The housing executive order could collapse bipartisan legislation"
- "Tariff refunds may take over a year to process"

NOT worth extracting (too vague):
- "experts are concerned" (no specific outcome)
- "the situation remains uncertain" (non-claim)
- "the policy may be controversial" (not checkable)

For each speculation, also capture the verbatim quote and any implied timeframe.
If an article has no checkable speculations, return an empty array for it.`,
    messages: [{
      role: "user",
      content: `Extract falsifiable speculative claims from these articles:\n\n${text}`,
    }],
    output_config: {
      format: zodOutputFormat(ExtractionSchema),
    },
  });

  return response.parsed_output!;
}

export interface ExtractStats {
  articles: number;
  claims: number;
  oldestFetched: string | null;
  backfillComplete: boolean;
}

async function processArticles(anthropic: Anthropic, articles: Article[]): Promise<number> {
  const db = openDb();
  let totalNew = 0;

  const totalBatches = Math.ceil(articles.length / BATCH_SIZE);
  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    process.stdout.write(`  Extracting batch ${batchNum}/${totalBatches}...\r`);

    const result = await extractBatch(anthropic, batch);

    for (const { index, speculations } of result.articles) {
      const article = batch[index];
      if (!article) continue;

      const journalists = article.journalist
        .split(/,| and /)
        .map((n) => n.trim())
        .filter(Boolean);

      for (const spec of speculations) {
        for (const journalist of journalists) {
          insertSpeculation(db, {
            journalist,
            article_headline: article.headline,
            article_url: article.url,
            article_date: article.date,
            claim: spec.claim,
            verbatim: spec.verbatim,
            timeframe: spec.timeframe,
          });
          totalNew++;
        }
      }
    }
  }

  db.close();
  return totalNew;
}

const BACKFILL_STOP_DATE = "2019-01-01";

export async function runExtract(
  nytKey: string,
  anthropicKey: string,
  options: { backfill?: boolean; months?: number; refetch?: string } = {}
): Promise<ExtractStats> {
  const { backfill = false, months = 1, refetch } = options;

  // Refetch mode: fetch a specific YYYY-MM without touching the state pointer
  if (refetch) {
    const [year, month] = refetch.split("-").map(Number);
    const windowStart = new Date(year!, month! - 1, 1);
    const windowEnd = new Date(year!, month!, 0); // last day of month
    const beginDate = toNytDate(windowStart);
    const endDate = toNytDate(windowEnd);
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    console.log(`Refetching NYT articles for ${refetch} (${beginDate} → ${endDate})...`);
    const articles = await fetchArticles(nytKey, { beginDate, endDate });
    console.log(`\nFetched ${articles.length} articles.\n`);
    if (articles.length === 0) {
      console.log("No articles found.");
      return { articles: 0, claims: 0, oldestFetched: null, backfillComplete: false };
    }
    console.log("Extracting speculative claims with Claude...\n");
    const totalNew = await processArticles(anthropic, articles);
    console.log(`\nDone. Stored ${totalNew} new claims for ${refetch}.\n`);
    return { articles: articles.length, claims: totalNew, oldestFetched: null, backfillComplete: false };
  }
  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const db = openDb();

  let beginDate: string;
  let endDate: string;
  let label: string;

  if (backfill) {
    const oldest = getState(db, "oldest_fetched_date");
    const windowEnd = oldest ? new Date(oldest) : new Date();
    windowEnd.setDate(windowEnd.getDate() - 1);

    // Check if we've already reached the stop date
    if (windowEnd.toISOString().slice(0, 10) <= BACKFILL_STOP_DATE) {
      console.log(`Backfill complete — reached stop date ${BACKFILL_STOP_DATE}.`);
      db.close();
      return { articles: 0, claims: 0, oldestFetched: BACKFILL_STOP_DATE, backfillComplete: true };
    }

    // Clamp window start to stop date
    const windowStart = subtractMonths(windowEnd, months);
    const stopDate = new Date(BACKFILL_STOP_DATE);
    if (windowStart < stopDate) windowStart.setTime(stopDate.getTime());

    beginDate = toNytDate(windowStart);
    endDate = toNytDate(windowEnd);
    label = `backfill ${windowStart.toISOString().slice(0, 10)} → ${windowEnd.toISOString().slice(0, 10)}`;

    const monthsRemaining = Math.ceil(
      (windowEnd.getTime() - stopDate.getTime()) / (1000 * 60 * 60 * 24 * 30)
    );
    db.close();
    console.log(`Fetching NYT articles (${label})...`);
    console.log(`~${monthsRemaining} months remaining to ${BACKFILL_STOP_DATE}\n`);
  } else {
    const newest = getState(db, "newest_fetched_date");
    const windowStart = newest ? new Date(newest) : subtractMonths(new Date(), 1);
    const windowEnd = new Date();

    beginDate = toNytDate(windowStart);
    endDate = toNytDate(windowEnd);
    label = `new articles ${windowStart.toISOString().slice(0, 10)} → ${windowEnd.toISOString().slice(0, 10)}`;

    setState(db, "newest_fetched_date", windowEnd.toISOString().slice(0, 10));
    db.close();
    console.log(`Fetching NYT articles (${label})...`);
  }

  const articles = await fetchArticles(nytKey, { beginDate, endDate });
  console.log(`\nFetched ${articles.length} articles.\n`);

  if (articles.length === 0) {
    console.log("No articles found for this date range.");
    const db2 = openDb();
    const oldest = getState(db2, "oldest_fetched_date");
    db2.close();
    return { articles: 0, claims: 0, oldestFetched: oldest, backfillComplete: false };
  }

  console.log("Extracting speculative claims with Claude...\n");
  const totalNew = await processArticles(anthropic, articles);
  console.log(`\nDone. Stored ${totalNew} new speculative claims.\n`);

  // Update state only after successful fetch+process
  const db2 = openDb();
  if (backfill) setState(db2, "oldest_fetched_date", beginDate.slice(0, 4) + "-" + beginDate.slice(4, 6) + "-" + beginDate.slice(6, 8));
  const oldest = getState(db2, "oldest_fetched_date");
  db2.close();

  if (backfill) {
    const complete = oldest !== null && oldest <= BACKFILL_STOP_DATE;
    console.log(`Oldest fetched: ${oldest}  |  Stop date: ${BACKFILL_STOP_DATE}`);
    console.log(complete ? "Backfill complete!" : `Run 'npm run extract:backfill' again to continue.\n`);
    return { articles: articles.length, claims: totalNew, oldestFetched: oldest, backfillComplete: complete };
  }

  return { articles: articles.length, claims: totalNew, oldestFetched: oldest, backfillComplete: false };
}
