import * as dotenv from "dotenv";
import nodemailer from "nodemailer";
import { runExtract, type ExtractStats } from "./extract.js";
import { runCheck, type CheckStats } from "./check.js";
import { openDb, getDbStats } from "./db.js";
dotenv.config();

const NYT_API_KEY     = process.env.NYT_API_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const GMAIL_USER      = process.env.GMAIL_USER!;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD!;
const EMAIL_TO        = "craigmcg.acc@gmail.com";

// Budget: 500 req/day free tier
// ~20 for new extract, ~65/month for backfill, ~60 for check → 5 backfill runs/night
const BACKFILL_RUNS_PER_NIGHT = 5;

async function sendEmail(subject: string, body: string): Promise<void> {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    console.log("Email not configured — skipping. Add GMAIL_USER and GMAIL_APP_PASSWORD to .env");
    console.log("\n--- EMAIL BODY ---\n" + body);
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  await transporter.sendMail({
    from: GMAIL_USER,
    to: EMAIL_TO,
    subject,
    text: body,
  });

  console.log(`Email sent to ${EMAIL_TO}`);
}

export async function runNightly(): Promise<void> {
  const started = new Date();
  console.log(`\n=== Nightly run started ${started.toISOString()} ===\n`);

  const errors: string[] = [];
  let newExtract: ExtractStats = { articles: 0, claims: 0, oldestFetched: null, backfillComplete: false };
  const backfillRuns: ExtractStats[] = [];
  let checkStats: CheckStats = { confirmed: 0, partial: 0, refuted: 0, pending: 0 };

  // 1. Fetch new articles
  console.log("--- Step 1: Fetch new articles ---");
  try {
    newExtract = await runExtract(NYT_API_KEY, ANTHROPIC_API_KEY, { backfill: false });
  } catch (err) {
    errors.push(`Extract (new): ${err}`);
    console.error("Extract (new) failed:", err);
  }

  // 2. Backfill (up to BACKFILL_RUNS_PER_NIGHT months)
  console.log(`\n--- Step 2: Backfill (up to ${BACKFILL_RUNS_PER_NIGHT} months) ---`);
  for (let i = 0; i < BACKFILL_RUNS_PER_NIGHT; i++) {
    try {
      const stats = await runExtract(NYT_API_KEY, ANTHROPIC_API_KEY, { backfill: true });
      backfillRuns.push(stats);
      if (stats.backfillComplete) {
        console.log("Backfill complete — stopping early.");
        break;
      }
    } catch (err) {
      errors.push(`Backfill run ${i + 1}: ${err}`);
      console.error(`Backfill run ${i + 1} failed:`, err);
      break;
    }
  }

  // 3. Check pending speculations
  console.log("\n--- Step 3: Check pending speculations ---");
  try {
    checkStats = await runCheck(NYT_API_KEY, ANTHROPIC_API_KEY, false);
  } catch (err) {
    errors.push(`Check: ${err}`);
    console.error("Check failed:", err);
  }

  // 4. Build email
  const db = openDb();
  const stats = getDbStats(db);
  db.close();

  const backfillArticles = backfillRuns.reduce((s, r) => s + r.articles, 0);
  const backfillClaims   = backfillRuns.reduce((s, r) => s + r.claims, 0);
  const oldestFetched    = backfillRuns.at(-1)?.oldestFetched ?? newExtract.oldestFetched;
  const backfillComplete = backfillRuns.some((r) => r.backfillComplete);

  const duration = Math.round((Date.now() - started.getTime()) / 1000 / 60);
  const date = started.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const body = `
Trust — Nightly Run Summary
${date}
${"─".repeat(50)}

NEW ARTICLES
  Fetched:        ${newExtract.articles}
  New claims:     ${newExtract.claims}

BACKFILL  (${backfillRuns.length} month${backfillRuns.length !== 1 ? "s" : ""} processed)
  Articles:       ${backfillArticles}
  New claims:     ${backfillClaims}
  Oldest fetched: ${oldestFetched ?? "n/a"}
  ${backfillComplete ? "✓ Backfill complete — all data since 2019-01-01 loaded." : "→ Run again tomorrow to continue backfill."}

VERIFICATION
  Confirmed:      ${checkStats.confirmed}
  Partial:        ${checkStats.partial}
  Refuted:        ${checkStats.refuted}
  Still pending:  ${checkStats.pending}

DATABASE TOTALS
  Total claims:   ${stats.total}
  Confirmed:      ${stats.confirmed}
  Partial:        ${stats.partial}
  Refuted:        ${stats.refuted}
  Pending:        ${stats.pending}
  Journalists:    ${stats.journalists}
  Date range:     ${stats.oldestArticle} → ${stats.newestArticle}

${errors.length > 0 ? `ERRORS\n${errors.map((e) => `  ! ${e}`).join("\n")}\n` : "No errors."}
Duration: ${duration} min
`.trim();

  const subject = errors.length > 0
    ? `[trust] Nightly run — ${errors.length} error(s)`
    : `[trust] Nightly run — ${newExtract.claims + backfillClaims} new claims`;

  console.log("\n--- Step 4: Send email ---");
  await sendEmail(subject, body);

  console.log(`\n=== Done in ${duration} min ===\n`);
}
