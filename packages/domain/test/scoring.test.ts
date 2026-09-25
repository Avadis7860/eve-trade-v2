import assert from "node:assert/strict";
import test from "node:test";
import type {
  OpportunityObservation,
  PredictionResult,
  ScoringInput,
  ScoringPolicy,
  SourceProvenance,
  TradeAnalysisResult,
  TradeScenario,
} from "@eve-trade/contracts";
import {
  SCORING_POLICY_V1,
  fingerprintScoringPolicy,
  reconstructScoringFingerprint,
  scoreOpportunity,
} from "../src/scoring.js";

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
      limit_price: 120,
      order_range: "region",
    },
  },
  origin: { region_id: 10000002, system_id: 30000142, location_id: 60003760 },
  destination: { region_id: 10000043, system_id: 30002187, location_id: 60008494 },
};

const publicProvenance: SourceProvenance = {
  source_kind: "ESI",
  source_id: "esi:market:10000002",
  endpoint: "/markets/10000002/orders/",
  principal_scope: "PUBLIC",
};

function analysis(
  fingerprint = "phase4-1",
  simulatedReturn: number | null = 0.1,
  status: TradeAnalysisResult["status"] = "EXECUTABLE",
  filled = 10,
): TradeAnalysisResult {
  return {
    contract_version: "phase-04.2",
    status,
    status_reasons: [],
    scenario_fingerprint: fingerprint,
    acquisition_leg: {
      execution_mode: "TAKER_AGAINST_SELL",
      requested_quantity: 10,
      filled_quantity: filled,
      remaining_quantity: 10 - filled,
      simulated_fills: [],
      status: status === "NOT_EXECUTABLE" ? "NOT_EXECUTABLE" : filled === 10 ? "EXECUTABLE" : "PARTIAL",
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
      filled_quantity: filled,
      remaining_quantity: 10 - filled,
      simulated_fills: [],
      status: status === "NOT_EXECUTABLE" ? "NOT_EXECUTABLE" : filled === 10 ? "EXECUTABLE" : "PARTIAL",
      reasons: [],
    },
    capital_context: {
      wallet_cash: 100000,
      committed_escrow: 0,
      inventory: null,
      deployable_capital: 100000,
      source: "EXPLICIT_DEPLOYABLE",
    },
    fee_context: {
      broker_fee_rate: null,
      sales_tax_rate: 0.05,
      source: "EXPLICIT",
    },
    market_evidence: {
      acquisition_snapshot_id: "acq-snapshot",
      disposition_snapshot_id: "disp-snapshot",
      acquisition_order_ids: [100, 101],
      disposition_order_ids: [200],
      acquisition_provenance: publicProvenance,
      disposition_provenance: publicProvenance,
    },
    economic_result: {
      acquisition_cash_outflow: 1000,
      disposition_proceeds: 1150,
      gross_result: 150,
      fees_total: 50,
      logistics_cost: 0,
      simulated_net_result: simulatedReturn === null ? null : simulatedReturn * 1000,
      capital_required: 1000,
      simulated_return: simulatedReturn,
    },
  };
}

function opportunity(
  observedAt = "2026-09-25T10:00:00Z",
  freshnessState: OpportunityObservation["freshness_state"] = "CURRENT",
  fingerprint = "phase4-1",
): OpportunityObservation {
  return {
    opportunity_id: "opp-1",
    observation_id: "obs-1",
    observed_at: observedAt,
    identity: {
      opportunity_id: "opp-1",
      contract_version: "phase-05.1",
      payload: {
        type_id: scenario.type_id,
        requested_quantity: scenario.requested_quantity,
        acquisition_source: "MARKET",
        acquisition_market: scenario.acquisition.source === "MARKET"
          ? {
              execution_mode: scenario.acquisition.market.execution_mode,
              execution_location: scenario.acquisition.market.execution_location,
              limit_price: scenario.acquisition.market.limit_price,
              order_range: scenario.acquisition.market.order_range,
            }
          : null,
        disposition_market: {
          execution_mode: scenario.disposition.market.execution_mode,
          execution_location: scenario.disposition.market.execution_location,
          limit_price: scenario.disposition.market.limit_price,
          order_range: scenario.disposition.market.order_range,
        },
        origin: scenario.origin,
        destination: scenario.destination,
      },
    },
    scenario_snapshot: scenario,
    phase4_contract_version: "phase-04.2",
    phase4_scenario_fingerprint: fingerprint,
    presence: "PRESENT",
    freshness_state: freshnessState,
    phase4_result: analysis(fingerprint),
    market_snapshot_ids: {
      acquisition: "acq-snapshot",
      disposition: "disp-snapshot",
    },
    order_ids: {
      acquisition: [100, 101],
      disposition: [200],
    },
    provenance: [publicProvenance],
    scope: {
      principal_scope: "PUBLIC",
      principal_id: null,
      character_id: null,
      provenance: null,
    },
  };
}

