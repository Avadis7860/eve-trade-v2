import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveHistoricalPricePosition,
  deriveMarketLiquidity,
  deriveTradeDayCoverage,
  deriveCapitalVelocity,
  detectBookAnomalies,
} from "../src/market-intelligence.js";
import type { EsiMarketOrder, MarketSnapshotTypeMetrics } from "@eve-trade/contracts";

const order = (overrides: Partial<EsiMarketOrder>): EsiMarketOrder => ({
  duration: 90,
  is_buy_order: false,
  issued: "2026-09-26T04:00:00Z",
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

const provenance = {
  source_kind: "ESI" as const,
  source_id: "market",
  endpoint: "/markets/10000002/orders/",
  principal_scope: "PUBLIC" as const,
};

test("depth and quantity coverage are derived from the visible order book", () => {
  const result = deriveMarketLiquidity({
    snapshot_id: "s1",
    type_id: 34,
    orders: [
      order({ order_id: 10, price: 100, volume_remain: 8 }),
      order({ order_id: 11, price: 105, volume_remain: 20 }),
      order({ order_id: 20, is_buy_order: true, price: 120, volume_remain: 5 }),
      order({ order_id: 21, is_buy_order: true, price: 115, volume_remain: 50 }),
    ],
    requested_quantity: 15,
    depth_levels: 2,
    provenance,
  });

  assert.equal(result.visible_supply, 28);
  assert.equal(result.visible_demand, 55);
  assert.equal(result.best_sell_depth, 28);
  assert.equal(result.best_buy_depth, 55);
  assert.equal(result.quantity_coverage, 1);
  assert.equal(result.depth_levels_considered, 2);
});

test("trade days are liquidity coverage, never a guaranteed depletion forecast", () => {
  const result = deriveTradeDayCoverage(1000, 250);
  assert.equal(result.trade_days, 4);
  assert.equal(result.status, "COMPLETE");
  assert.equal(deriveTradeDayCoverage(1000, null).trade_days, null);
  assert.equal(deriveTradeDayCoverage(1000, null).status, "UNKNOWN");
  assert.equal(deriveTradeDayCoverage(1000, 0).status, "ERROR");
});

function metrics(snapshot_id: string, bestSell: number, volume = 100): MarketSnapshotTypeMetrics {
  return {
    snapshot_id,
    type_id: 34,
    best_buy_price: bestSell - 5,
    best_buy_volume: volume,
    best_sell_price: bestSell,
    best_sell_volume: volume,
    spread_absolute: 5,
    spread_relative: 5 / bestSell,
    buy_visible_volume: volume,
    sell_visible_volume: volume,
  };
}

test("historical price position is descriptive and produces an explicit regime", () => {
  const history = [
    metrics("01", 100),
    metrics("02", 110),
    metrics("03", 120),
    metrics("04", 130),
  ];
  const result = deriveHistoricalPricePosition(34, 125, history);
  assert.equal(result.historical_min, 100);
  assert.equal(result.historical_max, 130);
  assert.equal(result.historical_percentile, 0.75);
  assert.ok((result.range_position ?? 0) > 0.8);
  assert.equal(result.regime, "HIGH_RANGE");
  assert.equal(result.status, "COMPLETE");
});

test("missing history stays unknown instead of becoming a neutral numeric value", () => {
  const result = deriveHistoricalPricePosition(34, 120, []);
  assert.equal(result.range_position, null);
  assert.equal(result.historical_percentile, null);
  assert.equal(result.regime, "UNKNOWN");
  assert.equal(result.status, "UNKNOWN");
});

test("book changes remain observational anomalies with explicit comparison method", () => {
  const anomalies = detectBookAnomalies({
    previous: metrics("01", 100, 100),
    current: metrics("02", 112, 40),
    detected_at: "2026-09-26T04:05:00Z",
    provenance: [provenance],
  });
  assert.ok(anomalies.some((item) => item.kind === "SUPPLY_COLLAPSE"));
  assert.ok(anomalies.some((item) => item.kind === "LIQUIDITY_DRAIN"));
  assert.ok(anomalies.some((item) => item.kind === "PRICE_GAP"));
  assert.equal(anomalies.every((item) => item.confidence === "NOT_ASSESSED"), true);
  assert.equal(anomalies.every((item) => item.comparison_basis.length > 0), true);
});


test("capital velocity keeps turnover, capital and return as separate metrics", () => {
  const result = deriveCapitalVelocity(1_000, 4_000, 200, 2 * 86_400);
  assert.equal(result.turnover_per_day, 2_000);
  assert.equal(result.return_per_day, 0.1);
  assert.equal(result.status, "COMPLETE");
  assert.equal(
    deriveCapitalVelocity(1_000, 4_000, null, 2 * 86_400).return_per_day,
    null,
  );
});
