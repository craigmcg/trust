import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { openDb, getPending, updateStatus, type Status } from "./db.js";
import { searchArticles } from "./nyt.js";

const VerificationSchema = z.object({
  status: z.enum(["confirmed", "refuted", "partial", "pending"]),
  evidence_summary: z.string(),
  evidence_url: z.string(),
});

async function verifySpeculation(
  anthropic: Anthropic,
  nytKey: string,
  speculation: { id: number; claim: string; verbatim: string; article_date: string; journalist: string }
): Promise<z.infer<typeof VerificationSchema>> {
  // Build a search query from the claim
  const query = speculation.claim.replace(/['"]/g, "").slice(0, 100);
  const articles = await searchArticles(nytKey, query, 2);

  if (articles.length === 0) {
    return { status: "pending", evidence_summary: "No relevant articles found yet.", evidence_url: "" };
  }

  const articlesText = articles
    .map((a) => `DATE: ${a.date}\nHEADLINE: ${a.headline}\nABSTRACT: ${a.abstract}\nSNIPPET: ${a.snippet}\nURL: ${a.url}`)
    .join("\n\n---\n\n");

  const response = await anthropic.messages.parse({
    model: "claude-opus-4-6",
    max_tokens: 1024,
    system: `You assess whether a journalistic speculation has come true based on subsequent news articles.

Statuses:
- confirmed: Evidence clearly shows the speculated event happened
- refuted: Evidence clearly shows the opposite happened, or it definitively did not happen
- partial: Some aspects happened but not others, or it happened in a weaker/different form
- pending: Not enough evidence yet to determine outcome

Be conservative — only mark confirmed/refuted when evidence is clear. When in doubt, use pending.`,
    messages: [{
      role: "user",
      content: `ORIGINAL SPECULATION (from ${speculation.article_date}, by ${speculation.journalist}):
Claim: ${speculation.claim}
Verbatim: "${speculation.verbatim}"

SUBSEQUENT NEWS ARTICLES:
${articlesText}

Has this speculation come true?`,
    }],
    output_config: {
      format: zodOutputFormat(VerificationSchema),
    },
  });

  return response.parsed_output!;
}

export async function runCheck(nytKey: string, anthropicKey: string): Promise<void> {
  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const db = openDb();

  const pending = getPending(db);
  if (pending.length === 0) {
    console.log("No pending speculations to check.");
    db.close();
    return;
  }

  console.log(`Checking ${pending.length} pending speculations...\n`);

  const counts: Record<Status, number> = { confirmed: 0, refuted: 0, partial: 0, pending: 0 };

  for (let i = 0; i < pending.length; i++) {
    const spec = pending[i]!;
    process.stdout.write(`  [${i + 1}/${pending.length}] ${spec.claim.slice(0, 60)}...\r`);

    const result = await verifySpeculation(anthropic, nytKey, spec);
    updateStatus(db, spec.id, result.status, result.evidence_summary, result.evidence_url);
    counts[result.status]++;

    // Small delay to avoid rate limits
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\nDone.\n`);
  console.log(`  confirmed: ${counts.confirmed}`);
  console.log(`  partial:   ${counts.partial}`);
  console.log(`  refuted:   ${counts.refuted}`);
  console.log(`  pending:   ${counts.pending}\n`);

  db.close();
}
