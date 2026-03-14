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

export async function runExtract(
  nytKey: string,
  anthropicKey: string,
  options: { backfill?: boolean; months?: number } = {}
): Promise<void> {
  const { backfill = false, months = 1 } = options;
  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const db = openDb();

  let beginDate: string;
  let endDate: string;
  let label: string;

  if (backfill) {
    // Work backwards from where we left off
    const oldest = getState(db, "oldest_fetched_date");
    const windowEnd = oldest ? new Date(oldest) : new Date();
    windowEnd.setDate(windowEnd.getDate() - 1); // day before oldest
    const windowStart = subtractMonths(windowEnd, months);

    beginDate = toNytDate(windowStart);
    endDate = toNytDate(windowEnd);
    label = `backfill ${windowStart.toISOString().slice(0, 7)} → ${windowEnd.toISOString().slice(0, 7)}`;

    setState(db, "oldest_fetched_date", windowStart.toISOString().slice(0, 10));
  } else {
    // Fetch new articles since last run
    const newest = getState(db, "newest_fetched_date");
    const windowStart = newest ? new Date(newest) : subtractMonths(new Date(), 1);
    const windowEnd = new Date();

    beginDate = toNytDate(windowStart);
    endDate = toNytDate(windowEnd);
    label = `new articles ${windowStart.toISOString().slice(0, 10)} → ${windowEnd.toISOString().slice(0, 10)}`;

    setState(db, "newest_fetched_date", windowEnd.toISOString().slice(0, 10));
  }

  db.close();

  console.log(`Fetching NYT articles (${label})...`);
  const articles = await fetchArticles(nytKey, { beginDate, endDate });
  console.log(`\nFetched ${articles.length} articles.\n`);

  if (articles.length === 0) {
    console.log("No articles found for this date range.");
    return;
  }

  console.log("Extracting speculative claims with Claude...\n");
  const totalNew = await processArticles(anthropic, articles);
  console.log(`\nDone. Stored ${totalNew} new speculative claims.\n`);

  if (backfill) {
    const db2 = openDb();
    const oldest = getState(db2, "oldest_fetched_date");
    db2.close();
    console.log(`Progress: oldest fetched date is now ${oldest}`);
    console.log(`Run 'npm run extract:backfill' again to go further back.\n`);
  }
}
