# Registering secrets — per-agent vs company-wide

This skill never reads values from disk. It calls `GET /api/agents/me/secrets/:name`,
which means **the secret must exist in the Paperclip secret store** before any
recipe call will succeed.

## Decision: per-agent or company-wide?

| Use per-agent (`agentId` set) | Use company-wide (`agentId: null`) |
|---|---|
| Token represents the agent's identity (e.g. CTO's GitLab PAT). | Token represents the company (e.g. shared Resend key for transactional email). |
| You want auditability per agent's actions. | Multiple agents call the same API. |
| Rotation only affects one agent's work. | Rotation affects everyone. |
| Rate limits are per-account-per-agent. | Rate limits are per-account. |

When in doubt, prefer **company-wide**. You can always re-scope later by `PATCH`-ing the secret.

## Resolution rules

When `getSecret(KEY)` runs:

1. The server looks for `(company_id = me, agent_id = me, name = KEY)`. If found → use it.
2. Else looks for `(company_id = me, agent_id IS NULL, name = KEY)`. If found → use it.
3. Else returns 404 → `getSecret()` throws `SecretNotFoundError`.

Per-agent shadowing means: register a company-wide `RESEND_API_KEY`, then later
hand one specific agent a different key by registering `(agentId, RESEND_API_KEY)`.
That agent transparently uses the override. Everyone else still uses the shared key.

## Endpoint reference

### Create / upsert (board only)

```http
POST /api/companies/:companyId/secrets
{
  "name": "RESEND_API_KEY",
  "value": "re_...",
  "agentId": null,           // null = company-wide; uuid = scoped to that agent
  "description": "Transactional email — shared across Marketing + Support"
}
```

### List (board only) — values never returned

```http
GET /api/companies/:companyId/secrets
→ [{ id, name, agentId, description, latestVersion, lastReadAt, ... }]
```

### Rotate (board only)

```http
POST /api/secrets/:id/rotate
{ "value": "re_NEW_..." }
```

Old version is retained but marked `revokedAt`. `getSecret()` always returns
the latest non-revoked version.

### Read (agent only) — what this skill calls

```http
GET /api/agents/me/secrets/:name
Authorization: Bearer <run JWT>
X-Paperclip-Run-Id: <run id>
→ { value: "...", version: 3, scope: "agent" | "company" }
```

Successful reads write a row to `activity_log` with `action = "secret.read"`,
including `runId`, `agentId`, and the secret name. Use the board's read-audit
endpoint to inspect.

## Naming guidelines

- Uppercase only: `[A-Z][A-Z0-9_]*`. Server validates.
- Be specific: prefer `MAILGUN_DOMAIN_FOO` over `EMAIL_KEY`.
- Match the underlying API's field name when there is one (e.g. `OPENAI_API_KEY`, not `OPENAI_TOKEN`).
- For OAuth2 client-credentials, use a `_CLIENT_ID` / `_CLIENT_SECRET` suffix pair: `INTERCOM_CLIENT_ID`, `INTERCOM_CLIENT_SECRET`.

## Migrating an existing on-disk secret

If a secret currently lives in `~/.claude/FOO.env` or `~/.paperclip/secrets/FOO.env`:

1. Open `~/.claude/FOO.env` and copy the value.
2. Register it via the board UI or `POST /api/companies/:companyId/secrets`.
3. Update consumer code to call `getSecret("FOO")`.
4. Confirm the call works on a non-local adapter (env tier is skipped → forces an API read).
5. Delete the disk file or move it to `~/.claude/secrets-archive/`.

The fallback (`PAPERCLIP_SECRETS_LEGACY_FALLBACK=1`) exists so a partial migration doesn't break the world. Default-off **2026-06-30**, code removal **2026-08-15** — see [AI-392](/AI/issues/AI-392) plan.
