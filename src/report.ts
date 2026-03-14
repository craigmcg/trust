import { openDb, getAll, type Status } from "./db.js";

const TOP_N = 40;

interface JournalistStats {
  name: string;
  total: number;
  articles: number;
  confirmed: number;
  partial: number;
  refuted: number;
  pending: number;
  oldestYear: string;
  newestYear: string;
}

function pct(n: number, total: number): string {
  return total === 0 ? "  —  " : `${((n / total) * 100).toFixed(1)}%`;
}

function buildStats(rows: ReturnType<typeof getAll>): JournalistStats[] {
  const map = new Map<string, JournalistStats>();
  const articleSets = new Map<string, Set<string>>();
  for (const s of rows) {
    const year = s.article_date.slice(0, 4);
    const entry = map.get(s.journalist) ?? { name: s.journalist, total: 0, articles: 0, confirmed: 0, partial: 0, refuted: 0, pending: 0, oldestYear: year, newestYear: year };
    entry[s.status as Status]++;
    entry.total++;
    if (year < entry.oldestYear) entry.oldestYear = year;
    if (year > entry.newestYear) entry.newestYear = year;
    map.set(s.journalist, entry);
    const urls = articleSets.get(s.journalist) ?? new Set<string>();
    urls.add(s.article_url);
    articleSets.set(s.journalist, urls);
  }
  for (const [name, entry] of map) {
    entry.articles = articleSets.get(name)!.size;
  }
  return [...map.values()];
}

function span(j: JournalistStats): string {
  return j.oldestYear === j.newestYear ? j.oldestYear : `${j.oldestYear} → ${j.newestYear}`;
}

function printTable(journalists: JournalistStats[], title: string, total: number): void {
  const divider = "─".repeat(90);
  console.log(`\n${"═".repeat(90)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(90)}\n`);
  console.log(`  ${"Journalist".padEnd(32)} ${"Articles".padStart(8)}  ${"Claims".padStart(6)}  ${"✓ Correct".padStart(10)}  ${"~ Partial".padStart(10)}  ${"✗ Incorrect".padStart(11)}  ${"? Pending".padStart(10)}  ${"Span".padStart(11)}`);
  console.log(`  ${divider}`);

  for (const j of journalists) {
    console.log(
      `  ${j.name.padEnd(32)} ` +
      `${String(j.articles).padStart(8)}  ` +
      `${String(j.total).padStart(6)}  ` +
      `${pct(j.confirmed, j.total).padStart(10)}  ` +
      `${pct(j.partial,   j.total).padStart(10)}  ` +
      `${pct(j.refuted,   j.total).padStart(11)}  ` +
      `${pct(j.pending,   j.total).padStart(10)}  ` +
      `${span(j).padStart(11)}`
    );
  }

  // Totals row
  const t = journalists.reduce(
    (acc, j) => ({ total: acc.total + j.total, articles: acc.articles + j.articles, confirmed: acc.confirmed + j.confirmed, partial: acc.partial + j.partial, refuted: acc.refuted + j.refuted, pending: acc.pending + j.pending }),
    { total: 0, articles: 0, confirmed: 0, partial: 0, refuted: 0, pending: 0 }
  );

  console.log(`  ${divider}`);
  console.log(
    `  ${"TOTAL (shown)".padEnd(32)} ` +
    `${String(t.articles).padStart(8)}  ` +
    `${String(t.total).padStart(6)}  ` +
    `${pct(t.confirmed, t.total).padStart(10)}  ` +
    `${pct(t.partial,   t.total).padStart(10)}  ` +
    `${pct(t.refuted,   t.total).padStart(11)}  ` +
    `${pct(t.pending,   t.total).padStart(10)}`
  );
  console.log(`\n  ${journalists.length} journalists shown of ${total} total\n`);
}

export function runReport(sort: "volume" | "accuracy" = "volume"): void {
  const db = openDb();
  const rows = getAll(db);
  db.close();

  if (rows.length === 0) {
    console.log("No speculations in database. Run `npm run extract` first.");
    return;
  }

  const all = buildStats(rows);

  // Top 40 by total claims
  const top40 = [...all].sort((a, b) => b.total - a.total).slice(0, TOP_N);

  if (sort === "accuracy") {
    // Re-sort the top 40 by % correct (confirmed / total), then by total as tiebreaker
    top40.sort((a, b) => {
      const aAcc = a.total === 0 ? 0 : a.confirmed / a.total;
      const bAcc = b.total === 0 ? 0 : b.confirmed / b.total;
      return bAcc - aAcc || b.total - a.total;
    });
    printTable(top40, `Top ${TOP_N} Journalists by Volume — sorted by % Correct`, all.length);
  } else {
    printTable(top40, `Top ${TOP_N} Journalists by Volume`, all.length);
  }

  // Overall DB totals
  const totals = rows.reduce(
    (acc, s) => { acc[s.status as Status]++; return acc; },
    { confirmed: 0, partial: 0, refuted: 0, pending: 0 }
  );
  console.log(`  DB totals — ${rows.length} claims across ${all.length} journalists`);
  console.log(`  ✓ ${totals.confirmed}  ~ ${totals.partial}  ✗ ${totals.refuted}  ? ${totals.pending}\n`);
}
