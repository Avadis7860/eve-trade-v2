import assert from "node:assert/strict";
import test from "node:test";
import type { TradeAnalysisResult, TradeScenario } from "@eve-trade/contracts";
import {
  assessOpportunityOutcome,
  buildOpportunityIdentity,
  createOpportunityObservation,
  reconstructOpportunityHistory,
} from "../src/opportunity-tracking.js";

const scenario: TradeScenario = {
  type_id: 34,
  requested_quantity: 10,
  acquisition: {
    source: "MARKET",
    market: {
      execution_mode: "TAKER_AGAINST_SELL",
      execution_location: { region_id: 10000002, system_id: 30000142, location_id: 60003760 },
      quantity: 10,
      limit_price: 100,
      order_range: "region",
    },
  },
  disposition: {
    source: "MARKET",
    market: {
      execution_mode: "TAKER_AGAINST_BUY",
      execution_location: { region_id: 10000043, system_id: 30002187, location_id: 60008494 },
      quantity: 10,
      limit_price: 130,
      order_range: "region",
    },
  },
  origin: { region_id: 10000002, system_id: 30000142, location_id: 60003760 },
  destination: { region_id: 10000043, system_id: 30002187, location_id: 60008494 },
};

function result(
  fingerprint: string,
  net: number | null,
  acquisitionFilled = 10,
  dispositionFilled = 10,
  status: TradeAnalysisResult["status"] = "EXECUTABLE",
): TradeAnalysisResult {
  return {
    contract_version: "phase-04.2",
    status,
    status_reasons: [],
    scenario_fingerprint: fingerprint,
    acquisition_leg: {
      execution_mode: "TAKER_AGAINST_SELL",
      requested_quantity: 10,
      filled_quantity: acquisitionFilled,
      remaining_quantity: 10 - acquisitionFilled,
      simulated_fills: [],
      status: acquisitionFilled === 10 ? "EXECUTABLE" : "PARTIAL",
      reasons: [],
    },
    logistics_leg: {
      status: "COMPLETE",
      cost: 0,
      jump_count: 0,
      travel_time_seconds: 0,
      provenance: null,
    },
    disposition_leg: {
      execution_mode: "TAKER_AGAINST_BUY",
      requested_quantity: 10,
      filled_quantity: dispositionFilled,
      remaining_quantity: 10 - dispositionFilled,
      simulated_fills: [],
      status: dispositionFilled === 10 ? "EXECUTABLE" : "PARTIAL",
      reasons: [],
    },
    capital_context: {
      wallet_cash: 5000,
      committed_escrow: 0,
      inventory: null,
      deployable_capital: 5000,
      source: "EXPLICIT_DEPLOYABLE",
    },
    fee_context: {
      broker_fee_rate: null,
      sales_tax_rate: 0.05,
      source: "EXPLICIT",
    },
    market_evidence: {
      acquisition_snapshot_id: "snap-a",
      disposition_snapshot_id: "snap-b",
      acquisition_order_ids: [1],
      disposition_order_ids: [2],
      acquisition_provenance: {
        source_kind: "ESI",
        source_id: "esi:markets/10000002/orders",
        endpoint: "/markets/10000002/orders/",
        principal_scope: "PUBLIC",
      },
      disposition_provenance: {
        source_kind: "ESI",
        source_id: "esi:markets/10000043/orders",
        endpoint: "/markets/10000043/orders/",
        principal_scope: "PUBLIC",
      },
    },
    economic_result: {
      acquisition_cash_outflow: 1000,
      disposition_proceeds: 1300,
      gross_result: 300,
      fees_total: 65,
      logistics_cost: 0,
      simulated_net_result: net,
      capital_required: 1000,
      simulated_return: net === null ? null : net / 1000,
    },
  };
}

test("opportunity identity is stable across as-of/snapshot/player observer changes", () => {
  const a = buildOpportunityIdentity(scenario);
  const bScenario = structuredClone(scenario);
  const aResult = result("phase4-a", 235);
  const b = buildOpportunityIdentity(bScenario);
  assert.equal(a.opportunity_id, b.opportunity_id);
  assert.notEqual(aResult.scenario_fingerprint, a.opportunity_id);
});

test("existing-inventory player-specific asset ids do not redefine the opportunity", () => {
  const first: TradeScenario = {
    ...scenario,
    acquisition: {
      source: "EXISTING_INVENTORY",
      inventory: { source: "EXISTING_INVENTORY", type_id: 34, quantity: 10, asset_ids: [101, 102], cost_basis: 500 },
    },
  };
  const second: TradeScenario = {
    ...first,
    acquisition: {
      source: "EXISTING_INVENTORY",
      inventory: { source: "EXISTING_INVENTORY", type_id: 34, quantity: 10, asset_ids: [201, 202], cost_basis: 550 },
    },
  };
  assert.equal(buildOpportunityIdentity(first).opportunity_id, buildOpportunityIdentity(second).opportunity_id);
});

