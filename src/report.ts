import { openDb, getAll, type Status, type Speculation } from "./db.js";

const TOP_N = 40;

// ── Analysis mode types ──────────────────────────────────────────────────────

type TimeframeBucket =
  | "Election-tied" | "Near-term" | "Short-term" | "Medium-term"
  | "Long-term" | "Court/legal" | "Ongoing" | "Unspecified";

interface IntensityRow {
  name: string;
  articles: number;
  claims: number;
  ratio: number;
  topBucket: TimeframeBucket;
}

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
  const divider = "─".repeat(113);
  console.log(`\n${"═".repeat(115)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(115)}\n`);
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

// ── Analysis mode functions ──────────────────────────────────────────────────

function classifyTimeframe(tf: string): TimeframeBucket {
  const t = tf.toLowerCase();
  if (/election|midterm|primary|2026|2024|2028/.test(t)) return "Election-tied";
  if (/week|day|imminent|hour/.test(t))                  return "Short-term";
  if (/month/.test(t))                                   return "Medium-term";
  if (/year|long-term/.test(t))                          return "Long-term";
  if (/court|ruling|verdict|legal|lawsuit|case/.test(t)) return "Court/legal";
  if (/ongoing/.test(t))                                 return "Ongoing";
  if (/near/.test(t))                                    return "Near-term";
  return "Unspecified";
}

function buildIntensityRows(rows: Speculation[], minArticles = 5): IntensityRow[] {
  const claimsMap   = new Map<string, Speculation[]>();
  const articleSets = new Map<string, Set<string>>();

  for (const s of rows) {
    const claims = claimsMap.get(s.journalist) ?? [];
    claims.push(s);
    claimsMap.set(s.journalist, claims);
    const urls = articleSets.get(s.journalist) ?? new Set<string>();
    urls.add(s.article_url);
    articleSets.set(s.journalist, urls);
  }

  const result: IntensityRow[] = [];
  for (const [name, claims] of claimsMap) {
    const articles = articleSets.get(name)!.size;
    if (articles < minArticles) continue;

    const bucketCounts = new Map<TimeframeBucket, number>();
    for (const s of claims) {
      const b = classifyTimeframe(s.timeframe);
      bucketCounts.set(b, (bucketCounts.get(b) ?? 0) + 1);
    }
    const topBucket = ([...bucketCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["Unspecified"])[0] as TimeframeBucket;

    result.push({ name, articles, claims: claims.length, ratio: claims.length / articles, topBucket });
  }

  return result.sort((a, b) => b.ratio - a.ratio || b.claims - a.claims);
}

function buildTimeframeBuckets(rows: Speculation[]): { bucket: TimeframeBucket; count: number }[] {
  const counts = new Map<TimeframeBucket, number>();
  for (const s of rows) {
    const b = classifyTimeframe(s.timeframe);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const ORDER: TimeframeBucket[] = [
    "Election-tied", "Near-term", "Short-term", "Medium-term",
    "Long-term", "Court/legal", "Ongoing", "Unspecified",
  ];
  return ORDER.map(bucket => ({ bucket, count: counts.get(bucket) ?? 0 }));
}

function printIntensityTable(rows: IntensityRow[]): void {
  const TOP = 20;
  const shown = rows.slice(0, TOP);
  const divider = "─".repeat(83);
  console.log(`\n${"═".repeat(85)}`);
  console.log(`  Speculation Intensity — Top ${TOP} by Claims/Article (min 5 articles)`);
  console.log(`${"═".repeat(85)}\n`);
  console.log(`  ${"Journalist".padEnd(32)} ${"Articles".padStart(8)}  ${"Claims".padStart(6)}  ${"Claims/Art".padStart(10)}  ${"Top Timeframe"}`);
  console.log(`  ${divider}`);
  for (const r of shown) {
    console.log(
      `  ${r.name.padEnd(32)} ` +
      `${String(r.articles).padStart(8)}  ` +
      `${String(r.claims).padStart(6)}  ` +
      `${r.ratio.toFixed(2).padStart(10)}  ` +
      `${r.topBucket}`
    );
  }
  console.log(`\n  ${rows.length} journalists qualify (≥5 articles), showing top ${TOP}\n`);
}

function printTimeframeTable(buckets: { bucket: TimeframeBucket; count: number }[], total: number): void {
  const divider = "─".repeat(42);
  console.log(`${"═".repeat(44)}`);
  console.log(`  Timeframe Distribution — ${total} total claims`);
  console.log(`${"═".repeat(44)}\n`);
  console.log(`  ${"Bucket".padEnd(16)} ${"Claims".padStart(7)}  ${"% of Total".padStart(10)}`);
  console.log(`  ${divider}`);
  for (const { bucket, count } of buckets) {
    console.log(`  ${bucket.padEnd(16)} ${String(count).padStart(7)}  ${pct(count, total).padStart(10)}`);
  }
  console.log(`  ${divider}`);
  console.log(`  ${"TOTAL".padEnd(16)} ${String(total).padStart(7)}\n`);
}

export function runAnalysis(): void {
  const db = openDb();
  const rows = getAll(db);
  db.close();

  if (rows.length === 0) {
    console.log("No speculations in database. Run `npm run extract` first.");
    return;
  }

  printIntensityTable(buildIntensityRows(rows));
  printTimeframeTable(buildTimeframeBuckets(rows), rows.length);
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
