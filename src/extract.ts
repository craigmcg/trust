import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { type Article } from "./nyt.js";
import { openDb, insertSpeculation } from "./db.js";
import { fetchArticles } from "./nyt.js";

const BATCH_SIZE = 10;

const ExtractionSchema = z.object({
  articles: z.array(z.object({
    index: z.number().int(),
    speculations: z.array(z.object({
      claim: z.string(),     // clean, checkable restatement
      verbatim: z.string(),  // exact quote from the text
      timeframe: z.string(), // e.g. "within months", "by end of 2025", or "" if open-ended
    })),
  })),
});

async function extractBatch(
  anthropic: Anthropic,
  articles: Article[]
): Promise<z.infer<typeof ExtractionSchema>> {
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

export async function runExtract(nytKey: string, anthropicKey: string, pages = 5): Promise<void> {
  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const db = openDb();

  console.log("Fetching NYT political articles...");
  const articles = await fetchArticles(nytKey, pages);
  console.log(`\nFetched ${articles.length} articles.\n`);

  console.log("Extracting speculative claims with Claude...\n");
  let totalNew = 0;

  const totalBatches = Math.ceil(articles.length / BATCH_SIZE);
  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    process.stdout.write(`  Batch ${batchNum}/${totalBatches}...\r`);

    const result = await extractBatch(anthropic, batch);

    for (const { index, speculations } of result.articles) {
      const article = batch[index];
      if (!article) continue;

      // Split multi-author bylines
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

  console.log(`\nDone. Stored ${totalNew} speculative claims.\n`);
  db.close();
}
