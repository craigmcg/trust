const BASE_URL = "https://api.nytimes.com/svc/search/v2/articlesearch.json";

export interface Article {
  headline: string;
  journalist: string;
  abstract: string;
  snippet: string;
  leadParagraph: string;
  url: string;
  date: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPage(
  apiKey: string,
  page: number,
  query: string,
  beginDate?: string,
  endDate?: string,
  retries = 3
): Promise<Article[]> {
  const params = new URLSearchParams({ q: query, page: String(page), sort: "newest", "api-key": apiKey });
  if (beginDate) params.set("begin_date", beginDate);
  if (endDate) params.set("end_date", endDate);
  const response = await fetch(`${BASE_URL}?${params}`);

  if (response.status === 429 && retries > 0) {
    const wait = (4 - retries) * 10000 + 10000;
    process.stdout.write(`\n  Rate limited, retrying in ${wait / 1000}s...`);
    await sleep(wait);
    return fetchPage(apiKey, page, query, beginDate, endDate, retries - 1);
  }

  if (!response.ok) return [];

  const data = await response.json() as {
    status: string;
    response?: {
      docs: Array<{
        headline: { main: string };
        byline?: { original?: string };
        abstract?: string;
        snippet?: string;
        lead_paragraph?: string;
        web_url?: string;
        pub_date?: string;
      }>;
    };
  };

  if (data.status !== "OK" || !data.response?.docs) return [];

  return data.response.docs.map((doc) => ({
    headline: doc.headline.main,
    journalist: (doc.byline?.original ?? "Unknown").replace(/^By /i, "").trim(),
    abstract: doc.abstract ?? "",
    snippet: doc.snippet ?? "",
    leadParagraph: doc.lead_paragraph ?? "",
    url: doc.web_url ?? "",
    date: (doc.pub_date ?? "").slice(0, 10),
  }));
}

export async function fetchArticles(
  apiKey: string,
  options: { beginDate?: string; endDate?: string; maxPages?: number } = {}
): Promise<Article[]> {
  const { beginDate, endDate, maxPages = 100 } = options;
  const articles: Article[] = [];

  for (let page = 0; page < maxPages; page++) {
    process.stdout.write(`  Page ${page + 1} (${articles.length} articles so far)...\r`);
    const batch = await fetchPage(apiKey, page, "politics", beginDate, endDate);
    articles.push(...batch);
    if (batch.length < 10) break; // last page
    if (page < maxPages - 1) await sleep(2000);
  }

  return articles;
}

export async function searchArticles(apiKey: string, query: string, pages = 3): Promise<Article[]> {
  const articles: Article[] = [];
  for (let page = 0; page < pages; page++) {
    articles.push(...await fetchPage(apiKey, page, query));
    if (page < pages - 1) await sleep(2000);
  }
  return articles;
}

// Format a Date as YYYYMMDD for the NYT API
export function toNytDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

// Subtract N months from a date
export function subtractMonths(d: Date, months: number): Date {
  const result = new Date(d);
  result.setMonth(result.getMonth() - months);
  return result;
}
