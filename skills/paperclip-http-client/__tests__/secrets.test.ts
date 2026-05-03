import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __getReadCountForTests,
  __resetReadCountersForTests,
  getSecret,
  SecretNotFoundError,
} from "../scripts/secrets.ts";

afterEach(() => {
  __resetReadCountersForTests();
});

function mockOk(body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
  ) as unknown as typeof fetch;
}

function mock404(): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "content-type": "application/json" } }),
  ) as unknown as typeof fetch;
}

describe("getSecret() — adapter env-skip enforcement", () => {
  it("uses process.env on claude_local adapter", async () => {
    const fetchImpl = mockOk({ value: "from-api" });
    const value = await getSecret("MY_KEY", {
      adapterType: "claude_local",
      env: { MY_KEY: "from-env" },
      fetchImpl,
      apiUrl: "http://api",
      apiKey: "tok",
    });
    expect(value).toBe("from-env");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses process.env on codex_local adapter", async () => {
    const fetchImpl = mockOk({ value: "from-api" });
    const value = await getSecret("MY_KEY", {
      adapterType: "codex_local",
      env: { MY_KEY: "from-env" },
      fetchImpl,
      apiUrl: "http://api",
      apiKey: "tok",
    });
    expect(value).toBe("from-env");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("SKIPS process.env on a non-local adapter even if the env var is set", async () => {
    const fetchImpl = mockOk({ value: "from-api" });
    const value = await getSecret("MY_KEY", {
      adapterType: "managed_remote",
      env: { MY_KEY: "from-env" }, // would shadow if env were checked
      fetchImpl,
      apiUrl: "http://api",
      apiKey: "tok",
    });
    expect(value).toBe("from-api");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("SKIPS process.env when adapter type is empty/unknown", async () => {
    const fetchImpl = mockOk({ value: "from-api" });
    const value = await getSecret("MY_KEY", {
      adapterType: "",
      env: { MY_KEY: "from-env" },
      fetchImpl,
      apiUrl: "http://api",
      apiKey: "tok",
    });
    expect(value).toBe("from-api");
  });
});

describe("getSecret() — API tier", () => {
  it("calls /api/agents/me/secrets/:name with bearer token and run id", async () => {
    const fetchImpl = vi.fn(async (url: any, init: any) => {
      expect(String(url)).toBe("http://api/api/agents/me/secrets/MY_KEY");
      expect(init.headers.authorization).toBe("Bearer tok");
      expect(init.headers["x-paperclip-run-id"]).toBe("run-123");
      return new Response(JSON.stringify({ value: "v" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const value = await getSecret("MY_KEY", {
      adapterType: "managed_remote",
      env: {},
      fetchImpl,
      apiUrl: "http://api",
      apiKey: "tok",
      runId: "run-123",
    });
    expect(value).toBe("v");
  });

  it("throws SecretNotFoundError on 404 with no fallback", async () => {
    await expect(
      getSecret("MISSING", {
        adapterType: "managed_remote",
        env: {},
        fetchImpl: mock404(),
        apiUrl: "http://api",
        apiKey: "tok",
        legacyFallback: false,
      }),
    ).rejects.toBeInstanceOf(SecretNotFoundError);
  });
});

describe("getSecret() — input validation", () => {
  it("rejects lowercase keys", async () => {
    await expect(getSecret("lowercase", {})).rejects.toThrow(/invalid secret key/);
  });
  it("rejects keys starting with a digit", async () => {
    await expect(getSecret("1FOO", {})).rejects.toThrow(/invalid secret key/);
  });
  it("rejects keys with dashes", async () => {
    await expect(getSecret("MY-KEY", {})).rejects.toThrow(/invalid secret key/);
  });
});

describe("getSecret() — read tripwire", () => {
  it("emits exactly one warn after 50 reads in the same run", async () => {
    const fetchImpl = mockOk({ value: "v" });
    const warn = vi.fn();
    const opts = {
      adapterType: "managed_remote",
      env: {},
      fetchImpl,
      apiUrl: "http://api",
      apiKey: "tok",
      runId: "run-tripwire",
      warn,
    } as const;

    for (let i = 0; i < 60; i++) {
      await getSecret("MY_KEY", opts);
    }

    const tripwireMessages = warn.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes("secret.read.high_volume"));
    expect(tripwireMessages.length).toBe(1);
    expect(__getReadCountForTests("run-tripwire")).toBe(60);
  });

  it("does not emit tripwire under threshold", async () => {
    const fetchImpl = mockOk({ value: "v" });
    const warn = vi.fn();
    for (let i = 0; i < 10; i++) {
      await getSecret("MY_KEY", {
        adapterType: "managed_remote",
        env: {},
        fetchImpl,
        apiUrl: "http://api",
        apiKey: "tok",
        runId: "run-low",
        warn,
      });
    }
    const tripwireMessages = warn.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes("secret.read.high_volume"));
    expect(tripwireMessages.length).toBe(0);
  });

  it("counts per-run, not globally", async () => {
    const fetchImpl = mockOk({ value: "v" });
    const warn = vi.fn();
    for (let i = 0; i < 30; i++) {
      await getSecret("MY_KEY", {
        adapterType: "managed_remote",
        env: {},
        fetchImpl,
        apiUrl: "http://api",
        apiKey: "tok",
        runId: "run-A",
        warn,
      });
    }
    for (let i = 0; i < 30; i++) {
      await getSecret("MY_KEY", {
        adapterType: "managed_remote",
        env: {},
        fetchImpl,
        apiUrl: "http://api",
        apiKey: "tok",
        runId: "run-B",
        warn,
      });
    }
    expect(__getReadCountForTests("run-A")).toBe(30);
    expect(__getReadCountForTests("run-B")).toBe(30);
    const tripwireMessages = warn.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes("secret.read.high_volume"));
    expect(tripwireMessages.length).toBe(0); // neither run crossed 50
  });
});

describe("getSecret() — legacy fallback (off by default)", () => {
  it("does NOT read disk when fallback is disabled", async () => {
    await expect(
      getSecret("DEFINITELY_NOT_PRESENT", {
        adapterType: "managed_remote",
        env: {},
        fetchImpl: mock404(),
        apiUrl: "http://api",
        apiKey: "tok",
        legacyFallback: false,
      }),
    ).rejects.toBeInstanceOf(SecretNotFoundError);
  });
});
