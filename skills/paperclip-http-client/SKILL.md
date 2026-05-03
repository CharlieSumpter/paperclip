---
name: paperclip-http-client
description: >
  Reusable HTTP-auth helpers and pre-baked recipes for calling third-party APIs
  from Paperclip agents. Use whenever you need to call an external HTTP API and
  the auth is API-key (Bearer / X-API-Key / `?key=` query) or OAuth2
  client-credentials. Bundles `getSecret(KEY)` for resolving secrets from the
  Paperclip secret store ([AI-392](/AI/issues/AI-392)) instead of env vars.
  Includes copy-paste recipes for CoinGecko, Open-Meteo, Nager.Date,
  NewsAPI, and Resend.
---

# paperclip-http-client

Stop writing one-off HTTP integrations. This skill gives you:

1. **`getSecret(KEY)`** — three-tier secret resolver that talks to the Paperclip secret store first and falls back to legacy env files only behind a flag.
2. **`apiKey()`** — wraps `fetch` for API-key auth (Bearer header, custom header, or query param).
3. **`oauth2ClientCredentials()`** — token mint + refresh + cache for client-credentials OAuth2 flows.
4. **5 working recipes** — CoinGecko, Open-Meteo, Nager.Date, NewsAPI, Resend. Copy → paste → call.

## When to use

- You need to call an external HTTP API from an agent run.
- The API uses API-key or OAuth2 client-credentials auth.
- The secret should NOT live in a checked-in `.env` file.

## When NOT to use

- HTTP Basic / JWT / mutual-TLS auth — out of scope; do header injection inline.
- Browser/CORS contexts — this is server-side only.
- Market-data feeds (Alpaca, Finnhub, CoinGecko-for-prices, CCXT) — those have
  domain-specific clients in [AI-393](/AI/issues/AI-393) / [AI-394](/AI/issues/AI-394).
  This skill is for the long tail.

## Quick start

```ts
import { getSecret } from "../scripts/secrets.ts";
import { apiKey } from "../scripts/api-key.ts";

// 1. Register the secret once via the board UI or:
//    POST /api/companies/:companyId/secrets { name: "COINGECKO_KEY", value: "..." }

// 2. In your agent code:
const cg = apiKey({
  baseUrl: "https://pro-api.coingecko.com/api/v3",
  secretName: "COINGECKO_KEY",
  scheme: "header",          // "bearer" | "header" | "query"
  headerName: "x-cg-pro-api-key",
});

const res = await cg.get("/simple/price", { ids: "bitcoin", vs_currencies: "usd" });
```

## How `getSecret(KEY)` resolves

Tiered, deterministic, adapter-aware:

1. **Env var** (`process.env.KEY`) — **only** for local-dev adapters
   (`claude_local`, `codex_local`). Production adapters skip env entirely so a
   leaked env var cannot silently shadow a rotated secret. Adapter type is read
   from `PAPERCLIP_ADAPTER_TYPE` at runtime.

2. **Paperclip API** — `GET /api/agents/me/secrets/KEY` using the run JWT in
   `PAPERCLIP_API_KEY`. Per-agent-scoped secret beats company-wide; resolution
   order is server-side. Each successful read writes one row to `activity_log`
   (`action: "secret.read"`).

3. **Legacy disk fallback** — only if `PAPERCLIP_SECRETS_LEGACY_FALLBACK=1`:
   reads `~/.paperclip/secrets/KEY.env` then `~/.claude/KEY.env`. Emits a
   `console.warn` with the secret name so the operator notices. **Off in CI.
   Default-off in prod after 2026-06-30. Code removed 2026-08-15.**

If all three tiers fail, throws `SecretNotFoundError(KEY)`.

### Per-run read tripwire

The resolver tracks read count per `PAPERCLIP_RUN_ID` in-process. When a single
run exceeds **50 reads**, it fires one (and only one) `secret.read.high_volume`
activity-log warning so the audit query has an obvious pivot. Soft tripwire,
not a hard limit — reads keep working.

## Skill layout

```
paperclip-http-client/
├── SKILL.md                        ← you are here
├── references/
│   ├── recipe-authoring.md         ← how to add a new recipe
│   ├── registering-secrets.md      ← per-agent vs company-wide
│   └── threat-model.md             ← scope, run-JWT, audit
├── scripts/
│   ├── secrets.ts                  ← getSecret(), tripwire, errors
│   ├── api-key.ts                  ← apiKey() helper
│   ├── oauth2.ts                   ← oauth2ClientCredentials() helper
│   └── http.ts                     ← shared fetch wrapper, retry, JSON
├── examples/
│   ├── coingecko.ts
│   ├── open-meteo.ts
│   ├── nager-date.ts
│   ├── newsapi.ts
│   └── resend.ts
└── __tests__/
    ├── secrets.test.ts             ← env-skip, tripwire, fallback flag
    ├── api-key.test.ts
    └── oauth2.test.ts
```

## Adding a new recipe

See [references/recipe-authoring.md](references/recipe-authoring.md). Short
version: copy `examples/coingecko.ts`, swap the `secretName`, `baseUrl`, and
auth scheme, and you're done. PR the new file under `examples/` so the next
agent that needs it gets it for free.

## Registering secrets

See [references/registering-secrets.md](references/registering-secrets.md).
TL;DR:

- Per-agent secret (e.g. CTO's GitLab token):
  `POST /api/companies/:companyId/secrets { name, value, agentId }`
- Company-wide secret (e.g. Resend API key shared by Marketing + Support):
  `POST /api/companies/:companyId/secrets { name, value }` (omit `agentId`)

Names are uppercase env-style: `[A-Z][A-Z0-9_]*`. Server-side validated.
