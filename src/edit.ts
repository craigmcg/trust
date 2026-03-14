import * as readline from "readline";
import { openDb, getAll, updateStatus, type Status, type Speculation } from "./db.js";

const STATUS_COLOR: Record<Status, string> = {
  confirmed: "\x1b[32m",
  partial:   "\x1b[33m",
  refuted:   "\x1b[31m",
  pending:   "\x1b[90m",
};
const RESET = "\x1b[0m";

function colorStatus(status: Status): string {
  return `${STATUS_COLOR[status]}${status.toUpperCase()}${RESET}`;
}

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function runEdit(): Promise<void> {
  const db = openDb();
  const rows = getAll(db);

  if (rows.length === 0) {
    console.log("No speculations in database.");
    db.close();
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(`\n${"═".repeat(70)}`);
  console.log("  Edit Speculations");
  console.log(`${"═".repeat(70)}\n`);

  // List all speculations
  rows.forEach((s, i) => {
    const status = colorStatus(s.status as Status);
    console.log(`  [${String(i + 1).padStart(2)}] ${status.padEnd(30)} ${s.journalist.padEnd(25)} ${s.claim.slice(0, 40)}...`);
  });

  console.log();
  const input = (await prompt(rl, "Enter number to edit (or Enter to quit): ")).trim();

  if (!input) {
    rl.close();
    db.close();
    return;
  }

  const idx = parseInt(input, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= rows.length) {
    console.log("Invalid selection.");
    rl.close();
    db.close();
    return;
  }

  const spec = rows[idx] as Speculation;

  console.log(`\n${"─".repeat(70)}`);
  console.log(`CLAIM:    ${spec.claim}`);
  console.log(`VERBATIM: "${spec.verbatim}"`);
  console.log(`BY:       ${spec.journalist}  |  ${spec.article_date}`);
  console.log(`STATUS:   ${colorStatus(spec.status as Status)}`);
  if (spec.evidence) console.log(`EVIDENCE: ${spec.evidence}`);
  console.log(`${"─".repeat(70)}`);
  console.log(`\nNew status: c)onfirmed  p)artial  r)efuted  n)pending  Enter to cancel`);

  const answer = (await prompt(rl, "> ")).trim().toLowerCase();

  const map: Record<string, Status> = { c: "confirmed", p: "partial", r: "refuted", n: "pending" };
  const newStatus = map[answer];

  if (!newStatus) {
    console.log("Cancelled.");
    rl.close();
    db.close();
    return;
  }

  let evidence = spec.evidence;
  if (newStatus === "pending") {
    evidence = "";
  } else {
    const note = (await prompt(rl, "Update evidence note (or Enter to keep existing): ")).trim();
    if (note) evidence = note;
  }

  updateStatus(db, spec.id, newStatus, evidence, spec.evidence_url);
  console.log(`\nUpdated to ${colorStatus(newStatus)}.\n`);

  rl.close();
  db.close();
}
