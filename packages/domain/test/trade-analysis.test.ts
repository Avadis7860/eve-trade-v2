import assert from "node:assert/strict";
import test from "node:test";
import type {
  CanonicalMarketState,
  CanonicalPlayerState,
  EsiAsset,
  EsiMarketOrder,
  MarketHistorySnapshot,
  TradeAnalysisRequest,
} from "@eve-trade/contracts";
import { fingerprintTradeScenario, parseMarketOrderRange, simulateTakerAgainstBuy, simulateTakerAgainstSell } from "../src/trade-analysis.js";

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

test("known ESI market ranges are parsed while unknown source values remain unknown", () => {
  assert.equal(parseMarketOrderRange("station"), "station");
  assert.equal(parseMarketOrderRange("40"), "40");
  assert.equal(parseMarketOrderRange("future-esi-value"), null);
});

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

test("unknown counterparty range never becomes silently compatible", () => {
  const result = simulateTakerAgainstBuy({
    snapshot: snapshot([
      baseOrder({
        order_id: 1,
        is_buy_order: true,
        price: 100,
        range: "future-esi-value",
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
  assert.equal(result.reasons.some((item) => item.code === "RANGE_UNKNOWN"), true);
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


function playerState(overrides: {
  wallet?: number | null;
  walletObservedAt?: string | null;
  assets?: EsiAsset[] | null;
  assetsObservedAt?: string | null;
} = {}): CanonicalPlayerState {
  const walletValue = overrides.wallet === undefined ? 1_000_000 : overrides.wallet;
  const assets = overrides.assets ?? [];
  const walletObservedAt = overrides.walletObservedAt ?? "2026-09-25T10:00:00.000Z";
  const assetsObservedAt = overrides.assetsObservedAt ?? "2026-09-25T10:00:00.000Z";
  const quality = (observedAt: string | null) => ({
    availability: "COMPLETE" as const,
    coverage: "COMPLETE" as const,
    health: "HEALTHY" as const,
    observed_at: observedAt,
    fresh_until: null,
    observation_ids: ["observation-1"],
    error: null,
  });

  return {
    character_id: 90000001,
    principal: {
      character_id: 90000001,
      name: "Pilot",
      corporation_id: 98000001,
      identity_observation_id: "identity-1",
      observed_at: "2026-09-25T10:00:00.000Z",
      provenance: {
        source_kind: "ESI",
        source_id: "character",
        endpoint: "/characters/90000001/",
        principal_scope: "CHARACTER",
        principal_id: 90000001,
      },
    },
    identity: null,
    wallet: {
      quality: quality(walletObservedAt),
      records: walletValue === null ? null : [walletValue],
    },
    journal: { quality: quality("2026-09-25T10:00:00.000Z"), records: [] },
    transactions: { quality: quality("2026-09-25T10:00:00.000Z"), records: [] },
    assets: {
      quality: quality(assetsObservedAt),
      records: assets,
    },
    active_orders: { quality: quality("2026-09-25T10:00:00.000Z"), records: [] },
  };
}

function request(overrides: Partial<TradeAnalysisRequest> = {}): TradeAnalysisRequest {
  const market = snapshot([
    baseOrder({ order_id: 1, price: 100, volume_remain: 10 }),
  ]);
  const dispositionMarket = snapshot([
    baseOrder({
      order_id: 2,
      is_buy_order: true,
      price: 90,
      volume_remain: 10,
      location_id: 60003761,
    }),
  ]);
  return {
    scenario: {
      type_id: 34,
      requested_quantity: 5,
      origin: location,
      destination: { ...location, location_id: 60003761 },
      acquisition: {
        source: "MARKET",
        market: {
          execution_mode: "TAKER_AGAINST_SELL",
          execution_location: location,
          quantity: 5,
          limit_price: 100,
          order_range: "station",
        },
      },
      disposition: {
        source: "MARKET",
        market: {
          execution_mode: "TAKER_AGAINST_BUY",
          execution_location: { ...location, location_id: 60003761 },
          quantity: 5,
          limit_price: 90,
          order_range: "station",
        },
      },
    },
    analysis_context: {
      as_of: "2026-09-25T10:05:00.000Z",
      freshness_policy: {
        max_market_age_seconds: 600,
        max_player_age_seconds: 600,
      },
    },
    acquisition_market: market,
    disposition_market: {
      snapshot: {
        ...dispositionMarket.snapshot,
        snapshot_id: "snapshot-2",
        collection_id: "snapshot-2",
      },
      market: {
        ...dispositionMarket.market,
        collection_id: "snapshot-2",
      },
    },
    player_context: { state: playerState({ wallet: 1_000_000 }) },
    capital_policy: {
      source: "WALLET_BALANCE",
      deployable_capital: null,
      escrow: 500,
      escrow_is_separate: true,
    },
    fee_context: {
      broker_fee_rate: null,
      sales_tax_rate: 0.075,
      source: "EXPLICIT",
    },
    logistics_context: {
      status: "COMPLETE",
      cost: 50,
      jump_count: 2,
      travel_time_seconds: 120,
      provenance: {
        source_kind: "ESI",
        source_id: "route-test",
        endpoint: "/route/",
        principal_scope: "PUBLIC",
      },
    },
    constraints: {
      max_quantity: null,
      max_capital: null,
      min_quantity: null,
      execution_modes: ["TAKER_AGAINST_SELL", "TAKER_AGAINST_BUY"],
    },
    ...overrides,
  };
}

test("full orchestration computes market-to-market simulated economics without subtracting escrow", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const result = analyzeTradeRequest(request());

  assert.equal(result.contract_version, "phase-04.2");
  assert.equal(result.status, "EXECUTABLE");
  assert.equal(result.acquisition_leg.filled_quantity, 5);
  assert.equal(result.disposition_leg.filled_quantity, 5);
  assert.equal(result.capital_context.wallet_cash, 1_000_000);
  assert.equal(result.capital_context.committed_escrow, 500);
  assert.equal(result.capital_context.deployable_capital, 1_000_000);
  assert.equal(result.economic_result.acquisition_cash_outflow, 500);
  assert.equal(result.economic_result.disposition_proceeds, 450);
  assert.equal(result.economic_result.fees_total, 33.75);
  assert.equal(result.economic_result.logistics_cost, 50);
  assert.equal(result.economic_result.simulated_net_result, -133.75);
  assert.equal(result.economic_result.simulated_return, -0.2675);
});

test("capital policy limits the acquisition fill instead of silently overspending", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const result = analyzeTradeRequest(request({
    capital_policy: {
      source: "EXPLICIT_DEPLOYABLE",
      deployable_capital: 250,
      escrow: 1000,
      escrow_is_separate: true,
    },
  }));

  assert.equal(result.status, "PARTIAL");
  assert.equal(result.acquisition_leg.filled_quantity, 2);
  assert.equal(result.acquisition_leg.remaining_quantity, 3);
  assert.equal(result.acquisition_leg.reasons[0]?.code, "CAPITAL_INSUFFICIENT");
});

test("wallet capital unavailable is not converted to zero", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const result = analyzeTradeRequest(request({
    player_context: { state: playerState({ wallet: null }) },
  }));

  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.equal(result.capital_context.deployable_capital, null);
  assert.equal(result.status_reasons.some((r) => r.code === "WALLET_UNAVAILABLE"), true);
});

test("stale market blocks current executability", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const result = analyzeTradeRequest(request({
    analysis_context: {
      as_of: "2026-09-25T12:00:00.000Z",
      freshness_policy: { max_market_age_seconds: 60, max_player_age_seconds: 600 },
    },
  }));

  assert.equal(result.status, "STALE");
  assert.equal(result.status_reasons.some((r) => r.code === "FRESHNESS_EXCEEDED"), true);
});

test("missing market freshness metadata blocks executability instead of being ignored", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const input = request();
  Reflect.deleteProperty(input.disposition_market!.snapshot, "observed_at");

  const result = analyzeTradeRequest(input);

  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.equal(
    result.status_reasons.some((r) => r.code === "FRESHNESS_METADATA_MISSING"),
    true,
  );
});

test("invalid player freshness expiry blocks executability", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const input = request();
  input.player_context!.state.wallet.quality.fresh_until = "not-a-timestamp";

  const result = analyzeTradeRequest(input);

  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.equal(
    result.status_reasons.some((r) => r.code === "FRESHNESS_METADATA_MISSING"),
    true,
  );
});

test("market and player timestamp skew is allowed while both remain within policy", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const input = request();
  input.player_context!.state.wallet.quality.observed_at = "2026-09-25T10:00:00.000Z";
  input.acquisition_market!.snapshot.observed_at = "2026-09-25T10:04:00.000Z";
  input.disposition_market!.snapshot.observed_at = "2026-09-25T10:04:30.000Z";
  input.acquisition_market!.market.observed_at = "2026-09-25T10:04:00.000Z";
  input.disposition_market!.market.observed_at = "2026-09-25T10:04:30.000Z";

  const result = analyzeTradeRequest(input);

  assert.equal(result.status, "EXECUTABLE");
  assert.equal(result.status_reasons.some((r) => r.code === "FRESHNESS_EXCEEDED"), false);
});

test("future market data is explicitly rejected", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const result = analyzeTradeRequest(request({
    analysis_context: {
      as_of: "2026-09-25T09:00:00.000Z",
      freshness_policy: { max_market_age_seconds: 600, max_player_age_seconds: 600 },
    },
  }));

  assert.equal(result.status, "STALE");
  assert.equal(result.status_reasons.some((r) => r.code === "FUTURE_DATA"), true);
});