function input(overrides: Partial<ScoringInput> = {}): ScoringInput {
  const opportunityValue = opportunity();
  return {
    opportunity: opportunityValue,
    trade_analysis: opportunityValue.phase4_result,
    prediction: null,
    policy: SCORING_POLICY_V1,
    ...overrides,
  };
}

function policyWith(overrides: Partial<ScoringPolicy>): ScoringPolicy {
  const definition = { ...SCORING_POLICY_V1, ...overrides };
  const withoutFingerprint = Object.fromEntries(
    Object.entries(definition).filter(([key]) => key !== "fingerprint"),
  ) as Omit<ScoringPolicy, "fingerprint">;
  return {
    ...definition,
    fingerprint: fingerprintScoringPolicy(withoutFingerprint),
  };
}

function prediction(
  quality: PredictionResult["quality"],
  probability = 0.8,
): PredictionResult {
  return {
    status: quality === "INSUFFICIENT_DATA" ? "INSUFFICIENT_DATA" : "PREDICTED",
    target_kind: "PRESENCE_AT_HORIZON",
    model_version: "phase-06-baseline.1",
    dataset_id: "dataset-1",
    sample_id: "sample-1",
    feature_observed_at: "2026-09-25T09:55:00Z",
    scope: {
      principal_scope: "PUBLIC",
      principal_id: null,
      character_id: null,
      provenance: null,
    },
    sample_size: quality === "INSUFFICIENT_DATA" ? 0 : 20,
    estimated_probability: quality === "INSUFFICIENT_DATA" ? null : probability,
    quality,
    confidence: "NOT_ASSESSED",
    provenance: [publicProvenance],
  };
}

test("v1 policy is versioned and its fingerprint reconstructs exactly", () => {
  const definition = Object.fromEntries(
    Object.entries(SCORING_POLICY_V1).filter(([key]) => key !== "fingerprint"),
  ) as Omit<ScoringPolicy, "fingerprint">;
  assert.equal(SCORING_POLICY_V1.policy_version, "phase-07-policy.1");
  assert.equal(
    SCORING_POLICY_V1.fingerprint,
    fingerprintScoringPolicy(definition),
  );
});

test("positive economics with complete evidence produces an available score", () => {
  const result = scoreOpportunity(input());
  assert.equal(result.availability, "AVAILABLE");
  assert.equal(result.score !== null, true);
  assert.equal(result.advice.kind, "ACTIONABLE");
  assert.deepEqual(
    result.components.map((component) => component.dimension),
    ["ECONOMICS", "EXECUTABILITY", "DATA_QUALITY", "PREDICTION_SIGNAL"],
  );
});

test("negative and zero simulated return remain non-actionable without fabricating missing data", () => {
  for (const simulatedReturn of [-0.05, 0]) {
    const opportunityValue = opportunity();
    const result = scoreOpportunity({
      ...input(),
      opportunity: {
        ...opportunityValue,
        phase4_result: analysis("phase4-1", simulatedReturn),
      },
      trade_analysis: analysis("phase4-1", simulatedReturn),
    });
    assert.equal(result.availability, "AVAILABLE");
    assert.equal(result.advice.kind, "NO_ACTION");
    assert.equal(
      result.reasons.some((item) => item.code === "ECONOMIC_NON_POSITIVE"),
      true,
    );
  }
});

test("missing simulated economics makes the score unavailable", () => {
  const result = scoreOpportunity({
    ...input(),
    opportunity: opportunity(),
    trade_analysis: analysis("phase4-1", null),
  });
  assert.equal(result.availability, "SCORE_UNAVAILABLE");
  assert.equal(result.score, null);
  assert.equal(result.advice.kind, "INSUFFICIENT_DATA");
  assert.equal(result.advice.blockers.includes("SCORE_UNAVAILABLE"), true);
});

test("stale evidence is a blocking scoring condition in policy v1", () => {
  const result = scoreOpportunity({
    ...input(),
    opportunity: opportunity("2026-09-25T10:00:00Z", "STALE", "phase4-1"),
  });
  assert.equal(result.availability, "SCORE_UNAVAILABLE");
  assert.equal(result.score, null);
  assert.equal(
    result.reasons.some((item) => item.code === "FRESHNESS_STALE" && item.blocking),
    true,
  );
});

test("unknown freshness is not converted to zero", () => {
  const result = scoreOpportunity({
    ...input(),
    opportunity: opportunity("2026-09-25T10:00:00Z", "UNKNOWN", "phase4-1"),
  });
  const dataQuality = result.components.find(
    (component) => component.dimension === "DATA_QUALITY",
  );
  assert.equal(dataQuality?.status, "BLOCKED");
  assert.equal(dataQuality?.normalized_value, null);
  assert.equal(result.score, null);
});

