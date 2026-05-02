import { randomUUID, createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  companySecrets,
  companySecretVersions,
  createDb,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { secretService } from "../services/secrets.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping agent secrets service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("migration 0075 schema (integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-secrets-migration-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("company_secrets has agent_id and last_read_at columns after migration", async () => {
    const result = await db.execute(
      sql`SELECT column_name FROM information_schema.columns
          WHERE table_name = 'company_secrets'
            AND column_name IN ('agent_id', 'last_read_at')
          ORDER BY column_name`,
    );
    const cols = (result as unknown as Array<{ column_name: string }>).map((r) => r.column_name);
    expect(cols).toContain("agent_id");
    expect(cols).toContain("last_read_at");
  });

  it("company_secrets_company_agent_name_uq unique index exists", async () => {
    const result = await db.execute(
      sql`SELECT indexname FROM pg_indexes
          WHERE tablename = 'company_secrets'
            AND indexname = 'company_secrets_company_agent_name_uq'`,
    );
    expect((result as unknown as unknown[]).length).toBe(1);
  });

  it("activity_log_secret_reads_idx partial index exists", async () => {
    const result = await db.execute(
      sql`SELECT indexname FROM pg_indexes
          WHERE tablename = 'activity_log'
            AND indexname = 'activity_log_secret_reads_idx'`,
    );
    expect((result as unknown as unknown[]).length).toBe(1);
  });
});

describeEmbeddedPostgres("secretService agent-scoped reads (integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId!: string;
  let agentId!: string;
  let otherAgentId!: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-secrets-svc-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  beforeEach(async () => {
    companyId = randomUUID();
    agentId = randomUUID();
    otherAgentId = randomUUID();

    await db.insert(companies).values({ id: companyId, name: "test-co", issuePrefix: "TST" });
    await db.insert(agents).values([
      { id: agentId, companyId, name: "agent-a", role: "general" },
      { id: otherAgentId, companyId, name: "agent-b", role: "general" },
    ]);
  });

  afterEach(async () => {
    await db.delete(companySecretVersions);
    await db.delete(companySecrets);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function insertSecret(opts: {
    name: string;
    value: string;
    agentId?: string | null;
  }) {
    const svc = secretService(db);
    return svc.create(
      companyId,
      {
        name: opts.name,
        provider: "local_encrypted",
        value: opts.value,
        agentId: opts.agentId ?? null,
      },
    );
  }

  it("readForAgent updates last_read_at on each successful read", async () => {
    await insertSecret({ name: "MY_KEY", value: "secret-value" });
    const svc = secretService(db);

    const before = await db
      .select({ lastReadAt: companySecrets.lastReadAt })
      .from(companySecrets)
      .where(eq(companySecrets.companyId, companyId))
      .then((rows) => rows[0]?.lastReadAt);
    expect(before).toBeNull();

    const result = await svc.readForAgent(companyId, agentId, "MY_KEY");
    expect(result).not.toBeNull();

    const after = await db
      .select({ lastReadAt: companySecrets.lastReadAt })
      .from(companySecrets)
      .where(eq(companySecrets.companyId, companyId))
      .then((rows) => rows[0]?.lastReadAt);
    expect(after).not.toBeNull();
    expect(after!.getTime()).toBeGreaterThan(0);
  });

  it("valueSha256 stored on version row matches the plaintext value", async () => {
    const plaintext = "super-secret-123";
    await insertSecret({ name: "SHA_KEY", value: plaintext });

    const secretRow = await db
      .select()
      .from(companySecrets)
      .where(eq(companySecrets.companyId, companyId))
      .then((rows) => rows[0]);
    expect(secretRow).toBeDefined();

    const versionRow = await db
      .select()
      .from(companySecretVersions)
      .where(eq(companySecretVersions.secretId, secretRow.id))
      .then((rows) => rows[0]);
    expect(versionRow).toBeDefined();

    const expectedSha256 = createHash("sha256").update(plaintext).digest("hex");
    expect(versionRow.valueSha256).toBe(expectedSha256);

    // Decrypt round-trip — the SHA must still match after a read
    const svc = secretService(db);
    const result = await svc.readForAgent(companyId, agentId, "SHA_KEY");
    expect(result).not.toBeNull();
    const afterReadSha256 = createHash("sha256").update(result!.value).digest("hex");
    expect(afterReadSha256).toBe(expectedSha256);
  });

  it("agent-scoped secret wins over company-wide secret of same name", async () => {
    await insertSecret({ name: "SHARED", value: "company-value" });
    await insertSecret({ name: "SHARED", value: "agent-value", agentId });

    const svc = secretService(db);
    const result = await svc.readForAgent(companyId, agentId, "SHARED");
    expect(result).not.toBeNull();
    expect(result!.scope).toBe("agent");
    expect(result!.value).toBe("agent-value");
  });

  it("agent B cannot read agent A's scoped secret — returns null (maps to 404)", async () => {
    await insertSecret({ name: "AGENT_A_SECRET", value: "private", agentId });

    const svc = secretService(db);
    const result = await svc.readForAgent(companyId, otherAgentId, "AGENT_A_SECRET");
    expect(result).toBeNull();
  });

  it("cross-company read returns null — company boundary enforced", async () => {
    await insertSecret({ name: "CROSS_KEY", value: "value" });

    const svc = secretService(db);
    const result = await svc.readForAgent(randomUUID(), agentId, "CROSS_KEY");
    expect(result).toBeNull();
  });
});
