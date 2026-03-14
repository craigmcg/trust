import { openDb, getAll, type Speculation, type Status } from "./db.js";

const STATUS_ICON: Record<Status, string> = {
  confirmed: "✓",
  refuted:   "✗",
  partial:   "~",
  pending:   "?",
};

export function runReport(): void {
  const db = openDb();
  const rows = getAll(db);
  db.close();

  if (rows.length === 0) {
    console.log("No speculations in database. Run `npm run extract` first.");
    return;
  }

  // ── All speculations ──
  console.log(`\n${"═".repeat(70)}`);
  console.log("  All Speculations");
  console.log(`${"═".repeat(70)}\n`);

  for (const s of rows) {
    const icon = STATUS_ICON[s.status as Status] ?? "?";
    console.log(`[${icon}] ${s.claim}`);
    console.log(`    By: ${s.journalist}  |  ${s.article_date}`);
    console.log(`    "${s.verbatim}"`);
    if (s.timeframe) console.log(`    Timeframe: ${s.timeframe}`);
    if (s.evidence) console.log(`    Evidence: ${s.evidence}`);
    console.log();
  }

  // ── Journalist summary ──
  const byJournalist = new Map<string, { confirmed: number; partial: number; refuted: number; pending: number; total: number }>();

  for (const s of rows) {
    const entry = byJournalist.get(s.journalist) ?? { confirmed: 0, partial: 0, refuted: 0, pending: 0, total: 0 };
    entry[s.status as Status]++;
    entry.total++;
    byJournalist.set(s.journalist, entry);
  }

  // Sort by total speculations descending
  const sorted = [...byJournalist.entries()].sort((a, b) => b[1].total - a[1].total);

  console.log(`${"═".repeat(70)}`);
  console.log("  Journalist Summary");
  console.log(`${"═".repeat(70)}\n`);
  console.log(`  ${"Journalist".padEnd(30)} Total  ✓ conf  ~ part  ✗ ref  ? pend`);
  console.log(`  ${"─".repeat(65)}`);

  for (const [name, counts] of sorted) {
    console.log(
      `  ${name.padEnd(30)} ${String(counts.total).padStart(5)}  ` +
      `${String(counts.confirmed).padStart(6)}  ` +
      `${String(counts.partial).padStart(6)}  ` +
      `${String(counts.refuted).padStart(5)}  ` +
      `${String(counts.pending).padStart(6)}`
    );
  }

  // ── Overall stats ──
  const totals = rows.reduce(
    (acc, s) => { acc[s.status as Status]++; return acc; },
    { confirmed: 0, partial: 0, refuted: 0, pending: 0 }
  );

  console.log(`\n  Total: ${rows.length} speculations`);
  console.log(`  ✓ confirmed: ${totals.confirmed}  ~ partial: ${totals.partial}  ✗ refuted: ${totals.refuted}  ? pending: ${totals.pending}\n`);
}
