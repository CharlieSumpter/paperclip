# Threat model & guarantees

Short scope notes for reviewers and future maintainers.

## What this skill protects against

- **Leaked env vars silently shadowing rotated secrets.** On non-local adapters
  the env tier is skipped entirely (see `LOCAL_DEV_ADAPTERS` in `scripts/secrets.ts`).
  Even if `RESEND_API_KEY` is in the process env, it is ignored on production
  adapters and the API value is returned.

- **Cross-agent secret leakage within a company.** Server-side `WHERE` clause is
  `company_id = me AND (agent_id IS NULL OR agent_id = me)`. Agent A cannot
  read Agent B's per-agent secret even on a coding-agent path. (Enforcement
  lives on the server in [AI-397](/AI/issues/AI-397) — this skill simply trusts that gate.)

- **Long-lived agent tokens.** None used. The skill authenticates with the run
  JWT in `PAPERCLIP_API_KEY`, which is short-lived and bound to the current run.

- **Quiet exfiltration via mass reads.** Per-run tripwire emits one
  `secret.read.high_volume` warn after 50 reads. Soft signal — operator-visible.

## What this skill does NOT protect against

- **A compromised agent process.** Anything inside the agent runtime can read
  every secret the agent is authorised for. Run JWTs are sandboxed by company +
  agent, not by request scope.

- **Network-level interception.** Assumes TLS termination on the Paperclip API
  and on every third-party API. No certificate pinning.

- **Secrets logged by recipe authors.** If a recipe `console.log`s a response
  body that contains a secret echo, the recipe author owns that. The skill never
  logs values.

- **Stolen master key.** If `PAPERCLIP_SECRETS_MASTER_KEY_FILE` leaks, every
  encrypted material is decryptable. Out-of-band concern; see [AI-392](/AI/issues/AI-392) plan.

## Audit surface

Three signals exist after a successful read:

1. `activity_log` row with `action = "secret.read"`, includes `runId`, `agentId`, secret name. Server-written.
2. `company_secrets.last_read_at` timestamp, denormalised. Server-written.
3. Per-run tripwire warn at >50 reads/run. Skill-written; visible in agent run log.

Failed reads (404 / 401 / 403) write `secret.read_denied` to `activity_log`. Single
place to spot probing.

## Non-goals

- **No nonce / replay protection** beyond JWT TTL. Run JWTs are short-lived; replay attacks have to land within the TTL. Not worth nonce tracking for v1.
- **No KMS integration.** Local AES-256-GCM via `node:crypto` is fine for now.
  The `provider` column on `company_secrets` is the seam if we add an external provider.
- **No quota enforcement.** Tripwire warns. No hard cap. Adding one would interact poorly with bulk-data recipes (e.g. paginated NewsAPI calls).