test("unknown inventory cost basis keeps the complete historical profit unknown", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const result = analyzeTradeRequest(request({
    scenario: {
      ...request().scenario,
      acquisition: {
        source: "EXISTING_INVENTORY",
        inventory: { source: "EXISTING_INVENTORY", type_id: 34, quantity: 5 },
      },
    },
    acquisition_market: null,
    capital_policy: {
      source: "EXPLICIT_DEPLOYABLE",
      deployable_capital: 0,
      escrow: null,
      escrow_is_separate: true,
    },
  }));

  assert.equal(result.status, "PARTIAL");
  assert.equal(result.acquisition_leg.filled_quantity, 5);
  assert.equal(result.economic_result.disposition_proceeds, 450);
  assert.equal(result.economic_result.gross_result, null);
  assert.equal(result.economic_result.simulated_net_result, null);
  assert.equal(result.economic_result.simulated_return, null);
});

test("known inventory cost basis enables disposition economics without treating it as realized P&L", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const result = analyzeTradeRequest(request({
    scenario: {
      ...request().scenario,
      acquisition: {
        source: "EXISTING_INVENTORY",
        inventory: {
          source: "EXISTING_INVENTORY",
          type_id: 34,
          quantity: 5,
          cost_basis: 300,
        },
      },
    },
    acquisition_market: null,
    capital_policy: {
      source: "EXPLICIT_DEPLOYABLE",
      deployable_capital: 0,
      escrow: null,
      escrow_is_separate: true,
    },
  }));

  assert.equal(result.status, "EXECUTABLE");
  assert.equal(result.economic_result.gross_result, 150);
  assert.equal(result.economic_result.simulated_net_result, 66.25);
  assert.equal(result.economic_result.capital_required, 300);
});

