import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSecretService = vi.hoisted(() => ({
  list: vi.fn(),
  listForAgent: vi.fn(),
  readForAgent: vi.fn(),
  create: vi.fn(),
  getById: vi.fn(),
  rotate: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  listProviders: vi.fn(() => []),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  secretService: () => mockSecretService,
  logActivity: mockLogActivity,
}));

type Actor =
  | { type: "agent"; agentId: string; companyId: string; runId?: string; source: string }
  | { type: "board"; userId: string; companyIds: string[]; isInstanceAdmin: boolean; source: string }
  | { type: "none"; source: "none" };

async function createApp(actor: Actor) {
  const { secretRoutes } = await vi.importActual<typeof import("../routes/secrets.js")>(
    "../routes/secrets.js",
  );
  const { errorHandler } = await vi.importActual<typeof import("../middleware/index.js")>(
    "../middleware/index.js",
  );
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", secretRoutes({} as any));
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/agents/me/secrets", () => {
  it("rejects non-agent actors", async () => {
    const app = await createApp({
      type: "board",
      userId: "u",
      companyIds: ["company-1"],
      isInstanceAdmin: false,
      source: "session",
    });
    const res = await request(app).get("/api/agents/me/secrets");
    expect(res.status).toBe(401);
  });

  it("lists secrets visible to the agent (agent-scoped + company-wide), redacted", async () => {
    mockSecretService.listForAgent.mockResolvedValueOnce([
      {
        id: "s-1",
        name: "GITLAB_TOKEN",
        description: "company token",
        provider: "local_encrypted",
        latestVersion: 2,
        agentId: null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-02"),
        lastReadAt: null,
      },
      {
        id: "s-2",
        name: "ALPACA_KEY",
        description: null,
        provider: "local_encrypted",
        latestVersion: 1,
        agentId: "agent-1",
        createdAt: new Date("2026-01-03"),
        updatedAt: new Date("2026-01-03"),
        lastReadAt: new Date("2026-01-04"),
      },
    ]);

    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      source: "agent_jwt",
    });
    const res = await request(app).get("/api/agents/me/secrets");

    expect(res.status).toBe(200);
    expect(mockSecretService.listForAgent).toHaveBeenCalledWith("company-1", "agent-1");
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({
      id: "s-1",
      name: "GITLAB_TOKEN",
      scope: "company",
    });
    expect(res.body[0].value).toBeUndefined();
    expect(res.body[1]).toMatchObject({ name: "ALPACA_KEY", scope: "agent" });
  });
});

describe("GET /api/agents/me/secrets/:name", () => {
  it("rejects non-agent actors", async () => {
    const app = await createApp({ type: "none", source: "none" });
    const res = await request(app).get("/api/agents/me/secrets/GITLAB_TOKEN");
    expect(res.status).toBe(401);
  });

  it("rejects invalid secret names with 400", async () => {
    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      source: "agent_jwt",
    });
    const res = await request(app).get("/api/agents/me/secrets/has-dash");
    expect(res.status).toBe(400);
    expect(mockSecretService.readForAgent).not.toHaveBeenCalled();
  });

  it("returns 404 when secret not visible to this agent", async () => {
    mockSecretService.readForAgent.mockResolvedValueOnce(null);
    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      source: "agent_jwt",
    });
    const res = await request(app).get("/api/agents/me/secrets/MISSING");
    expect(res.status).toBe(404);
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("returns the value, scope, and version, and writes a secret.read audit row with runId", async () => {
    mockSecretService.readForAgent.mockResolvedValueOnce({
      secret: { id: "s-1", name: "GITLAB_TOKEN", agentId: null },
      value: "glpat-xxxxxxxx",
      version: 3,
      scope: "company",
    });

    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      runId: "run-42",
      source: "agent_jwt",
    });
    const res = await request(app).get("/api/agents/me/secrets/GITLAB_TOKEN");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      name: "GITLAB_TOKEN",
      value: "glpat-xxxxxxxx",
      version: 3,
      scope: "company",
    });
    expect(mockSecretService.readForAgent).toHaveBeenCalledWith(
      "company-1",
      "agent-1",
      "GITLAB_TOKEN",
    );
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-1",
        actorType: "agent",
        actorId: "agent-1",
        action: "secret.read",
        entityType: "secret",
        entityId: "s-1",
        agentId: "agent-1",
        runId: "run-42",
        details: { name: "GITLAB_TOKEN", scope: "company", version: 3 },
      }),
    );
  });

  it("logs runId as null when the actor has no runId", async () => {
    mockSecretService.readForAgent.mockResolvedValueOnce({
      secret: { id: "s-2", name: "ALPACA_KEY", agentId: "agent-1" },
      value: "ak",
      version: 1,
      scope: "agent",
    });

    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      source: "agent_jwt",
    });
    const res = await request(app).get("/api/agents/me/secrets/ALPACA_KEY");

    expect(res.status).toBe(200);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ runId: null, action: "secret.read" }),
    );
  });
});
