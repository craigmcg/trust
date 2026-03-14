import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as readline from "readline";
import { openDb, getPending, updateStatus, type Status, type Speculation } from "./db.js";
import { searchArticles, type Article } from "./nyt.js";

const STATUSES: Status[] = ["confirmed", "partial", "refuted", "pending"];

const VerificationSchema = z.object({
  status: z.enum(["confirmed", "refuted", "partial", "pending"]),
  evidence_summary: z.string(),
  evidence_url: z.string(),
});

type VerificationResult = z.infer<typeof VerificationSchema> & {
  evidenceArticles: Article[];
};

async function verifySpeculation(
  anthropic: Anthropic,
  nytKey: string,
  spec: Speculation
): Promise<VerificationResult> {
  const query = spec.claim.replace(/['"]/g, "").slice(0, 100);
  const articles = await searchArticles(nytKey, query, 2);

  if (articles.length === 0) {
    return { status: "pending", evidence_summary: "No relevant articles found yet.", evidence_url: "", evidenceArticles: [] };
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
      content: `ORIGINAL SPECULATION (from ${spec.article_date}, by ${spec.journalist}):
Claim: ${spec.claim}
Verbatim: "${spec.verbatim}"

SUBSEQUENT NEWS ARTICLES:
${articlesText}

Has this speculation come true?`,
    }],
    output_config: {
      format: zodOutputFormat(VerificationSchema),
    },
  });

  return { ...response.parsed_output!, evidenceArticles: articles };
}

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

const STATUS_COLOR: Record<Status, string> = {
  confirmed: "\x1b[32m", // green
  partial:   "\x1b[33m", // yellow
  refuted:   "\x1b[31m", // red
  pending:   "\x1b[90m", // grey
};
const RESET = "\x1b[0m";

function colorStatus(status: Status): string {
  return `${STATUS_COLOR[status]}${status.toUpperCase()}${RESET}`;
}

async function qaReview(
  rl: readline.Interface,
  spec: Speculation,
  result: VerificationResult,
  index: number,
  total: number
): Promise<{ status: Status; evidence: string; url: string }> {
  console.log(`\n${"─".repeat(70)}`);
  console.log(`[${index}/${total}] ${spec.article_date}  by ${spec.journalist}`);
  console.log(`${"─".repeat(70)}`);
  console.log(`\nCLAIM:    ${spec.claim}`);
  console.log(`VERBATIM: "${spec.verbatim}"`);
  if (spec.timeframe) console.log(`TIMEFRAME: ${spec.timeframe}`);

  console.log(`\nEVIDENCE ARTICLES SEARCHED (query: "${spec.claim.slice(0, 60)}..."):`);
  if (result.evidenceArticles.length === 0) {
    console.log("  (none found)");
  } else {
    for (const a of result.evidenceArticles) {
      console.log(`  [${a.date}] ${a.headline}`);
      console.log(`           ${a.abstract.slice(0, 120)}...`);
      console.log(`           ${a.url}`);
    }
  }

  console.log(`\nCLAUDE'S ASSESSMENT: ${colorStatus(result.status)}`);
  console.log(`REASONING: ${result.evidence_summary}`);

  console.log(`\nAccept? [Enter] or override: c)onfirmed  p)artial  r)efuted  n)pending  s)kip`);
  const answer = (await prompt(rl, "> ")).trim().toLowerCase();

  if (answer === "s") {
    return { status: "pending", evidence: "", url: "" }; // skip = don't save
  }

  let status = result.status;
  if (answer === "c") status = "confirmed";
  else if (answer === "p") status = "partial";
  else if (answer === "r") status = "refuted";
  else if (answer === "n") status = "pending";

  let evidence = result.evidence_summary;
  let url = result.evidence_url;

  if (status !== result.status) {
    console.log(`\nOverriding to ${colorStatus(status)}.`);
    const note = (await prompt(rl, "Add a note (or Enter to skip): ")).trim();
    if (note) evidence = note;
  }

  return { status, evidence, url };
}

export type CheckStats = Record<Status, number>;

export async function runCheck(nytKey: string, anthropicKey: string, qa = false): Promise<CheckStats> {
  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const db = openDb();

  const pending = getPending(db);
  if (pending.length === 0) {
    console.log("No pending speculations to check.");
    db.close();
    return { confirmed: 0, partial: 0, refuted: 0, pending: 0 };
  }

  console.log(`Checking ${pending.length} pending speculations${qa ? " (QA mode)" : ""}...\n`);

  const rl = qa ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  const counts: Record<Status, number> = { confirmed: 0, refuted: 0, partial: 0, pending: 0 };
  let skipped = 0;

  for (let i = 0; i < pending.length; i++) {
    const spec = pending[i]!;

    if (!qa) {
      process.stdout.write(`  [${i + 1}/${pending.length}] ${spec.claim.slice(0, 60)}...\r`);
    }

    const result = await verifySpeculation(anthropic, nytKey, spec);

    if (qa && rl) {
      const decision = await qaReview(rl, spec, result, i + 1, pending.length);
      if (decision.evidence === "" && decision.url === "" && decision.status === "pending" && result.status !== "pending") {
        // skipped
        skipped++;
        continue;
      }
      updateStatus(db, spec.id, decision.status, decision.evidence, decision.url);
      counts[decision.status]++;
    } else {
      updateStatus(db, spec.id, result.status, result.evidence_summary, result.evidence_url);
      counts[result.status]++;
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  rl?.close();

  console.log(`\n${"─".repeat(40)}`);
  console.log(`Done.`);
  if (skipped) console.log(`  skipped:   ${skipped}`);
  console.log(`  confirmed: ${counts.confirmed}`);
  console.log(`  partial:   ${counts.partial}`);
  console.log(`  refuted:   ${counts.refuted}`);
  console.log(`  pending:   ${counts.pending}\n`);

  db.close();
  return counts;
}
