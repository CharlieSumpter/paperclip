import { getSecret, type GetSecretOptions } from "./secrets.ts";
import { request, type QueryParams, type RequestOptions } from "./http.ts";

export type ApiKeyScheme =
  | { scheme: "bearer" }
  | { scheme: "header"; headerName: string }
  | { scheme: "query"; paramName: string };

export type ApiKeyConfig = ApiKeyScheme & {
  /** Base URL with no trailing slash, e.g. `"https://api.coingecko.com/api/v3"`. */
  baseUrl: string;
  /** Secret key registered in the secret store, e.g. `"COINGECKO_KEY"`. */
  secretName: string;
  /** Default headers applied to every request. */
  defaultHeaders?: Record<string, string>;
  /** Override the secret resolver — primarily for tests. */
  secretOptions?: GetSecretOptions;
};

export type ApiKeyClient = {
  get<T = unknown>(path: string, query?: QueryParams, opts?: RequestOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  request<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
};

/** Build an API-key-authed HTTP client backed by the Paperclip secret store. */
export function apiKey(cfg: ApiKeyConfig): ApiKeyClient {
  const base = cfg.baseUrl.replace(/\/$/, "");

  async function applyAuth(
    pathOrUrl: string,
    opts: RequestOptions,
  ): Promise<{ url: string; opts: RequestOptions }> {
    const value = await getSecret(cfg.secretName, cfg.secretOptions);
    const headers: Record<string, string> = { ...(cfg.defaultHeaders ?? {}), ...(opts.headers ?? {}) };
    let url = pathOrUrl.startsWith("http") ? pathOrUrl : `${base}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;

    switch (cfg.scheme) {
      case "bearer":
        headers.authorization = `Bearer ${value}`;
        break;
      case "header":
        headers[cfg.headerName] = value;
        break;
      case "query": {
        const u = new URL(url);
        u.searchParams.set(cfg.paramName, value);
        url = u.toString();
        break;
      }
    }
    return { url, opts: { ...opts, headers } };
  }

  return {
    async get(path, query, opts = {}) {
      const prepared = await applyAuth(path, { ...opts, method: "GET", query: { ...(opts.query ?? {}), ...(query ?? {}) } });
      return request(prepared.url, prepared.opts);
    },
    async post(path, body, opts = {}) {
      const prepared = await applyAuth(path, { ...opts, method: "POST", body });
      return request(prepared.url, prepared.opts);
    },
    async request(path, opts = {}) {
      const prepared = await applyAuth(path, opts);
      return request(prepared.url, prepared.opts);
    },
  };
}