test("missing logistics is a blocking completeness issue when locations differ", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const result = analyzeTradeRequest(request({
    logistics_context: {
      status: "UNKNOWN",
      cost: null,
      jump_count: null,
      travel_time_seconds: null,
      provenance: null,
    },
  }));

  assert.equal(result.status, "PARTIAL");
  assert.equal(result.status_reasons.some((r) => r.code === "LOGISTICS_INCOMPLETE"), true);
  assert.equal(result.economic_result.simulated_net_result, null);
});

test("same-location disposition needs no invented logistics source", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const result = analyzeTradeRequest(request({
    scenario: {
      ...request().scenario,
      destination: location,
      disposition: {
        source: "MARKET",
        market: {
          execution_mode: "TAKER_AGAINST_BUY",
          execution_location: location,
          quantity: 5,
          limit_price: 90,
          order_range: "station",
        },
      },
    },
    disposition_market: snapshot([
      baseOrder({ order_id: 2, is_buy_order: true, price: 90, volume_remain: 10 }),
    ]),
    logistics_context: {
      status: "UNKNOWN",
      cost: null,
      jump_count: null,
      travel_time_seconds: null,
      provenance: null,
    },
  }));

  assert.equal(result.status, "EXECUTABLE");
  assert.equal(result.economic_result.logistics_cost, 0);
});

test("public market provenance is preserved and never turned into order ownership", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const result = analyzeTradeRequest(request());

  assert.equal(result.market_evidence.acquisition_provenance?.principal_scope, "PUBLIC");
  assert.equal(result.market_evidence.disposition_provenance?.principal_scope, "PUBLIC");
  assert.deepEqual(result.market_evidence.acquisition_order_ids, [1]);
  assert.deepEqual(result.market_evidence.disposition_order_ids, [2]);
});

test("broker fee rate remains unused for taker execution while sales tax remains required", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const result = analyzeTradeRequest(request({
    fee_context: {
      broker_fee_rate: 0.03,
      sales_tax_rate: 0.075,
      source: "EXPLICIT",
    },
  }));

  assert.equal(result.status, "EXECUTABLE");
  assert.equal(result.economic_result.fees_total, 33.75);
});

