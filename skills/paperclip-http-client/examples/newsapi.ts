import { apiKey } from "../scripts/api-key.ts";

/**
 * NewsAPI.org — `X-Api-Key` header.
 *
 * Register the secret once:
 *   POST /api/companies/:companyId/secrets { name: "NEWSAPI_KEY", value: "..." }
 *
 * Free dev tier is rate-limited to 100 req/day; bake any pagination on top.
 */
export const newsapi = apiKey({
  baseUrl: "https://newsapi.org/v2",
  secretName: "NEWSAPI_KEY",
  scheme: "header",
  headerName: "x-api-key",
});

export type Article = {
  source: { id: string | null; name: string };
  author: string | null;
  title: string;
  description: string | null;
  url: string;
  urlToImage: string | null;
  publishedAt: string;
  content: string | null;
};

export type ArticlesPage = {
  status: string;
  totalResults: number;
  articles: Article[];
};

export async function searchEverything(
  q: string,
  opts: { from?: string; to?: string; language?: string; pageSize?: number; page?: number } = {},
): Promise<ArticlesPage> {
  return newsapi.get<ArticlesPage>("/everything", {
    q,
    from: opts.from,
    to: opts.to,
    language: opts.language ?? "en",
    sortBy: "publishedAt",
    pageSize: opts.pageSize ?? 25,
    page: opts.page ?? 1,
  });
}

export async function getTopHeadlines(
  opts: { country?: string; category?: string; q?: string; pageSize?: number } = {},
): Promise<ArticlesPage> {
  return newsapi.get<ArticlesPage>("/top-headlines", {
    country: opts.country ?? "us",
    category: opts.category,
    q: opts.q,
    pageSize: opts.pageSize ?? 25,
  });
}
