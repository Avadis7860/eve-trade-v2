import assert from "node:assert/strict";
import test from "node:test";
import { EsiHttpClient, EsiHttpError, type EsiTransport } from "../src/http-client.js";
import { EsiPlayerClient } from "../src/player-client.js";

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

class FakeTransport implements EsiTransport {
  calls: { url: string; headers: Headers }[] = [];
  constructor(private readonly handler: (url: string, headers: Headers) => Response | Promise<Response>) {}
  fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    const url = String(input);
    this.calls.push({ url, headers });
    return Promise.resolve(this.handler(url, headers));
  }
}

const transaction = (id: number) => ({
  client_id: 1, date: "2026-09-25T10:00:00Z", is_buy: true, is_personal: true,
  journal_ref_id: id + 100, location_id: 60003760, quantity: 2,
  transaction_id: id, type_id: 34, unit_price: 10,
});

const order = (id: number) => ({
  duration: 90, escrow: 0, is_buy_order: false, issued: "2026-09-25T10:00:00Z",
  location_id: 60003760, min_volume: 1, order_id: id, price: 100, range: "region",
  system_id: 30000142, type_id: 34, volume_remain: 10, volume_total: 10,
});

test("authenticated player requests send bearer token without exposing it in errors", async () => {
  const secret = "do-not-log-this-token";
  const transport = new FakeTransport((_url, headers) => response(403, { error: "forbidden" }));
  const http = new EsiHttpClient({ userAgent: "EVE-Trade-v2/test", transport, maxRetries: 0 });
  const client = new EsiPlayerClient(http);

  await assert.rejects(
    () => client.fetchWallet(90000001, secret),
    (error: unknown) => error instanceof EsiHttpError && error.status === 403 && !error.message.includes(secret),
  );
  assert.equal(transport.calls[0]?.headers.get("Authorization"), `Bearer ${secret}`);
});

test("public character identity is requested without an authorization header", async () => {
  const transport = new FakeTransport((url, headers) => {
    assert.match(url, /\/characters\/90000001\/$/);
    assert.equal(headers.get("Authorization"), null);
    return response(200, { name: "Pilot", corporation_id: 98000001 });
  });
  const http = new EsiHttpClient({ userAgent: "EVE-Trade-v2/test", transport });
  const client = new EsiPlayerClient(http);
  const result = await client.fetchCharacter(90000001);
  assert.equal(result.data.name, "Pilot");
});

test("current player orders use v2 and preserve character-scoped request provenance upstream", async () => {
  const transport = new FakeTransport((url) => {
    assert.match(url, /\/v2\/characters\/90000001\/orders\/$/);
    return response(200, [order(42)]);
  });
  const http = new EsiHttpClient({ userAgent: "EVE-Trade-v2/test", transport });
  const client = new EsiPlayerClient(http);
  const result = await client.fetchActiveOrders(90000001, "token");
  assert.equal(result.data[0]?.order_id, 42);
});

test("from-id requests preserve the cursor as an ESI query parameter", async () => {
  const transport = new FakeTransport((url) => response(200, [transaction(10)]));
  const http = new EsiHttpClient({ userAgent: "EVE-Trade-v2/test", transport });
  const client = new EsiPlayerClient(http);
  await client.fetchWalletTransactions(90000001, 10, "token");
  assert.equal(new URL(transport.calls[0]!.url).searchParams.get("from_id"), "10");
});

test("common transport honors Retry-After and 420 reset semantics", async () => {
  const delays: number[] = [];
  let attempt = 0;
  const transport = new FakeTransport(() => {
    attempt += 1;
    if (attempt === 1) return response(429, {}, { "Retry-After": "2" });
    if (attempt === 2) return response(420, {}, { "X-ESI-Error-Limit-Reset": "3" });
    return response(200, { ok: true });
  });
  const http = new EsiHttpClient({
    userAgent: "EVE-Trade-v2/test",
    transport,
    sleep: async (ms) => { delays.push(ms); },
    maxRetries: 3,
  });
  const result = await http.getJson<{ ok: boolean }>("/status/");
  assert.equal(result.data.ok, true);
  assert.deepEqual(delays, [2000, 3000]);
  assert.equal(result.retry_count, 2);
});


test("default compatibility date is stable instead of depending on current wall-clock time", async () => {
  let requestHeaders: Headers | null = null;
  const transport = new FakeTransport((_url, headers) => {
    requestHeaders = headers;
    return response(200, { ok: true });
  });
  const http = new EsiHttpClient({
    userAgent: "EVE-Trade-v2/test",
    transport,
    now: () => new Date("2030-01-10T12:00:00.000Z"),
  });
  await http.getJson("/status/");
  assert.equal(requestHeaders?.get("X-Compatibility-Date"), "2026-09-25");
});

test("terminal ESI errors preserve response metadata and accumulated retry count", async () => {
  const delays: number[] = [];
  const transport = new FakeTransport(() => response(429, { error: "rate limited" }, {
    "Retry-After": "2",
    "X-Ratelimit-Group": "test-group",
    "X-Ratelimit-Remaining": "1",
    "X-ESI-Error-Limit-Remain": "98",
    "X-ESI-Error-Limit-Reset": "12",
  }));
  const http = new EsiHttpClient({
    userAgent: "EVE-Trade-v2/test",
    transport,
    maxRetries: 1,
    sleep: async (ms) => { delays.push(ms); },
  });
  await assert.rejects(() => http.getJson("/status/"), (error: unknown) => {
    assert.ok(error instanceof EsiHttpError);
    assert.equal(error.status, 429);
    assert.equal(error.retryable, true);
    assert.equal(error.retryAfterSeconds, 2);
    assert.equal(error.retry_count, 1);
    assert.equal(error.headers.retry_after, "2");
    assert.equal(error.headers.ratelimit_group, "test-group");
    assert.equal(error.headers.ratelimit_remaining, "1");
    assert.equal(error.headers.error_limit_remain, "98");
    assert.equal(error.headers.error_limit_reset, "12");
    assert.equal(error.endpoint, "/status/");
    assert.ok(error.request_id);
    assert.ok(error.observed_at !== null);
    return true;
  });
  assert.deepEqual(delays, [2000]);
});