import assert from "node:assert/strict";
import test from "node:test";
import { reconstructCanonicalMarket } from "../src/market-reducer.js";
import type { MarketPageObservation } from "@eve-trade/contracts";

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

const page = (n: number, records: ReturnType<typeof order>[], lastModified = "Fri, 25 Sep 2026 10:00:00 GMT"): MarketPageObservation => ({
  collection_id: "c1",
  region_id: 10000002,
  page: n,
  total_pages: 2,
  observed_at: "2026-09-25T10:00:00Z",
  status: "COMPLETE",
  provenance: {
    source_kind: "ESI",
    source_id: "esi:markets/10000002/orders",
    endpoint: "/markets/10000002/orders/",
    principal_scope: "PUBLIC",
  },
  http_status: 200,
  retry_count: 0,
  records,
  raw_payload: records,
  headers: {
    x_pages: "2",
    last_modified: lastModified,
    etag: null,
    expires: null,
    ratelimit_group: null,
    ratelimit_limit: null,
    ratelimit_remaining: null,
    ratelimit_used: null,
    retry_after: null,
    error_limit_remain: null,
    error_limit_reset: null,
  },
  error: null,
});

test("reconstructs complete state and deduplicates overlapping pages", () => {
  const state = reconstructCanonicalMarket("c1", 10000002, "2026-09-25T10:00:00Z", [
    page(1, [order(1), order(2)]),
    page(2, [order(2), order(3)]),
  ]);
  assert.equal(state.status, "COMPLETE");
  assert.equal(state.orders.length, 3);
  assert.equal(state.duplicate_order_count, 1);
  assert.equal(state.cache_consistency, "CONSISTENT");
});

test("never turns a failed page into a complete empty state", () => {
  const failed = page(2, []);
  failed.status = "ERROR";
  failed.error = { code: "ESI_429", message: "rate limited", retryable: true };
  const state = reconstructCanonicalMarket("c1", 10000002, "2026-09-25T10:00:00Z", [page(1, [order(1)]), failed]);
  assert.equal(state.status, "ERROR");
  assert.equal(state.orders.length, 1);
});

test("marks cache inconsistency as partial rather than silently claiming a coherent snapshot", () => {
  const state = reconstructCanonicalMarket("c1", 10000002, "2026-09-25T10:00:00Z", [
    page(1, [order(1)], "A"),
    page(2, [order(2)], "B"),
  ]);
  assert.equal(state.status, "PARTIAL");
  assert.equal(state.cache_consistency, "INCONSISTENT");
});