test("missing sales tax blocks net economics instead of becoming zero", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const result = analyzeTradeRequest(request({
    fee_context: {
      broker_fee_rate: null,
      sales_tax_rate: null,
      source: "UNKNOWN",
    },
  }));

  assert.equal(result.status, "PARTIAL");
  assert.equal(result.economic_result.fees_total, null);
  assert.equal(result.status_reasons.some((r) => r.code === "FEE_RATE_UNKNOWN"), true);
});

test("maker modes are reserved and never executable", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const result = analyzeTradeRequest(request({
    scenario: {
      ...request().scenario,
      acquisition: {
        source: "MARKET",
        market: {
          execution_mode: "MAKER_BUY",
          execution_location: location,
          quantity: 5,
          limit_price: 100,
          order_range: "station",
        },
      },
    },
  }));

  assert.equal(result.status, "NOT_EXECUTABLE");
  assert.equal(result.acquisition_leg.filled_quantity, 0);
  assert.equal(result.acquisition_leg.simulated_fills.length, 0);
  assert.equal(result.status_reasons.some((r) => r.code === "MAKER_MODE_UNSUPPORTED"), true);
});

test("maker disposition mode is not silently simulated as a taker sale", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const input = request();
  input.scenario.disposition.market.execution_mode = "MAKER_SELL";

  const result = analyzeTradeRequest(input);

  assert.equal(result.status, "NOT_EXECUTABLE");
  assert.equal(result.disposition_leg.filled_quantity, 0);
  assert.equal(result.disposition_leg.simulated_fills.length, 0);
  assert.equal(
    result.status_reasons.some((r) => r.code === "MAKER_MODE_UNSUPPORTED"),
    true,
  );
});

test("character-scoped market evidence cannot be simulated as public liquidity", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const input = request();
  Reflect.set(input.acquisition_market!.market.provenance, "principal_scope", "CHARACTER");

  const result = analyzeTradeRequest(input);

  assert.equal(result.status, "NOT_EXECUTABLE");
  assert.equal(result.acquisition_leg.filled_quantity, 0);
  assert.equal(result.acquisition_leg.simulated_fills.length, 0);
  assert.equal(
    result.status_reasons.some((r) => r.code === "MARKET_SCOPE_INVALID"),
    true,
  );
});

test("max capital constraint is enforced independently of wallet balance", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const result = analyzeTradeRequest(request({
    constraints: {
      max_quantity: null,
      max_capital: 150,
      min_quantity: null,
      execution_modes: ["TAKER_AGAINST_SELL", "TAKER_AGAINST_BUY"],
    },
  }));

  assert.equal(result.status, "PARTIAL");
  assert.equal(result.acquisition_leg.filled_quantity, 1);
  assert.equal(result.acquisition_leg.remaining_quantity, 4);
  assert.equal(result.status_reasons.some((r) => r.code === "CAPITAL_INSUFFICIENT"), true);
});

test("min quantity constraint blocks a request below the declared floor", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const result = analyzeTradeRequest(request({
    constraints: {
      max_quantity: null,
      max_capital: null,
      min_quantity: 6,
      execution_modes: ["TAKER_AGAINST_SELL", "TAKER_AGAINST_BUY"],
    },
  }));

  assert.equal(result.status, "NOT_EXECUTABLE");
  assert.equal(result.status_reasons.some((r) => r.code === "CONSTRAINT_VIOLATION"), true);
});

test("inventory evidence can prove insufficient quantity without fabricating inventory", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const result = analyzeTradeRequest(request({
    scenario: {
      ...request().scenario,
      acquisition: {
        source: "EXISTING_INVENTORY",
        inventory: {
          source: "EXISTING_INVENTORY",
          type_id: 34,
          quantity: 5,
          asset_ids: [501],
          cost_basis: 300,
        },
      },
    },
    acquisition_market: null,
    player_context: {
      state: playerState({
        assets: [
          {
            item_id: 501,
            type_id: 34,
            quantity: 3,
            location_id: 60003760,
          } as EsiAsset,
        ],
      }),
    },
    capital_policy: {
      source: "EXPLICIT_DEPLOYABLE",
      deployable_capital: 0,
      escrow: null,
      escrow_is_separate: true,
    },
  }));

  assert.equal(result.status, "NOT_EXECUTABLE");
  assert.equal(
    result.status_reasons.some((r) => r.code === "INVENTORY_INSUFFICIENT"),
    true,
  );
  assert.equal(result.capital_context.inventory?.[0]?.quantity, 3);
});

