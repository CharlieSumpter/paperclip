export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue | QueryValue[]>;

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly bodyText: string,
    public readonly url: string,
  ) {
    super(`HTTP ${status} ${statusText} for ${url}: ${bodyText.slice(0, 240)}`);
    this.name = "HttpError";
  }
}

export type RequestOptions = {
  method?: string;
  query?: QueryParams;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** Number of retries on 5xx / 429 / network error. */
  retries?: number;
  /** Backoff base in ms (exponential: base * 2^attempt). */
  retryBackoffMs?: number;
  fetchImpl?: typeof fetch;
};

export async function request<T = unknown>(url: string, opts: RequestOptions = {}): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const method = (opts.method ?? "GET").toUpperCase();
  const finalUrl = appendQuery(url, opts.query);
  const retries = opts.retries ?? 2;
  const backoffMs = opts.retryBackoffMs ?? 250;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  const headers: Record<string, string> = { accept: "application/json", ...(opts.headers ?? {}) };

  let body: BodyInit | undefined;
  if (opts.body !== undefined && opts.body !== null) {
    if (typeof opts.body === "string" || opts.body instanceof URLSearchParams) {
      body = opts.body;
    } else {
      body = JSON.stringify(opts.body);
      headers["content-type"] ??= "application/json";
    }
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(finalUrl, { method, headers, body, signal: controller.signal });
      clearTimeout(timer);

      if (res.ok) {
        return (await parseBody(res)) as T;
      }

      const text = await res.text().catch(() => "");
      const retriable = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (retriable && attempt < retries) {
        await sleep(backoffMs * 2 ** attempt);
        continue;
      }
      throw new HttpError(res.status, res.statusText, text, finalUrl);
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (err instanceof HttpError) throw err;
      if (attempt < retries) {
        await sleep(backoffMs * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function appendQuery(url: string, query?: QueryParams): string {
  if (!query) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item === undefined || item === null) continue;
        u.searchParams.append(k, String(item));
      }
    } else {
      u.searchParams.append(k, String(v));
    }
  }
  return u.toString();
}

async function parseBody(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return res.json();
  }
  const text = await res.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
