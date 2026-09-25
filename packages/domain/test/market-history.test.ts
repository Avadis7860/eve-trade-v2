import assert from "node:assert/strict";
import test from "node:test";
import type { MarketCollection, MarketPageObservation, EsiMarketOrder } from "@eve-trade/contracts";
import {
  buildMarketHistory,
  compareMarketOrders,
  deriveMarketTypeMetrics,
  deriveMarketDepth,
  fingerprintMarketState,
} from "../src/index.js";

const baseOrder = (overrides: Partial<EsiMarketOrder> = {}): EsiMarketOrder => ({
  duration: 90,
  escrow: 0,
  is_buy_order: false,
  issued: "2026-09-25T10:00:00.000Z",
  location_id: 60003760,
  min_volume: 1,
  order_id: 10,
  price: 100,
  range: "region",
  system_id: 30000142,
  type_id: 34,
  volume_remain: 10,
  volume_total: 10,
  ...overrides,
});

function collection(id: string, observedAt: string, status: MarketCollection["status"] = "COMPLETE"): MarketCollection {
  return {
    collection_id: id,
    region_id: 10000002,
    observed_at: observedAt,
    expected_pages: 1,
    completed_pages: [1],
    status,
    provenance: {
      source_kind: "ESI",
      source_id: "esi:markets/10000002/orders",
      endpoint: "/markets/10000002/orders/",
      principal_scope: "PUBLIC",
    },
    cache_last_modified: "Fri, 25 Sep 2026 10:00:00 GMT",
    cache_consistency: "CONSISTENT",
    error: null,
  };
}

function page(id: string, orderRecords: EsiMarketOrder[], observedAt = "2026-09-25T10:00:00.000Z"): MarketPageObservation {
  return {
    observation_id: id,
    collection_id: id,
    region_id: 10000002,
    page: 1,
    total_pages: 1,
    observed_at: observedAt,
    status: "COMPLETE",
    provenance: collection(id, observedAt).provenance,
    http_status: 200,
    retry_count: 0,
    records: orderRecords,
    raw_payload: orderRecords,
    headers: {
      x_pages: "1",
      last_modified: "Fri, 25 Sep 2026 10:00:00 GMT",
      etag: "etag",
      expires: null,
      ratelimit_group: null,
      ratelimit_limit: null,
      ratelimit_remaining: null,
      ratelimit_used: null,
      retry_after: null,
      error_limit_remain: null,
      error_limit_reset: null,
      compatibility_date: "2026-09-25",
    },
    error: null,
  };
}

test("fingerprint is independent of order and observation timestamp", () => {
  const a = baseOrder({order_id: 10});
  const b = baseOrder({order_id: 20, price: 101});
  assert.equal(fingerprintMarketState([a, b]), fingerprintMarketState([b, a]));
});

test("identical collections are REPEAT rather than market changes", () => {
  const orders = [baseOrder()];
  const result = buildMarketHistory([
    {collection: collection("00000000-0000-0000-0000-000000000001", "2026-09-25T10:00:00.000Z"), pages: [page("p1", orders)]},
    {collection: collection("00000000-0000-0000-0000-000000000002", "2026-09-25T10:10:00.000Z"), pages: [page("p2", orders, "2026-09-25T10:10:00.000Z")]},
  ]);
  assert.deepEqual(result.snapshots.map((s) => s.observation_kind), ["INITIAL", "REPEAT"]);
  assert.equal(result.snapshots[1]?.state_fingerprint, result.snapshots[0]?.state_fingerprint);
});

test("partial collection is retained but never becomes comparable", () => {
  const result = buildMarketHistory([
    {collection: collection("00000000-0000-0000-0000-000000000003", "2026-09-25T10:00:00.000Z", "PARTIAL"), pages: []},
  ]);
  assert.equal(result.snapshots[0]?.status, "PARTIAL");
  assert.equal(result.snapshots[0]?.comparison_eligible, false);
  assert.equal(result.snapshots[0]?.state_fingerprint, null);
  assert.equal(result.metrics.length, 0);
});

test("inconsistent source metadata blocks comparison without fabricating values", () => {
  const p1 = page("p1", [baseOrder()]);
  const p2 = {...page("p2", [baseOrder({order_id: 20})]), page: 2, total_pages: 2};
  p2.headers.last_modified = "Fri, 25 Sep 2026 10:05:00 GMT";
  const c = collection("00000000-0000-0000-0000-000000000004", "2026-09-25T10:00:00.000Z");
  c.expected_pages = 2;
  const result = buildMarketHistory([{collection:c,pages:[p1,p2]}]);
  assert.equal(result.snapshots[0]?.comparison_eligible, false);
  assert.equal(result.snapshots[0]?.source_consistency, "INCONSISTENT");
});

test("spread and liquidity stay null/zero only when that state is actually observed", () => {
  const sell = baseOrder({order_id: 1, price: 100, volume_remain: 10, is_buy_order: false});
  const sell2 = baseOrder({order_id: 2, price: 101, volume_remain: 5, is_buy_order: false});
  const metrics = deriveMarketTypeMetrics("s", [sell, sell2])[0]!;
  assert.equal(metrics.best_buy_price, null);
  assert.equal(metrics.best_sell_price, 100);
  assert.equal(metrics.spread_absolute, null);
  assert.equal(metrics.spread_relative, null);
  assert.equal(metrics.sell_visible_volume, 15);
  assert.equal(metrics.sell_visible_volume, metrics.sell_visible_volume);
});