test("partial execution lowers the score and yields WATCH", () => {
  const opportunityValue = opportunity();
  const result = scoreOpportunity({
    ...input(),
    opportunity: {
      ...opportunityValue,
      phase4_result: analysis("phase4-1", 0.1, "PARTIAL", 5),
    },
    trade_analysis: analysis("phase4-1", 0.1, "PARTIAL", 5),
  });
  const execution = result.components.find(
    (component) => component.dimension === "EXECUTABILITY",
  );
  assert.equal(execution?.normalized_value, 0.5);
  assert.equal(result.advice.kind, "WATCH");
  assert.equal(result.availability, "AVAILABLE");
});

test("training-only prediction is explicitly ignored and does not become confidence", () => {
  const result = scoreOpportunity({
    ...input(),
    prediction: prediction("TRAINING_ONLY", 0.95),
  });
  assert.equal(result.prediction.status, "IGNORED");
  assert.equal(result.prediction.estimated_probability, 0.95);
  assert.equal(result.prediction.confidence, "NOT_ASSESSED");
  assert.equal(result.components[3]?.status, "NOT_USED");
  assert.equal(result.advice.kind, "ACTIONABLE_WITH_LIMITATION");
});

test("insufficient prediction data is explicit and optional in policy v1", () => {
  const result = scoreOpportunity({
    ...input(),
    prediction: prediction("INSUFFICIENT_DATA"),
  });
  assert.equal(result.prediction.status, "IGNORED");
  assert.equal(result.components[3]?.status, "NOT_USED");
  assert.equal(
    result.components[3]?.reasons[0]?.code,
    "PREDICTION_INSUFFICIENT_DATA",
  );
  assert.equal(result.availability, "AVAILABLE");
});

test("a measured holdout prediction is used only as a scoring signal", () => {
  const result = scoreOpportunity({
    ...input(),
    prediction: prediction("MEASURED_HOLDOUT", 0.75),
  });
  assert.equal(result.prediction.status, "USED");
  assert.equal(result.prediction.quality, "MEASURED_HOLDOUT");
  assert.equal(result.prediction.confidence, "NOT_ASSESSED");
  assert.equal(result.components[3]?.status, "USED");
  assert.equal(result.components[3]?.normalized_value, 0.75);
  assert.equal(result.components[3]?.contribution, 0.075);
});

test("prediction scope mismatch is isolated from the score when prediction is optional", () => {
  const scopedPrediction = prediction("MEASURED_HOLDOUT", 0.9);
  scopedPrediction.scope = {
    principal_scope: "CHARACTER",
    principal_id: 90000001,
    character_id: 90000001,
    provenance: null,
  };
  const result = scoreOpportunity({
    ...input(),
    prediction: scopedPrediction,
  });
  assert.equal(result.availability, "AVAILABLE");
  assert.equal(result.prediction.status, "INVALID");
  assert.equal(result.components[3]?.status, "NOT_USED");
  assert.equal(result.advice.kind, "ACTIONABLE_WITH_LIMITATION");
});

test("a policy that requires prediction blocks scoring when prediction is absent", () => {
  const policy = policyWith({ prediction_is_optional: false });
  const result = scoreOpportunity({
    ...input(),
    policy,
    prediction: null,
  });
  assert.equal(result.availability, "SCORE_UNAVAILABLE");
  assert.equal(result.score, null);
  assert.equal(result.components[3]?.status, "BLOCKED");
  assert.equal(result.advice.kind, "INSUFFICIENT_DATA");
});

test("input mismatch is a blocking integrity failure", () => {
  const result = scoreOpportunity({
    ...input(),
    trade_analysis: analysis("other-fingerprint", 0.1),
  });
  assert.equal(result.availability, "SCORE_UNAVAILABLE");
  assert.equal(result.score, null);
  assert.equal(
    result.reasons.some((item) => item.code === "INPUT_MISMATCH" && item.blocking),
    true,
  );
});

test("reordered evidence arrays do not change the score or fingerprint", () => {
  const first = scoreOpportunity(input());
  const opportunityValue = opportunity();
  const second = scoreOpportunity({
    ...input(),
    opportunity: {
      ...opportunityValue,
      provenance: [...opportunityValue.provenance].reverse(),
      order_ids: {
        acquisition: [...opportunityValue.order_ids.acquisition].reverse(),
        disposition: [...opportunityValue.order_ids.disposition].reverse(),
      },
    },
    trade_analysis: {
      ...opportunityValue.phase4_result,
      market_evidence: {
        ...opportunityValue.phase4_result.market_evidence,
        acquisition_order_ids: [101, 100],
      },
    },
  });
  assert.equal(second.score, first.score);
  assert.equal(second.fingerprint, first.fingerprint);
});

test("fingerprint is reconstructible from the same input and result", () => {
  const result = scoreOpportunity(input());
  const withoutFingerprint = Object.fromEntries(
    Object.entries(result).filter(([key]) => key !== "fingerprint"),
  ) as Omit<typeof result, "fingerprint">;
  assert.equal(
    reconstructScoringFingerprint(withoutFingerprint, input()),
    result.fingerprint,
  );
});
