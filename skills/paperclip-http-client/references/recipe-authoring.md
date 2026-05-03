# Authoring a new recipe

A "recipe" is a small typed wrapper around `apiKey()` or `oauth2ClientCredentials()`
for one third-party API. Recipes live in `examples/`.

## Anatomy

Every recipe has three parts:

1. **Module-level client** — built once with `apiKey({ ... })` or `oauth2ClientCredentials({ ... })`. Holds auth config.
2. **Typed response shapes** — exported `type` aliases for the JSON returned by each endpoint.
3. **Named functions** — `searchEverything()`, `sendEmail()`, etc. Each function names the endpoint and the parameters that matter; throws on non-2xx.

See `examples/coingecko.ts` for the canonical shape.

## Step-by-step

1. **Pick a name for the secret.** Uppercase env-style: `[A-Z][A-Z0-9_]*`. e.g. `MAILGUN_API_KEY`. The server validates the regex on the agent read endpoint.

2. **Register the secret.** Use the board UI or:

   ```http
   POST /api/companies/:companyId/secrets
   { "name": "MAILGUN_API_KEY", "value": "key-...", "agentId": null }
   ```

   Pass `agentId` to scope the secret to one agent (e.g. CTO's GitLab token). Omit it for company-wide secrets (e.g. shared Resend key).

3. **Pick the auth scheme.**

   | Auth shape | Use this |
   |---|---|
   | `Authorization: Bearer <key>` | `apiKey({ scheme: "bearer", ... })` |
   | `X-Api-Key: <key>` (or any other header) | `apiKey({ scheme: "header", headerName: "x-api-key", ... })` |
   | `?key=<key>` query param | `apiKey({ scheme: "query", paramName: "key", ... })` |
   | OAuth2 client-credentials | `oauth2ClientCredentials({ ... })` |

4. **Copy `examples/coingecko.ts` into a new file.** Rename, swap config, swap typed functions.

5. **Test the recipe** with one quick call:

   ```ts
   import { searchEverything } from "./newsapi.ts";
   console.log(await searchEverything("apple", { pageSize: 1 }));
   ```

   No need to add a vitest file per recipe — the helper layer is tested in `__tests__/`. Recipes are config; if the call works at the REPL, it works.

## Conventions

- **Module-level singleton client.** Don't build a fresh client per call — `getSecret()` runs once per call and the per-run tripwire is intentional.
- **No `try/catch` around `request()`.** Let errors propagate. Callers can wrap if they need different semantics.
- **Don't add retries on 4xx.** The shared `request()` already retries 429/5xx with exponential backoff. Adding more retries on auth errors will just hammer rate limits.
- **Don't put values in env files for testing.** Use the registered secret. If you can't, register a throwaway secret named `MY_API_TEST` and tear it down after.

## Out of scope for this skill

- Webhook receivers (only outbound HTTP).
- Streaming / SSE / long-polling — wrap directly with fetch if you need it.
- File uploads (multipart) — not handled by `request()` yet. Track separately if needed.
