import assert from "node:assert/strict";
import test from "node:test";
import { EsiMarketClient, type EsiTransport } from "../src/client.js";

const order = (id: number) => ({
  duration: 90,
  escrow: 0,
  is_buy_order: false,
  issued: "2026-09-25T10:00:00Z",
  location_id: 60003760,
  min_volume: 1,
  order_id: id,
  price: 100,
  range: "region",
  system_id: 30000142,
  type_id: 34,
  volume_remain: 10,
  volume_total: 10,
});

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

class FakeTransport implements EsiTransport {
  calls: string[] = [];
  constructor(private readonly handler: (url: string) => Response | Promise<Response>) {}
  fetch(input: string | URL): Promise<Response> {
    const url = String(input);
    this.calls.push(url);
    return Promise.resolve(this.handler(url));
  }
}

test("fetches a page with explicit order_type=all and preserves pagination/cache metadata", async () => {
  const transport = new FakeTransport((url) => response(200, [order(1)], {
    "X-Pages": "7",
    "Last-Modified": "Fri, 25 Sep 2026 10:00:00 GMT",
    "ETag": '"abc"',
    "Expires": "Fri, 25 Sep 2026 10:05:00 GMT",
  }));
  const client = new EsiMarketClient({ userAgent: "EVE-Trade-v2/test", transport });
  const page = await client.fetchMarketPage(10000002, 3);
  assert.equal(page.total_pages, 7);
  assert.equal(page.records[0]?.order_id, 1);
  assert.equal(new URL(transport.calls[0]!).searchParams.get("order_type"), "all");
  assert.equal(page.headers.last_modified, "Fri, 25 Sep 2026 10:00:00 GMT");
});

test("honors Retry-After on 429", async () => {
  const delays: number[] = [];
  let attempt = 0;
  const transport = new FakeTransport(() => {
    attempt += 1;
    return attempt === 1
      ? response(429, { error: "rate limited" }, { "Retry-After": "2" })
      : response(200, [order(1)], { "X-Pages": "1" });
  });
  const client = new EsiMarketClient({
    userAgent: "EVE-Trade-v2/test",
    transport,
    sleep: async (ms) => { delays.push(ms); },
  });
  const page = await client.fetchMarketPage(10000002, 1);
  assert.equal(page.retry_count, 1);
  assert.deepEqual(delays, [2000]);
});

test("retries 5xx with bounded exponential backoff", async () => {
  let attempt = 0;
  const delays: number[] = [];
  const transport = new FakeTransport(() => {
    attempt += 1;
    return attempt < 3
      ? response(503, { error: "temporary" })
      : response(200, [order(1)], { "X-Pages": "1" });
  });
  const client = new EsiMarketClient({
    userAgent: "EVE-Trade-v2/test",
    transport,
    retryBaseDelayMs: 100,
    sleep: async (ms) => { delays.push(ms); },
  });
  const page = await client.fetchMarketPage(10000002, 1);
  assert.equal(page.retry_count, 2);
  assert.deepEqual(delays, [100, 200]);
});

test("does not turn terminal client errors into empty observations", async () => {
  const transport = new FakeTransport(() => response(404, { error: "missing" }));
  const client = new EsiMarketClient({ userAgent: "EVE-Trade-v2/test", transport });
  await assert.rejects(() => client.fetchMarketPage(10000002, 1), /HTTP 404/);
});

test("420 can recover using the error-limit reset header", async () => {
  let attempt = 0;
  const delays: number[] = [];
  const transport = new FakeTransport(() => {
    attempt += 1;
    return attempt === 1
      ? response(420, { error: "error limit" }, { "X-ESI-Error-Limit-Reset": "3" })
      : response(200, [order(1)], { "X-Pages": "1" });
  });
  const client = new EsiMarketClient({
    userAgent: "EVE-Trade-v2/test",
    transport,
    sleep: async (ms) => { delays.push(ms); },
  });
  await client.fetchMarketPage(10000002, 1);
  assert.deepEqual(delays, [3000]);
});