test("depth aggregates complete visible order levels without imposing an arbitrary N", () => {
  const levels = deriveMarketDepth("s", [
    baseOrder({order_id:1, type_id:34, is_buy_order:true, price:99, volume_remain:4}),
    baseOrder({order_id:2, type_id:34, is_buy_order:true, price:99, volume_remain:6}),
    baseOrder({order_id:3, type_id:34, is_buy_order:true, price:98, volume_remain:2}),
  ]);
  assert.deepEqual(levels.map((level) => [level.price, level.volume_remain, level.order_count]), [[99,10,2],[98,2,1]]);
});

test("order evolution is factual and does not infer causes", () => {
  const previous = [baseOrder({order_id:1}), baseOrder({order_id:2, price:101}), baseOrder({order_id:4})];
  const current = [baseOrder({order_id:1, volume_remain:5}), baseOrder({order_id:3})];
  const events = compareMarketOrders("t0", "t1", previous, current);
  const byId = new Map(events.map((event) => [event.order_id, event]));
  assert.equal(byId.get(1)?.kind, "MODIFIED");
  assert.deepEqual(byId.get(1)?.changed_fields, ["volume_remain"]);
  assert.equal(byId.get(2)?.kind, "DISAPPEARED");
  assert.equal(byId.get(3)?.kind, "APPEARED");
  assert.equal(byId.get(4)?.kind, "DISAPPEARED");
});

test("identical state can reappear later as a new occurrence", () => {
  const ordersA = [baseOrder({price:100})];
  const ordersB = [baseOrder({price:101})];
  const result = buildMarketHistory([
    {collection: collection("00000000-0000-0000-0000-000000000010", "2026-09-25T10:00:00.000Z"), pages: [page("p10", ordersA)]},
    {collection: collection("00000000-0000-0000-0000-000000000011", "2026-09-25T10:10:00.000Z"), pages: [page("p11", ordersB)]},
    {collection: collection("00000000-0000-0000-0000-000000000012", "2026-09-25T10:20:00.000Z"), pages: [page("p12", ordersA)]},
  ]);
  assert.deepEqual(result.snapshots.map((s) => s.observation_kind), ["INITIAL", "NEW_STATE", "NEW_STATE"]);
  assert.equal(result.snapshots[2]?.state_fingerprint, result.snapshots[0]?.state_fingerprint);
});


test("does not compare snapshots from different regions", () => {
  const c1 = collection("00000000-0000-0000-0000-000000000020", "2026-09-25T10:00:00.000Z");
  const c2 = {...collection("00000000-0000-0000-0000-000000000021", "2026-09-25T10:01:00.000Z"), region_id: 10000043};
  const p1 = page("p20", [baseOrder({order_id: 1, price: 100})]);
  const p2 = {...page("p21", [baseOrder({order_id: 1, price: 90})]), region_id: 10000043};
  const result = buildMarketHistory([
    {collection:c1,pages:[p1]},
    {collection:c2,pages:[p2]},
  ]);
  assert.equal(result.snapshots[1]?.observation_kind, "INITIAL");
  assert.equal(result.order_evolution.length, 0);
});

test("relative spread uses best sell as denominator", () => {
  const metrics = deriveMarketTypeMetrics("s", [
    baseOrder({order_id:1,is_buy_order:true,price:90}),
    baseOrder({order_id:2,is_buy_order:false,price:100}),
  ])[0]!;
  assert.equal(metrics.spread_absolute, 10);
  assert.equal(metrics.spread_relative, 0.1);
});


test("ERROR and UNKNOWN collections remain explicitly non-comparable", () => {
  for (const status of ["ERROR", "UNKNOWN"] as const) {
    const result = buildMarketHistory([
      {collection: collection("00000000-0000-0000-0000-0000000000" + (status === "ERROR" ? "30" : "31"), "2026-09-25T10:00:00.000Z", status), pages: []},
    ]);
    assert.equal(result.snapshots[0]?.status, status);
    assert.equal(result.snapshots[0]?.comparison_eligible, false);
    assert.equal(result.snapshots[0]?.state_fingerprint, null);
    assert.equal(result.order_evolution.length, 0);
  }
});

test("missing ESI freshness metadata is UNVERIFIED rather than fabricated", () => {
  const p = page("p40", [baseOrder()]);
  p.headers.last_modified = null;
  p.headers.compatibility_date = null;
  const result = buildMarketHistory([
    {collection: collection("00000000-0000-0000-0000-000000000040", "2026-09-25T10:00:00.000Z"), pages: [p]},
  ]);
  assert.equal(result.snapshots[0]?.source_consistency, "UNVERIFIED");
  assert.equal(result.snapshots[0]?.comparison_eligible, true);
  assert.equal(result.snapshots[0]?.state_fingerprint !== null, true);
});
