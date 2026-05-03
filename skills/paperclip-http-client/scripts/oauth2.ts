import { getSecret, type GetSecretOptions } from "./secrets.ts";
import { request, type QueryParams, type RequestOptions } from "./http.ts";

export type OAuth2Config = {
  baseUrl: string;
  tokenUrl: string;
  /** Secret name holding the client id (often safe to keep public, but treated as a secret for consistency). */
  clientIdSecret: string;
  /** Secret name holding the client secret. */
  clientSecretSecret: string;
  /** Optional comma-separated scopes. */
  scope?: string;
  /** Extra body fields appended to the token request (e.g. `audience`). */
  extraTokenParams?: Record<string, string>;
  /** Default headers applied to every API call. */
  defaultHeaders?: Record<string, string>;
  /** Refresh tokens this many seconds before expiry. Default 60. */
  refreshSkewSec?: number;
  /** Override the secret resolver — primarily for tests. */
  secretOptions?: GetSecretOptions;
  /** Override `fetch` — primarily for tests. */
  fetchImpl?: typeof fetch;
};

export type OAuth2Client = {
  get<T = unknown>(path: string, query?: QueryParams, opts?: RequestOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  request<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
  /** Force a token refresh on the next call. */
  invalidateToken(): void;
  /** Test/observability hook. */
  __token(): string | null;
};

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

/** Build an OAuth2-client-credentials-authed HTTP client. */
export function oauth2ClientCredentials(cfg: OAuth2Config): OAuth2Client {
  const base = cfg.baseUrl.replace(/\/$/, "");
  const refreshSkewMs = (cfg.refreshSkewSec ?? 60) * 1000;
  const fetchImpl = cfg.fetchImpl ?? fetch;
  let cached: CachedToken | null = null;
  let inFlight: Promise<string> | null = null;

  async function mintToken(): Promise<string> {
    const [clientId, clientSecret] = await Promise.all([
      getSecret(cfg.clientIdSecret, cfg.secretOptions),
      getSecret(cfg.clientSecretSecret, cfg.secretOptions),
    ]);
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });
    if (cfg.scope) params.set("scope", cfg.scope);
    for (const [k, v] of Object.entries(cfg.extraTokenParams ?? {})) {
      params.set(k, v);
    }

    const res = await fetchImpl(cfg.tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: params,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`oauth2 token mint failed: ${res.status} ${res.statusText} — ${text.slice(0, 240)}`);
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (typeof body.access_token !== "string" || body.access_token.length === 0) {
      throw new Error("oauth2 token mint: missing access_token in response");
    }
    const ttlSec = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
    cached = {
      accessToken: body.access_token,
      expiresAt: Date.now() + ttlSec * 1000 - refreshSkewMs,
    };
    return cached.accessToken;
  }

  async function getToken(): Promise<string> {
    if (cached && cached.expiresAt > Date.now()) return cached.accessToken;
    if (inFlight) return inFlight;
    inFlight = mintToken().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function applyAuth(
    pathOrUrl: string,
    opts: RequestOptions,
  ): Promise<{ url: string; opts: RequestOptions }> {
    const token = await getToken();
    const url = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : `${base}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
    const headers = {
      ...(cfg.defaultHeaders ?? {}),
      ...(opts.headers ?? {}),
      authorization: `Bearer ${token}`,
    };
    return { url, opts: { ...opts, headers, fetchImpl } };
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
    invalidateToken() {
      cached = null;
    },
    __token() {
      return cached?.accessToken ?? null;
    },
  };
}
