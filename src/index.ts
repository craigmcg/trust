import * as dotenv from "dotenv";
dotenv.config();

const API_KEY = process.env.NYT_API_KEY;
if (!API_KEY) {
  console.error("Missing NYT_API_KEY in .env");
  process.exit(1);
}

const BASE_URL = "https://api.nytimes.com/svc/search/v2/articlesearch.json";
const PAGES = 10;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPage(page: number, retries = 3): Promise<string[]> {
  const params = new URLSearchParams({
    q: "politics",
    page: String(page),
    "api-key": API_KEY!,
  });

  const response = await fetch(`${BASE_URL}?${params}`);

  if (response.status === 429 && retries > 0) {
    const wait = (4 - retries) * 10000 + 10000; // 10s, 20s, 30s
    console.log(`Rate limited on page ${page}, retrying in ${wait / 1000}s...`);
    await sleep(wait);
    return fetchPage(page, retries - 1);
  }

  if (!response.ok) {
    console.error(`Page ${page} failed: ${response.status}`);
    return [];
  }

  const data = await response.json() as {
    status: string;
    response?: { docs: Array<{ byline?: { original?: string } }> };
  };

  if (data.status !== "OK" || !data.response?.docs) return [];

  return data.response.docs
    .map((doc) => doc.byline?.original)
    .filter((name): name is string => Boolean(name))
    .map((name) => name.replace(/^By /i, "").trim());
}

async function getPoliticalJournalists(): Promise<void> {
  const counts = new Map<string, number>();

  for (let page = 0; page < PAGES; page++) {
    process.stdout.write(`Fetching page ${page + 1}/${PAGES}...\r`);
    const bylines = await fetchPage(page);
    for (const name of bylines) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    if (page < PAGES - 1) await sleep(2000);
  }

  const journalists = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  console.log(`\nFound ${journalists.length} NYT political journalists:\n`);
  journalists.forEach(([name, count]) => {
    console.log(`  ${name} (${count} articles)`);
  });
}

getPoliticalJournalists().catch(console.error);
