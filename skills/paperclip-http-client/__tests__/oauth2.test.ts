import { describe, expect, it, vi } from "vitest";
import { oauth2ClientCredentials } from "../scripts/oauth2.ts";
import { __resetReadCountersForTests } from "../scripts/secrets.ts";

function makeFetchSequence(responses: Array<() => Response>): {
  fetchImpl: typeof fetch;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const fetchImpl = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    const fn = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return fn();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function tokenResponse(token: string, expiresIn = 3600) {
  return new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function secretFetch(value: string): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify({ value }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("oauth2ClientCredentials()", () => {
  it("mints a token, caches it, and reuses it across calls", async () => {
    __resetReadCountersForTests();
    const seq = makeFetchSequence([
      () => tokenResponse("ACCESS_1"),
      () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ]);

    const client = oauth2ClientCredentials({
      baseUrl: "https://api.example.com",
      tokenUrl: "https://idp.example.com/token",
      clientIdSecret: "CLIENT_ID",
      clientSecretSecret: "CLIENT_SECRET",
      fetchImpl: seq.fetchImpl,
      secretOptions: {
        adapterType: "managed_remote",
        env: {},
        apiUrl: "http://paperclip",
        apiKey: "tok",
        fetchImpl: secretFetch("the-secret"),
      },
    });

    await client.get("/a", undefined, { fetchImpl: seq.fetchImpl });
    await client.get("/b", undefined, { fetchImpl: seq.fetchImpl });

    // First call mints token, then two GETs.
    expect(seq.calls.length).toBe(3);
    expect(seq.calls[0].url).toBe("https://idp.example.com/token");
    expect((seq.calls[1].init.headers as Record<string, string>).authorization).toBe("Bearer ACCESS_1");
    expect((seq.calls[2].init.headers as Record<string, string>).authorization).toBe("Bearer ACCESS_1");
    expect(client.__token()).toBe("ACCESS_1");
  });

  it("re-mints when invalidated", async () => {
    __resetReadCountersForTests();
    const seq = makeFetchSequence([
      () => tokenResponse("ACCESS_1"),
      () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      () => tokenResponse("ACCESS_2"),
      () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ]);

    const client = oauth2ClientCredentials({
      baseUrl: "https://api.example.com",
      tokenUrl: "https://idp.example.com/token",
      clientIdSecret: "CLIENT_ID",
      clientSecretSecret: "CLIENT_SECRET",
      fetchImpl: seq.fetchImpl,
      secretOptions: {
        adapterType: "managed_remote",
        env: {},
        apiUrl: "http://paperclip",
        apiKey: "tok",
        fetchImpl: secretFetch("the-secret"),
      },
    });

    await client.get("/a", undefined, { fetchImpl: seq.fetchImpl });
    client.invalidateToken();
    await client.get("/b", undefined, { fetchImpl: seq.fetchImpl });

    expect(client.__token()).toBe("ACCESS_2");
  });

  it("posts client_credentials grant with form encoding", async () => {
    __resetReadCountersForTests();
    const seq = makeFetchSequence([
      () => tokenResponse("ACCESS"),
      () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ]);

    const client = oauth2ClientCredentials({
      baseUrl: "https://api.example.com",
      tokenUrl: "https://idp.example.com/token",
      clientIdSecret: "CLIENT_ID",
      clientSecretSecret: "CLIENT_SECRET",
      scope: "read write",
      fetchImpl: seq.fetchImpl,
      secretOptions: {
        adapterType: "managed_remote",
        env: {},
        apiUrl: "http://paperclip",
        apiKey: "tok",
        fetchImpl: secretFetch("the-secret"),
      },
    });

    await client.get("/a", undefined, { fetchImpl: seq.fetchImpl });
    const tokenCall = seq.calls[0];
    expect((tokenCall.init.headers as Record<string, string>)["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    const body = tokenCall.init.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe("the-secret");
    expect(body.get("client_secret")).toBe("the-secret");
    expect(body.get("scope")).toBe("read write");
  });
});
