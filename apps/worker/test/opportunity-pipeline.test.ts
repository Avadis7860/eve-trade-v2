import assert from "node:assert/strict";
import test from "node:test";
import type {
  CanonicalMarketState,
  EsiMarketOrder,
  MarketHistorySnapshot,
  OpportunityObservation,
  OpportunityPipelineRun,
  EconomicOperation,
} from "@eve-trade/contracts";
import { runOpportunityPipeline } from "../src/opportunity-pipeline.js";

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
  observed_at: "2026-09-25T22:00:00.000Z",
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

const snapshot = (marketState: CanonicalMarketState, comparisonEligible = true): MarketHistorySnapshot => ({
  snapshot_id: marketState.collection_id,
  collection_id: marketState.collection_id,
  region_id: marketState.region_id,
  observed_at: marketState.observed_at,
  status: marketState.status,
  comparison_eligible: comparisonEligible,
  state_fingerprint: "state-1",
  source_last_modified: null,
  source_compatibility_date: "2026-09-25",
  source_consistency: "UNVERIFIED",
  observation_kind: "INITIAL",
  previous_snapshot_id: null,
  source_pages: 1,
});

function sink() {
  const observations: OpportunityObservation[] = [];
  const runs: OpportunityPipelineRun[] = [];
  return {
    observations,
    runs,
    async saveObservation(value: OpportunityObservation) {
      observations.push(value);
    },
    async savePipelineRun(value: OpportunityPipelineRun) {
      runs.push(value);
    },
  };
}

test("one complete cycle creates, analyses and persists a real candidate", async () => {
  const marketState = market([
    order({ order_id: 100, price: 100, volume_remain: 5 }),
    order({ order_id: 200, is_buy_order: true, price: 120, volume_remain: 5 }),
  ]);
  const target = sink();

  const run = await runOpportunityPipeline(
    marketState,
    snapshot(marketState),
    target,
    {
      regionId: marketState.region_id,
      observedAt: marketState.observed_at,
      deployableCapital: 10_000,
      salesTaxRate: 0,
      candidateStrategy: "MARKET_TO_MARKET",
    },
  );

  assert.equal(run.status, "SUCCESS");
  assert.equal(run.candidates_generated, 1);
  assert.equal(run.analyses_produced, 1);
  assert.equal(run.observations_persisted, 1);
  assert.equal(target.observations.length, 1);

  const observation = target.observations[0]!;
  assert.equal(observation.presence, "PRESENT");
  assert.equal(observation.scope.principal_scope, "PUBLIC");
  assert.deepEqual(observation.order_ids.acquisition, [100]);
  assert.deepEqual(observation.order_ids.disposition, [200]);
  assert.equal(observation.phase4_result.status, "EXECUTABLE");
  assert.equal(observation.phase4_result.economic_result.simulated_net_result, 100);
});

test("missing fee configuration remains explicit instead of becoming zero", async () => {
  const marketState = market([
    order({ order_id: 100, price: 100 }),
    order({ order_id: 200, is_buy_order: true, price: 120 }),
  ]);
  const target = sink();

  await runOpportunityPipeline(
    marketState,
    snapshot(marketState),
    target,
    {
      regionId: marketState.region_id,
      observedAt: marketState.observed_at,
      deployableCapital: 10_000,
      salesTaxRate: null,
      candidateStrategy: "MARKET_TO_MARKET",
    },
  );

  assert.equal(target.observations[0]?.phase4_result.status, "PARTIAL");
  assert.equal(target.observations[0]?.phase4_result.economic_result.fees_total, null);
  assert.equal(target.observations[0]?.phase4_result.economic_result.simulated_net_result, null);
});

test("complete market input with no crossing prices remains explicitly empty", async () => {
  const marketState = market([
    order({ order_id: 100, price: 120 }),
    order({ order_id: 200, is_buy_order: true, price: 110 }),
  ]);
  const target = sink();

  const run = await runOpportunityPipeline(
    marketState,
    snapshot(marketState),
    target,
    {
      regionId: marketState.region_id,
      observedAt: marketState.observed_at,
      deployableCapital: 10_000,
      salesTaxRate: 0,
    },
  );

  assert.equal(run.status, "NO_CANDIDATES");
  assert.equal(run.candidates_generated, 0);
  assert.equal(target.observations.length, 0);
});

test("incomplete or non-comparable input is not promoted to an empty market result", async () => {
  const marketState = market([
    order({ order_id: 100, price: 100 }),
    order({ order_id: 200, is_buy_order: true, price: 120 }),
  ], "PARTIAL");
  const target = sink();

  const run = await runOpportunityPipeline(
    marketState,
    snapshot(marketState, false),
    target,
    {
      regionId: marketState.region_id,
      observedAt: marketState.observed_at,
      deployableCapital: 10_000,
      salesTaxRate: 0,
    },
  );

  assert.equal(run.status, "INPUT_UNAVAILABLE");
  assert.equal(target.observations.length, 0);
});


test("BUY_AND_RELIST pipeline persists a planned economic operation without fabricating acquisition evidence", async () => {
  const marketState = market([
    order({ order_id: 100, price: 100, volume_remain: 5 }),
    order({ order_id: 101, price: 110, volume_remain: 5 }),
    order({ order_id: 200, is_buy_order: true, price: 95, volume_remain: 10 }),
  ]);
  const target = sink();
  const operations: EconomicOperation[] = [];

  const run = await runOpportunityPipeline(
    marketState,
    snapshot(marketState),
    target,
    {
      regionId: marketState.region_id,
      observedAt: marketState.observed_at,
      deployableCapital: 10_000,
      salesTaxRate: 0,
      brokerFeeRate: 0,
    },
    {
      async save(operation: EconomicOperation) {
        operations.push(operation);
      },
     },
  );

  assert.equal(run.status, "SUCCESS");
  assert.equal(run.candidates_generated, 1);
  assert.equal(target.observations.length, 1);
  assert.equal(target.observations[0]?.phase4_result.status, "PROJECTED");
  assert.equal(operations.length, 1);
  assert.equal(operations[0]?.lifecycle_state, "ACQUISITION_PLANNED");
  assert.equal(operations[0]?.acquired_quantity, 0);
  assert.equal(operations[0]?.remaining_quantity, 0);
  assert.equal(operations[0]?.scope.principal_scope, "PUBLIC");
  assert.equal(operations[0]?.scope.character_id, null);
  assert.equal(operations[0]?.provenance[0]?.principal_scope, "PUBLIC");
  assert.deepEqual(operations[0]?.acquisition_evidence, []);
});