test("stale wallet blocks wallet-funded analysis", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const result = analyzeTradeRequest(request({
    player_context: {
      state: playerState({
        wallet: 1_000_000,
        walletObservedAt: "2026-09-25T08:00:00.000Z",
      }),
    },
  }));

  assert.equal(result.status, "STALE");
  assert.equal(
    result.status_reasons.some((r) => r.code === "FRESHNESS_EXCEEDED"),
    true,
  );
});

test("market ERROR remains unavailable instead of becoming an empty book", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const input = request();
  input.disposition_market!.snapshot.status = "ERROR";
  input.disposition_market!.market.status = "ERROR";
  input.disposition_market!.market.orders = [];

  const result = analyzeTradeRequest(input);

  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.equal(
    result.status_reasons.some((r) => r.code === "MARKET_UNAVAILABLE"),
    true,
  );
});

test("missing disposition market remains absent rather than becoming zero liquidity", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const result = analyzeTradeRequest(request({ disposition_market: null }));

  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.equal(
    result.status_reasons.some((r) => r.code === "MARKET_UNAVAILABLE"),
    true,
  );
});

test("partial wallet evidence remains unavailable", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const input = request();
  input.player_context!.state.wallet.quality.availability = "PARTIAL";
  input.player_context!.state.wallet.records = [1_000_000];

  const result = analyzeTradeRequest(input);

  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.equal(
    result.status_reasons.some((r) => r.code === "WALLET_UNAVAILABLE"),
    true,
  );
});

test("error wallet evidence remains unavailable", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const input = request();
  input.player_context!.state.wallet.quality.health = "FAILED";

  const result = analyzeTradeRequest(input);

  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.equal(
    result.status_reasons.some((r) => r.code === "WALLET_UNAVAILABLE"),
    true,
  );
});

test("unknown wallet evidence remains unavailable", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const input = request();
  input.player_context!.state.wallet.quality.availability = "UNKNOWN";
  input.player_context!.state.wallet.records = null;

  const result = analyzeTradeRequest(input);

  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.equal(
    result.status_reasons.some((r) => r.code === "WALLET_UNAVAILABLE"),
    true,
  );
});

test("broker fee may remain unknown for immediate taker analysis", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const result = analyzeTradeRequest(request({
    fee_context: {
      broker_fee_rate: null,
      sales_tax_rate: 0.075,
      source: "EXPLICIT",
    },
  }));

  assert.equal(result.status, "EXECUTABLE");
  assert.equal(result.economic_result.fees_total, 33.75);
});

test("partial sell-side depth is reported as partial without fabricating the missing quantity", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const input = request();
  input.acquisition_market!.market.orders = [
    baseOrder({ order_id: 1, price: 100, volume_remain: 2 }),
  ];
  input.scenario.acquisition.market!.quantity = 5;
  input.scenario.requested_quantity = 5;

  const result = analyzeTradeRequest(input);

  assert.equal(result.status, "PARTIAL");
  assert.equal(result.acquisition_leg.filled_quantity, 2);
  assert.equal(result.acquisition_leg.remaining_quantity, 3);
  assert.equal(
    result.status_reasons.some((r) => r.code === "DEPTH_EXHAUSTED"),
    true,
  );
  assert.equal(result.economic_result.gross_result, null);
});

test("partial buy-side depth is reported as partial without fabricating the missing quantity", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const input = request();
  input.disposition_market!.market.orders = [
    baseOrder({
      order_id: 2,
      is_buy_order: true,
      price: 90,
      volume_remain: 2,
      location_id: 60003761,
    }),
  ];

  const result = analyzeTradeRequest(input);

  assert.equal(result.status, "PARTIAL");
  assert.equal(result.disposition_leg.filled_quantity, 2);
  assert.equal(result.disposition_leg.remaining_quantity, 3);
  assert.equal(
    result.status_reasons.some((r) => r.code === "DEPTH_EXHAUSTED"),
    true,
  );
  assert.equal(result.economic_result.disposition_proceeds, 180);
});

test("escrow remains separate when its value is unavailable", async () => {
  const { analyzeTradeRequest } = await import("../src/trade-analysis.js");
  const result = analyzeTradeRequest(request({
    capital_policy: {
      source: "WALLET_BALANCE",
      deployable_capital: null,
      escrow: null,
      escrow_is_separate: true,
    },
  }));

  assert.equal(result.status, "EXECUTABLE");
  assert.equal(result.capital_context.wallet_cash, 1_000_000);
  assert.equal(result.capital_context.committed_escrow, null);
  assert.equal(result.capital_context.deployable_capital, 1_000_000);
});