test("observation ids are idempotent and provenance keeps observer separate", () => {
  const r = result("phase4-1", 235);
  const one = createOpportunityObservation({
    observed_at: "2026-09-25T10:00:00Z",
    scenario,
    phase4_result: r,
    presence: "PRESENT",
    observer_character_id: 90000001,
    observer_provenance: {
      source_kind: "ESI",
      source_id: "esi:character/90000001",
      endpoint: "/characters/90000001/",
      principal_scope: "CHARACTER",
      principal_id: 90000001,
    },
  });
  const two = createOpportunityObservation({
    observed_at: "2026-09-25T10:00:00Z",
    scenario,
    phase4_result: r,
    presence: "PRESENT",
    observer_character_id: 90000001,
    observer_provenance: {
      source_kind: "ESI",
      source_id: "esi:character/90000001",
      endpoint: "/characters/90000001/",
      principal_scope: "CHARACTER",
      principal_id: 90000001,
    },
  });
  assert.equal(one.observation_id, two.observation_id);
  assert.equal(one.opportunity_id, two.opportunity_id);
  assert.equal(one.observer?.character_id, 90000001);
  assert.equal(one.provenance.some((p) => p.principal_scope === "PUBLIC"), true);
  assert.equal(one.provenance.some((p) => p.principal_scope === "CHARACTER"), true);
});

test("freshness is preserved instead of normalized to a healthy value", () => {
  const r = result("phase4-stale", 235, 10, 10, "STALE");
  const observation = createOpportunityObservation({
    observed_at: "2026-09-25T10:00:00Z",
    scenario,
    phase4_result: r,
    presence: "UNAVAILABLE",
  });
  assert.equal(observation.freshness_state, "STALE");
});

test("history tracks improvement, deterioration, disappearance, proof loss and return", () => {
  const o1 = createOpportunityObservation({
    observed_at: "2026-09-25T10:00:00Z",
    scenario,
    phase4_result: result("p1", 100),
    presence: "PRESENT",
  });
  const o2 = createOpportunityObservation({
    observed_at: "2026-09-25T10:05:00Z",
    scenario,
    phase4_result: result("p2", 150),
    presence: "PRESENT",
  });
  const o3 = createOpportunityObservation({
    observed_at: "2026-09-25T10:10:00Z",
    scenario,
    phase4_result: result("p3", null, 4, 4, "PARTIAL"),
    presence: "PRESENT",
  });
  const o4 = createOpportunityObservation({
    observed_at: "2026-09-25T10:15:00Z",
    scenario,
    phase4_result: result("p4", null, 0, 0, "DATA_UNAVAILABLE"),
    presence: "UNAVAILABLE",
  });
  const o5 = createOpportunityObservation({
    observed_at: "2026-09-25T10:20:00Z",
    scenario,
    phase4_result: result("p5", null, 0, 0, "NOT_EXECUTABLE"),
    presence: "ABSENT",
  });
  const o6 = createOpportunityObservation({
    observed_at: "2026-09-25T10:25:00Z",
    scenario,
    phase4_result: result("p6", 180),
    presence: "PRESENT",
  });

  assert.deepEqual(
    reconstructOpportunityHistory([o4, o2, o6, o1, o5, o3]).map((event) => event.kind),
    ["INITIAL", "IMPROVED", "PROOF_LOST", "DISAPPEARED", "RETURNED", "MAINTAINED"],
  );
});

test("partial observed quantity is never promoted to complete outcome", () => {
  const outcome = assessOpportunityOutcome({
    opportunity_id: "opp",
    outcome_id: "outcome-1",
    observed_at: "2026-09-25T10:30:00Z",
    expected_quantity: 10000,
    evidence_coverage: "COMPLETE",
    observed_quantity: 1,
    evidence: [{
      evidence_id: "tx-1",
      kind: "TRANSACTION",
      observed_at: "2026-09-25T10:25:00Z",
      provenance: {
        source_kind: "ESI",
        source_id: "esi:character/90000001/transactions",
        endpoint: "/characters/90000001/wallet/transactions/",
        principal_scope: "CHARACTER",
        principal_id: 90000001,
      },
    }],
    observed_subresult: { quantity: 1 },
  });
  assert.equal(outcome.status, "PARTIALLY_OBSERVED");
});

test("complete outcome requires observed quantity to cover the operation quantity", () => {
  const outcome = assessOpportunityOutcome({
    opportunity_id: "opp",
    outcome_id: "outcome-2",
    observed_at: "2026-09-25T10:30:00Z",
    expected_quantity: 10000,
    evidence_coverage: "PARTIAL",
    observed_quantity: 10000,
    evidence: [],
    observed_subresult: null,
  });
  assert.equal(outcome.status, "COMPLETELY_OBSERVED");
});

test("incomplete evidence does not become a false no-evidence result", () => {
  const outcome = assessOpportunityOutcome({
    opportunity_id: "opp",
    outcome_id: "outcome-3",
    observed_at: "2026-09-25T10:30:00Z",
    expected_quantity: 10,
    evidence_coverage: "PARTIAL",
    observed_quantity: 0,
    evidence: [],
    observed_subresult: null,
  });
  assert.equal(outcome.status, "UNKNOWN");
});

test("not observed outcome is explicit", () => {
  const outcome = notObservedOpportunityOutcome("opp", "outcome-4", "2026-09-25T10:30:00Z");
  assert.equal(outcome.status, "NOT_OBSERVED");
  assert.equal(outcome.observed_quantity, null);
});
