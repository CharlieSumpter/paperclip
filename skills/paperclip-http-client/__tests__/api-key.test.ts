import { describe, expect, it, vi } from "vitest";
import { apiKey } from "../scripts/api-key.ts";
import { __resetReadCountersForTests } from "../scripts/secrets.ts";

function captureFetch() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function secretFetch(value: string): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify({ value }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("apiKey() — auth schemes", () => {
  it("bearer scheme sets Authorization header", async () => {
    __resetReadCountersForTests();
    const httpFetch = captureFetch();
    const client = apiKey({
      baseUrl: "https://api.example.com",
      secretName: "MY_SECRET",
      scheme: "bearer",
      secretOptions: {
        adapterType: "managed_remote",
        env: {},
        apiUrl: "http://paperclip",
        apiKey: "tok",
        fetchImpl: secretFetch("VALUE"),
      },
    });

    await client.get("/things", undefined, { fetchImpl: httpFetch.fetchImpl });
    expect(httpFetch.calls[0].url).toBe("https://api.example.com/things");
    expect((httpFetch.calls[0].init.headers as Record<string, string>).authorization).toBe(
      "Bearer VALUE",
    );
  });

  it("header scheme sets configurable header name", async () => {
    __resetReadCountersForTests();
    const httpFetch = captureFetch();
    const client = apiKey({
      baseUrl: "https://api.example.com",
      secretName: "MY_SECRET",
      scheme: "header",
      headerName: "x-cg-pro-api-key",
      secretOptions: {
        adapterType: "managed_remote",
        env: {},
        apiUrl: "http://paperclip",
        apiKey: "tok",
        fetchImpl: secretFetch("VALUE"),
      },
    });

    await client.get("/coins", undefined, { fetchImpl: httpFetch.fetchImpl });
    const headers = httpFetch.calls[0].init.headers as Record<string, string>;
    expect(headers["x-cg-pro-api-key"]).toBe("VALUE");
    expect(headers.authorization).toBeUndefined();
  });

  it("query scheme sets the configured query param", async () => {
    __resetReadCountersForTests();
    const httpFetch = captureFetch();
    const client = apiKey({
      baseUrl: "https://api.example.com",
      secretName: "MY_SECRET",
      scheme: "query",
      paramName: "key",
      secretOptions: {
        adapterType: "managed_remote",
        env: {},
        apiUrl: "http://paperclip",
        apiKey: "tok",
        fetchImpl: secretFetch("VALUE"),
      },
    });

    await client.get("/things", { foo: "bar" }, { fetchImpl: httpFetch.fetchImpl });
    const u = new URL(httpFetch.calls[0].url);
    expect(u.origin + u.pathname).toBe("https://api.example.com/things");
    expect(u.searchParams.get("foo")).toBe("bar");
    expect(u.searchParams.get("key")).toBe("VALUE");
  });

  it("merges query params from get() and opts", async () => {
    __resetReadCountersForTests();
    const httpFetch = captureFetch();
    const client = apiKey({
      baseUrl: "https://api.example.com",
      secretName: "MY_SECRET",
      scheme: "bearer",
      secretOptions: {
        adapterType: "managed_remote",
        env: {},
        apiUrl: "http://paperclip",
        apiKey: "tok",
        fetchImpl: secretFetch("VALUE"),
      },
    });

    await client.get("/things", { a: "1", b: "2" }, { fetchImpl: httpFetch.fetchImpl });
    const u = new URL(httpFetch.calls[0].url);
    expect(u.searchParams.get("a")).toBe("1");
    expect(u.searchParams.get("b")).toBe("2");
  });
});
