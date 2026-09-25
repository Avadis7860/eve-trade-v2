import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalMarketState, MarketHistorySnapshot, EsiMarketOrder } from "@eve-trade/contracts";
import { fingerprintTradeScenario, simulateTakerAgainstBuy, simulateTakerAgainstSell } from "../src/trade-analysis.js";

const baseOrder = (overrides: Partial<EsiMarketOrder> = {}): EsiMarketOrder => ({
  duration: 90,
  escrow: 0,
  is_buy_order: false,
  issued: "2026-09-25T10:00:00.000Z",
  location_id: 60003760,
  min_volume: 1,
  order_id: 10,
  price: 100,
  range: "station",
  system_id: 30000142,
  type_id: 34,
  volume_remain: 10,
  volume_total: 10,
  ...overrides,
});

function snapshot(orders: EsiMarketOrder[]): { snapshot: MarketHistorySnapshot; market: CanonicalMarketState } {
  return {
    snapshot: {
      snapshot_id: "snapshot-1",
      collection_id: "snapshot-1",
      region_id: 10000002,
      observed_at: "2026-09-25T10:00:00.000Z",
      status: "COMPLETE",
      comparison_eligible: true,
      state_fingerprint: "fingerprint",
      source_last_modified: null,
      source_compatibility_date: "2026-09-25",
      source_consistency: "UNVERIFIED",
      observation_kind: "INITIAL",
      previous_snapshot_id: null,
      source_pages: 1,
    },
    market: {
      collection_id: "snapshot-1",
      region_id: 10000002,
      observed_at: "2026-09-25T10:00:00.000Z",
      status: "COMPLETE",
      provenance: { source_kind: "ESI", source_id: "market", endpoint: "/markets/10000002/orders/", principal_scope: "PUBLIC" },
      orders,
      source_pages: 1,
      duplicate_order_count: 0,
      cache_last_modified: null,
      cache_consistency: "UNVERIFIED",
    },
  };
}

const location = { region_id: 10000002, system_id: 30000142, location_id: 60003760 };

test("taker against sell crosses multiple levels but settles at the taker buy price", () => {
  const result = simulateTakerAgainstSell({
    snapshot: snapshot([
      baseOrder({ order_id: 1, price: 100, volume_remain: 2 }),
      baseOrder({ order_id: 2, price: 101, volume_remain: 3 }),
      baseOrder({ order_id: 3, price: 103, volume_remain: 9 }),
    ]),
    type_id: 34,
    execution_location: location,
    quantity: 5,
    limit_price: 101,
    order_range: "station",
  });

  assert.equal(result.status, "EXECUTABLE");
  assert.equal(result.filled_quantity, 5);
  assert.equal(result.book_value, 503);
  assert.equal(result.settlement_value, 505);
  assert.deepEqual(result.simulated_fills.map((fill) => [fill.order_id, fill.quantity, fill.book_price, fill.settlement_price]), [
    [1, 2, 100, 101],
    [2, 3, 101, 101],
  ]);
});

test("taker against buy crosses highest bids but settles at the taker sell price", () => {
  const result = simulateTakerAgainstBuy({
    snapshot: snapshot([
      baseOrder({ order_id: 1, is_buy_order: true, price: 100, range: "station", volume_remain: 2 }),
      baseOrder({ order_id: 2, is_buy_order: true, price: 101, range: "station", volume_remain: 3 }),
      baseOrder({ order_id: 3, is_buy_order: true, price: 99, range: "station", volume_remain: 10 }),
    ]),
    type_id: 34,
    execution_location: location,
    quantity: 5,
    limit_price: 99,
    order_range: "station",
  });

  assert.equal(result.status, "EXECUTABLE");
  assert.equal(result.filled_quantity, 5);
  assert.equal(result.book_value, 503);
  assert.equal(result.settlement_value, 495);
  assert.deepEqual(result.simulated_fills.map((fill) => [fill.order_id, fill.quantity]), [[2, 3], [1, 2]]);
});

test("equal-price candidates use order_id only as a deterministic simulation tie-break", () => {
  const result = simulateTakerAgainstSell({
    snapshot: snapshot([
      baseOrder({ order_id: 20, price: 100, volume_remain: 2 }),
      baseOrder({ order_id: 10, price: 100, volume_remain: 2 }),
    ]),
    type_id: 34,
    execution_location: location,
    quantity: 3,
    limit_price: 100,
    order_range: "station",
  });

  assert.deepEqual(result.simulated_fills.map((fill) => fill.order_id), [10, 20]);
});

test("numeric range stays unknown without a supplied jump distance", () => {
  const result = simulateTakerAgainstBuy({
    snapshot: snapshot([
      baseOrder({
        order_id: 1,
        is_buy_order: true,
        price: 100,
        range: "5",
        system_id: 30000143,
        location_id: 60003761,
        volume_remain: 5,
      }),
    ]),
    type_id: 34,
    execution_location: location,
    quantity: 1,
    limit_price: 99,
    order_range: "station",
  });

  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.equal(result.filled_quantity, 0);
  assert.equal(result.reasons[0]?.code, "RANGE_UNKNOWN");
});

test("numeric range becomes compatible only with explicit jump evidence", () => {
  const result = simulateTakerAgainstBuy({
    snapshot: snapshot([
      baseOrder({
        order_id: 1,
        is_buy_order: true,
        price: 100,
        range: "5",
        system_id: 30000143,
        location_id: 60003761,
        volume_remain: 5,
      }),
    ]),
    type_id: 34,
    execution_location: location,
    quantity: 1,
    limit_price: 99,
    order_range: "station",
    jump_count_by_order_id: { "1": 4 },
  });

  assert.equal(result.status, "EXECUTABLE");
  assert.equal(result.filled_quantity, 1);
  assert.equal(result.settlement_value, 99);
});

test("range and type filters do not fabricate liquidity from other orders", () => {
  const result = simulateTakerAgainstSell({
    snapshot: snapshot([
      baseOrder({ order_id: 1, type_id: 35, price: 90 }),
      baseOrder({ order_id: 2, is_buy_order: true, price: 110 }),
      baseOrder({ order_id: 3, price: 120 }),
      baseOrder({ order_id: 4, price: 100, location_id: 60003761 }),
    ]),
    type_id: 34,
    execution_location: location,
    quantity: 1,
    limit_price: 110,
    order_range: "station",
  });

  assert.equal(result.status, "PARTIAL");
  assert.equal(result.filled_quantity, 0);
  assert.equal(result.reasons.some((item) => item.code === "DEPTH_EXHAUSTED"), true);
});

test("non-comparable snapshots are rejected before matching", () => {
  const invalid = snapshot([baseOrder()]);
  invalid.snapshot.comparison_eligible = false;
  const result = simulateTakerAgainstSell({
    snapshot: invalid,
    type_id: 34,
    execution_location: location,
    quantity: 1,
    limit_price: 100,
    order_range: "station",
  });

  assert.equal(result.status, "NOT_EXECUTABLE");
  assert.equal(result.reasons[0]?.code, "MARKET_NOT_COMPARABLE");
});

test("scenario fingerprint is deterministic across object key order", () => {
  const a = fingerprintTradeScenario({
    as_of: "2026-09-25T10:00:00.000Z",
    scenario: { b: 2, a: 1 },
    configuration: { fee: { sales: 0.03, broker: 0 } },
  });
  const b = fingerprintTradeScenario({
    as_of: "2026-09-25T10:00:00.000Z",
    scenario: { a: 1, b: 2 },
    configuration: { fee: { broker: 0, sales: 0.03 } },
  });
  assert.equal(a, b);
});
