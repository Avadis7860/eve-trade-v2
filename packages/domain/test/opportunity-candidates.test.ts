import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalMarketState, EsiMarketOrder } from "@eve-trade/contracts";
import { generateMarketTradeCandidates } from "../src/opportunity-candidates.js";

const order = (overrides: Partial<EsiMarketOrder>): EsiMarketOrder => ({
  duration: 90,
  is_buy_order: false,
  issued: "2026-09-25T10:00:00.000Z",
  location_id: 60003760,
  min_volume: 1,
  order_id: 1,
  price: 100,
  range: "region",
  system_id: 30000142,
  type_id: 34,
  volume_remain: 10,
  volume_total: 10,
  ...overrides,
});

const market = (orders: EsiMarketOrder[], status: CanonicalMarketState["status"] = "COMPLETE"): CanonicalMarketState => ({
  collection_id: "00000000-0000-0000-0000-000000000034",
  region_id: 10000002,
  observed_at: "2026-09-25T10:00:00.000Z",
  status,
  provenance: {
    source_kind: "ESI",
    source_id: "esi:markets/10000002/orders",
    endpoint: "/markets/10000002/orders/",
    principal_scope: "PUBLIC",
  },
  orders,
  source_pages: 1,
  duplicate_order_count: 0,
  cache_last_modified: null,
  cache_consistency: "UNVERIFIED",
});

test("generates one deterministic market-to-market candidate per type with positive spread", () => {
  const scenarios = generateMarketTradeCandidates(
    market([
      order({ order_id: 10, price: 100, volume_remain: 8 }),
      order({ order_id: 11, price: 105, volume_remain: 50 }),
      order({ order_id: 20, is_buy_order: true, price: 120, volume_remain: 5 }),
      order({ order_id: 21, is_buy_order: true, price: 115, volume_remain: 50 }),
    ]),
  );

  assert.equal(scenarios.length, 1);
  const scenario = scenarios[0]!;
  assert.equal(scenario.type_id, 34);
  assert.equal(scenario.requested_quantity, 55);
  assert.equal(scenario.acquisition.source, "MARKET");
  assert.equal(scenario.disposition.source, "MARKET");
  assert.ok(scenario.acquisition.market);
  assert.ok(scenario.disposition.market);
  assert.equal(scenario.acquisition.market.limit_price, 105);
  assert.equal(scenario.disposition.market.limit_price, 115);
  assert.equal(scenario.origin.location_id, 60003760);
  assert.equal(scenario.destination.location_id, 60003760);
});

test("does not manufacture a candidate when visible best prices do not cross", () => {
  assert.equal(
    generateMarketTradeCandidates(
      market([
        order({ order_id: 10, price: 120 }),
        order({ order_id: 20, is_buy_order: true, price: 120 }),
      ]),
    ).length,
    0,
  );
});

test("incomplete market evidence yields no candidate", () => {
  assert.equal(
    generateMarketTradeCandidates(
      market([
        order({ order_id: 10, price: 100 }),
        order({ order_id: 20, is_buy_order: true, price: 120 }),
      ], "PARTIAL"),
    ).length,
    0,
  );
});

test("non-public market provenance never becomes a candidate source", () => {
  const input = market([
    order({ order_id: 10, price: 100 }),
    order({ order_id: 20, is_buy_order: true, price: 120 }),
  ]);
  input.provenance.principal_scope = "CHARACTER";
  assert.equal(generateMarketTradeCandidates(input).length, 0);
});


test("depth-bounded candidate generation exposes multiple visible levels without combinatorial expansion", () => {
  const scenarios = generateMarketTradeCandidates(
    market([
      order({ order_id: 10, price: 100, volume_remain: 3 }),
      order({ order_id: 11, price: 101, volume_remain: 4 }),
      order({ order_id: 12, price: 102, volume_remain: 100 }),
      order({ order_id: 20, is_buy_order: true, price: 120, volume_remain: 2 }),
      order({ order_id: 21, is_buy_order: true, price: 119, volume_remain: 3 }),
      order({ order_id: 22, is_buy_order: true, price: 118, volume_remain: 100 }),
    ]),
    {
      execution_order_range: "region",
      max_depth_levels: 2,
      max_candidate_quantity: null,
    },
  );

  assert.equal(scenarios.length, 1);
  assert.equal(scenarios[0]?.requested_quantity, 5);
  assert.equal(scenarios[0]?.acquisition.market?.limit_price, 101);
  assert.equal(scenarios[0]?.disposition.market.limit_price, 119);
});


test("BUY_AND_RELIST models buying visible sell liquidity then projecting a maker sell", () => {
  const scenarios = generateMarketTradeCandidates(
    market([
      order({ order_id: 10, price: 100, volume_remain: 5 }),
      order({ order_id: 11, price: 110, volume_remain: 5 }),
      order({ order_id: 20, is_buy_order: true, price: 95, volume_remain: 100 }),
    ]),
    {
      execution_order_range: "region",
      max_depth_levels: 1,
      maker_sell_buffer_levels: 1,
      max_candidate_quantity: null,
      strategy: "BUY_AND_RELIST",
    },
  );

  assert.equal(scenarios.length, 1);
  const scenario = scenarios[0]!;
  assert.equal(scenario.requested_quantity, 5);
  assert.equal(scenario.acquisition.market?.execution_mode, "TAKER_AGAINST_SELL");
  assert.equal(scenario.acquisition.market?.limit_price, 100);
  assert.equal(scenario.disposition.market.execution_mode, "MAKER_SELL");
  assert.equal(scenario.disposition.market.limit_price, 110);
  assert.equal(scenario.disposition.market.execution_location.location_id, 60003760);
  assert.notEqual(scenario.disposition.market.limit_price, 95);
});
