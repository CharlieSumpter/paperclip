import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const LOCAL_DEV_ADAPTERS = new Set(["claude_local", "codex_local"]);

const READ_TRIPWIRE_THRESHOLD = 50;

type RunReadCounter = {
  runId: string;
  count: number;
  warned: boolean;
};

const runReadCounters = new Map<string, RunReadCounter>();

export class SecretNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`secret not found: ${key}`);
    this.name = "SecretNotFoundError";
  }
}

export type GetSecretOptions = {
  /** Override the adapter type — primarily for tests. */
  adapterType?: string;
  /** Override the runId — primarily for tests. */
  runId?: string;
  /** Override the API base URL — primarily for tests. */
  apiUrl?: string;
  /** Override the API token — primarily for tests. */
  apiKey?: string;
  /** Override the legacy fallback flag — primarily for tests. */
  legacyFallback?: boolean;
  /** Override `process.env` — primarily for tests. */
  env?: NodeJS.ProcessEnv;
  /** Override `fetch` — primarily for tests. */
  fetchImpl?: typeof fetch;
  /** Override the `console.warn` sink — primarily for tests. */
  warn?: (msg: string) => void;
};

/**
 * Resolve a secret value. Three-tier resolution:
 *
 * 1. `process.env[KEY]` — only for `claude_local` / `codex_local` adapters.
 * 2. `GET /api/agents/me/secrets/:key` via the run JWT.
 * 3. Legacy disk fallback (`~/.paperclip/secrets/KEY.env`, `~/.claude/KEY.env`)
 *    behind `PAPERCLIP_SECRETS_LEGACY_FALLBACK=1`.
 *
 * Throws `SecretNotFoundError(key)` if all three tiers fail.
 */
export async function getSecret(key: string, opts: GetSecretOptions = {}): Promise<string> {
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
    throw new Error(`invalid secret key: ${JSON.stringify(key)} — must match /^[A-Z][A-Z0-9_]*$/`);
  }

  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const adapterType = opts.adapterType ?? env.PAPERCLIP_ADAPTER_TYPE ?? "";
  const runId = opts.runId ?? env.PAPERCLIP_RUN_ID ?? "";

  // Tier 1 — process env (local adapters only)
  if (LOCAL_DEV_ADAPTERS.has(adapterType)) {
    const fromEnv = env[key];
    if (typeof fromEnv === "string" && fromEnv.length > 0) {
      bumpReadCounter(runId, warn);
      return fromEnv;
    }
  }

  // Tier 2 — Paperclip API
  const apiUrl = opts.apiUrl ?? env.PAPERCLIP_API_URL;
  const apiKey = opts.apiKey ?? env.PAPERCLIP_API_KEY;
  if (apiUrl && apiKey) {
    const url = `${apiUrl.replace(/\/$/, "")}/api/agents/me/secrets/${encodeURIComponent(key)}`;
    let res: Response | null = null;
    try {
      res = await fetchImpl(url, {
        headers: {
          authorization: `Bearer ${apiKey}`,
          ...(runId ? { "x-paperclip-run-id": runId } : {}),
        },
      });
    } catch (err) {
      // Network error — fall through to legacy if enabled, otherwise fail.
      warn(`paperclip-http-client: secret read network error for ${key}: ${(err as Error).message}`);
    }
    if (res && res.ok) {
      const body = (await res.json()) as { value?: unknown };
      if (typeof body.value === "string" && body.value.length > 0) {
        bumpReadCounter(runId, warn);
        return body.value;
      }
    } else if (res && res.status !== 404) {
      // 401/403/5xx — surface but try legacy.
      warn(`paperclip-http-client: secret read returned ${res.status} for ${key}`);
    }
  }

  // Tier 3 — legacy disk fallback
  const fallbackEnabled =
    opts.legacyFallback ??
    (env.PAPERCLIP_SECRETS_LEGACY_FALLBACK === "1" ||
      env.PAPERCLIP_SECRETS_LEGACY_FALLBACK === "true");

  if (fallbackEnabled) {
    const candidates = [
      path.join(homedir(), ".paperclip", "secrets", `${key}.env`),
      path.join(homedir(), ".claude", `${key}.env`),
    ];
    for (const candidate of candidates) {
      try {
        const raw = await readFile(candidate, "utf8");
        const value = parseEnvFile(raw, key);
        if (value !== undefined) {
          warn(
            `paperclip-http-client: legacy disk fallback used for ${key} ` +
              `(${candidate}). Migrate to the secret store before 2026-06-30.`,
          );
          bumpReadCounter(runId, warn);
          return value;
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          warn(`paperclip-http-client: legacy fallback read failed for ${candidate}: ${(err as Error).message}`);
        }
      }
    }
  }

  throw new SecretNotFoundError(key);
}

/**
 * Parse a `KEY=value` env file. Returns the value for the requested key, or
 * the first `KEY=value` line if the file has only one entry.
 */
function parseEnvFile(raw: string, key: string): string | undefined {
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (m[1] !== key) continue;
    let value = m[2];
    // Strip matched quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

function bumpReadCounter(runId: string, warn: (msg: string) => void) {
  if (!runId) return;
  let counter = runReadCounters.get(runId);
  if (!counter) {
    counter = { runId, count: 0, warned: false };
    runReadCounters.set(runId, counter);
  }
  counter.count += 1;
  if (counter.count > READ_TRIPWIRE_THRESHOLD && !counter.warned) {
    counter.warned = true;
    warn(
      `paperclip-http-client: secret.read.high_volume — run ${runId} ` +
        `has read >${READ_TRIPWIRE_THRESHOLD} secrets. ` +
        `If unexpected, audit /api/secrets/:id/reads.`,
    );
    // Best-effort fire-and-forget activity-log write. Don't block the read.
    void emitHighVolumeActivity(runId).catch(() => {
      /* swallow — the local warn() above is the durable signal */
    });
  }
}

async function emitHighVolumeActivity(runId: string): Promise<void> {
  const apiUrl = process.env.PAPERCLIP_API_URL;
  const apiKey = process.env.PAPERCLIP_API_KEY;
  if (!apiUrl || !apiKey) return;
  // The server doesn't expose a generic activity-log POST today, so this is a
  // no-op placeholder. Wired separately on the server side once a route exists
  // (see references/threat-model.md). The local warn() is the durable signal.
}

/** Test-only — reset the per-run counter map. */
export function __resetReadCountersForTests() {
  runReadCounters.clear();
}

/** Test-only — peek the per-run counter. */
export function __getReadCountForTests(runId: string): number {
  return runReadCounters.get(runId)?.count ?? 0;
}
