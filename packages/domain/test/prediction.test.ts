import assert from "node:assert/strict";
import test from "node:test";
import type {
  OpportunityObservation,
  OpportunityOutcome,
  SourceProvenance,
  TradeAnalysisResult,
  TradeScenario,
} from "@eve-trade/contracts";
import {
  buildPredictionDataset,
  evaluateEmpiricalRateModel,
  predictEmpiricalRate,
  splitPredictionDataset,
  trainEmpiricalRateModel,
} from "../src/prediction.js";

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

function publicProvenance(id: string): SourceProvenance {
  return {
    source_kind: "ESI",
    source_id: id,
    endpoint: "/markets/10000002/orders/",
    principal_scope: "PUBLIC",
  };
}

function characterProvenance(characterId: number): SourceProvenance {
  return {
    source_kind: "ESI",
    source_id: `esi:character/${characterId}/transactions`,
    endpoint: `/characters/${characterId}/wallet/transactions/`,
    principal_scope: "CHARACTER",
    principal_id: characterId,
  };
}

function analysis(
  fingerprint: string,
  net: number | null,
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
      filled_quantity: 10,
      remaining_quantity: 0,
      simulated_fills: [],
      status: "EXECUTABLE",
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
      filled_quantity: 10,
      remaining_quantity: 0,
      simulated_fills: [],
      status: "EXECUTABLE",
      reasons: [],
    },
    projected_disposition: null,
    capital_context: {
      wallet_cash: 10000,
      committed_escrow: 0,
      inventory: null,
      deployable_capital: 10000,
      source: "EXPLICIT_DEPLOYABLE",
    },
    fee_context: {
      broker_fee_rate: null,
      sales_tax_rate: 0.05,
      source: "EXPLICIT",
    },
    market_evidence: {
      acquisition_snapshot_id: `acq-${fingerprint}`,
      disposition_snapshot_id: `disp-${fingerprint}`,
      acquisition_order_ids: [100],
      disposition_order_ids: [200],
      acquisition_provenance: publicProvenance("market-acq"),
      disposition_provenance: publicProvenance("market-disp"),
    },
    economic_result: {
      acquisition_cash_outflow: 1000,
      disposition_proceeds: 1200,
      gross_result: 200,
      fees_total: 60,
      logistics_cost: 0,
      simulated_net_result: net,
      capital_required: 1000,
      simulated_return: net === null ? null : net / 1000,
    },
  };
}

function observation(
  opportunityId: string,
  observationId: string,
  observedAt: string,
  net: number | null,
  presence: OpportunityObservation["presence"] = "PRESENT",
  characterId?: number,
): OpportunityObservation {
  return {
    opportunity_id: opportunityId,
    observation_id: observationId,
    observed_at: observedAt,
    identity: {
      opportunity_id: opportunityId,
      contract_version: "phase-05.1",
      payload: {
        type_id: 34,
        requested_quantity: 10,
        acquisition_source: "MARKET",
        acquisition_market: {
          execution_mode: "TAKER_AGAINST_SELL",
          execution_location: { region_id: 10000002, system_id: 30000142, location_id: 60003760 },
          limit_price: 100,
          order_range: "region",
        },
        disposition_market: {
          execution_mode: "TAKER_AGAINST_BUY",
          execution_location: { region_id: 10000043, system_id: 30002187, location_id: 60008494 },
          limit_price: 120,
          order_range: "region",
        },
        origin: { region_id: 10000002, system_id: 30000142, location_id: 60003760 },
        destination: { region_id: 10000043, system_id: 30002187, location_id: 60008494 },
      },
    },
    scenario_snapshot: scenario,
    phase4_contract_version: "phase-04.2",
    phase4_scenario_fingerprint: `phase4-${observationId}`,
    presence,
    freshness_state: "CURRENT",
    phase4_result: analysis(`phase4-${observationId}`, net),
    market_snapshot_ids: { acquisition: `acq-${observationId}`, disposition: `disp-${observationId}` },
    order_ids: { acquisition: [100], disposition: [200] },
    provenance: [
      publicProvenance("market-acq"),
      publicProvenance("market-disp"),
      ...(characterId === undefined ? [] : [characterProvenance(characterId)]),
    ],
    scope: {
      principal_scope: characterId === undefined ? "PUBLIC" : "CHARACTER",
      principal_id: characterId ?? null,
      character_id: characterId ?? null,
      provenance: characterId === undefined ? null : characterProvenance(characterId),
    },
  };
}

function outcome(
  opportunityId: string,
  outcomeId: string,
  observedAt: string,
  characterId: number,
  status: OpportunityOutcome["status"],
  evidenceCoverage: OpportunityOutcome["evidence_coverage"] = "COMPLETE",
): OpportunityOutcome {
  return {
    opportunity_id: opportunityId,
    outcome_id: outcomeId,
    observed_at: observedAt,
    status,
    evidence_coverage: evidenceCoverage,
    expected_quantity: 10,
    observed_quantity: status === "COMPLETELY_OBSERVED" ? 10 : status === "PARTIALLY_OBSERVED" ? 1 : 0,
    evidence: [
      {
        evidence_id: `evidence-${outcomeId}`,
        kind: "TRANSACTION",
        observed_at: observedAt,
        provenance: characterProvenance(characterId),
      },
    ],
    observed_subresult: null,
  };
}

const datasetConfig = {
  dataset_version: "phase-06-dataset-1",
  prediction_horizon_seconds: 300,
  max_label_lag_seconds: 60,
};

test("prediction dataset is deterministic regardless of input order", () => {
  const first = observation("opp", "o1", "2026-09-25T10:00:00Z", 100);
  const second = observation("opp", "o2", "2026-09-25T10:05:00Z", 110);
  const a = buildPredictionDataset({ observations: [first, second], outcomes: [] }, datasetConfig);
  const b = buildPredictionDataset({ observations: [second, first], outcomes: [] }, datasetConfig);
  assert.deepEqual(a, b);
});

test("features use only observations strictly before the reference timestamp", () => {
  const first = observation("opp", "o1", "2026-09-25T10:00:00Z", 100);
  const second = observation("opp", "o2", "2026-09-25T10:05:00Z", 110);
  const future = observation("opp", "o3", "2026-09-25T10:10:00Z", 999);
  const dataset = buildPredictionDataset({ observations: [future, second, first], outcomes: [] }, datasetConfig);

  assert.equal(dataset.samples[0]?.features.prior_observation_count, 0);
  assert.equal(dataset.samples[0]?.features.previous_presence, null);
  assert.equal(dataset.samples[1]?.features.prior_observation_count, 1);
  assert.equal(dataset.samples[1]?.features.previous_simulated_net_result, 100);
});

test("future presence produces a point-in-time positive label at the horizon", () => {
  const sample = observation("opp", "o1", "2026-09-25T10:00:00Z", 100);
  const label = observation("opp", "o2", "2026-09-25T10:05:30Z", 90, "PRESENT");
  const dataset = buildPredictionDataset({ observations: [sample, label], outcomes: [] }, datasetConfig);
  const target = dataset.samples[0]?.targets.find((item) => item.kind === "PRESENCE_AT_HORIZON");
  assert.equal(target?.state, "POSITIVE");
  assert.equal(target?.value, true);
  assert.equal(target?.target_observed_at, "2026-09-25T10:05:30Z");
});

test("future absence produces a negative label while unavailable evidence stays unknown", () => {
  const sample = observation("opp", "o1", "2026-09-25T10:00:00Z", 100);
  const absent = observation("opp", "o2", "2026-09-25T10:05:00Z", null, "ABSENT");
  const unavailable = observation("opp", "o3", "2026-09-25T10:05:30Z", null, "UNAVAILABLE");
  const negative = buildPredictionDataset({ observations: [sample, absent], outcomes: [] }, datasetConfig);
  const unknown = buildPredictionDataset({ observations: [sample, unavailable], outcomes: [] }, datasetConfig);

  assert.equal(negative.samples[0]?.targets[0]?.state, "NEGATIVE");
  assert.equal(negative.samples[0]?.targets[0]?.value, false);
  assert.equal(unknown.samples[0]?.targets[0]?.state, "UNKNOWN");
  assert.equal(unknown.samples[0]?.targets[0]?.value, null);
});

test("outcome labels require the same explicit scope and never promote partial evidence", () => {
  const sample = observation("opp", "o1", "2026-09-25T10:00:00Z", 100, "PRESENT", 90000001);
  const wrongCharacterOutcome = outcome("opp", "outcome-a", "2026-09-25T10:05:00Z", 90000002, "COMPLETELY_OBSERVED");
  const partialOutcome = outcome("opp", "outcome-b", "2026-09-25T10:05:00Z", 90000001, "PARTIALLY_OBSERVED", "PARTIAL");

  const wrongScopeDataset = buildPredictionDataset({
    observations: [sample],
    outcomes: [wrongCharacterOutcome],
  }, datasetConfig);
  const partialDataset = buildPredictionDataset({
    observations: [sample],
    outcomes: [partialOutcome],
  }, datasetConfig);

  const wrongScopeTarget = wrongScopeDataset.samples[0]?.targets.find(
    (item) => item.kind === "OUTCOME_OBSERVED_AT_HORIZON",
  );
  const partialTarget = partialDataset.samples[0]?.targets.find(
    (item) => item.kind === "OUTCOME_OBSERVED_AT_HORIZON",
  );
  assert.equal(wrongScopeTarget?.state, "UNKNOWN");
  assert.equal(partialTarget?.state, "UNKNOWN");
});

test("complete outcome evidence becomes a positive observation label only for its principal", () => {
  const sample = observation("opp", "o1", "2026-09-25T10:00:00Z", 100, "PRESENT", 90000001);
  const completeOutcome = outcome("opp", "outcome-a", "2026-09-25T10:05:00Z", 90000001, "COMPLETELY_OBSERVED");
  const dataset = buildPredictionDataset({
    observations: [sample],
    outcomes: [completeOutcome],
  }, datasetConfig);

  const target = dataset.samples[0]?.targets.find(
    (item) => item.kind === "OUTCOME_OBSERVED_AT_HORIZON",
  );
  assert.equal(target?.state, "POSITIVE");
  assert.equal(target?.value, true);
});

test("complete outcome can be traced without changing the public opportunity scope", () => {
  const sample = observation("opp", "o1", "2026-09-25T10:00:00Z", 100, "PRESENT", 90000001);
  const dataset = buildPredictionDataset({
    observations: [sample],
    outcomes: [],
  }, datasetConfig);
  const prediction = predictEmpiricalRate(null, "OUTCOME_OBSERVED_AT_HORIZON", dataset.samples[0] ?? null);

  assert.equal(prediction.status, "INSUFFICIENT_DATA");
  assert.equal(prediction.target_kind, "OUTCOME_OBSERVED_AT_HORIZON");
  assert.equal(prediction.sample_id, dataset.samples[0]?.sample_id ?? null);
  assert.equal(prediction.feature_observed_at, "2026-09-25T10:00:00Z");
  assert.equal(prediction.scope?.principal_scope, "CHARACTER");
  assert.equal(prediction.confidence, "NOT_ASSESSED");
  assert.deepEqual(prediction.provenance, sample.provenance);
});

test("temporal split excludes trajectories that cross the evaluation boundary", () => {
  const training = observation("train", "tr1", "2026-09-25T09:00:00Z", 100);
  const trainingLabel = observation("train", "tr2", "2026-09-25T09:05:00Z", 100, "PRESENT");
  const crossing = observation("cross", "cr1", "2026-09-25T09:30:00Z", 100);
  const crossingFuture = observation("cross", "cr2", "2026-09-25T11:05:00Z", 100, "PRESENT");
  const evaluation = observation("eval", "ev1", "2026-09-25T11:00:00Z", 100);
  const evaluationLabel = observation("eval", "ev2", "2026-09-25T11:05:00Z", 100, "PRESENT");

  const dataset = buildPredictionDataset({
    observations: [training, trainingLabel, crossing, crossingFuture, evaluation, evaluationLabel],
    outcomes: [],
  }, datasetConfig);
  const split = splitPredictionDataset(dataset, "2026-09-25T10:00:00Z");

  assert.deepEqual(split.training_samples.map((sample) => sample.opportunity_id), ["train"]);
  assert.deepEqual(split.evaluation_samples.map((sample) => sample.opportunity_id), ["eval"]);
  assert.equal(split.excluded_samples.some((sample) => sample.opportunity_id === "cross"), true);
});

test("temporal split follows the selected outcome target instead of hardcoding persistence", () => {
  const training = observation("train-outcome", "tro1", "2026-09-25T09:00:00Z", 100, "PRESENT", 90000001);
  const evaluation = observation("eval-outcome", "evo1", "2026-09-25T11:00:00Z", 100, "PRESENT", 90000001);
  const dataset = buildPredictionDataset({
    observations: [training, evaluation],
    outcomes: [
      outcome("train-outcome", "tr-outcome", "2026-09-25T09:05:00Z", 90000001, "COMPLETELY_OBSERVED"),
      outcome("eval-outcome", "ev-outcome", "2026-09-25T11:05:00Z", 90000001, "COMPLETELY_OBSERVED"),
    ],
  }, datasetConfig);

  const split = splitPredictionDataset(
    dataset,
    "2026-09-25T10:00:00Z",
    "OUTCOME_OBSERVED_AT_HORIZON",
  );

  assert.deepEqual(
    split.training_samples.map((sample) => sample.opportunity_id),
    ["train-outcome"],
  );
  assert.deepEqual(
    split.evaluation_samples.map((sample) => sample.opportunity_id),
    ["eval-outcome"],
  );
});

test("empirical baseline refuses to train below the explicit minimum", () => {
  const first = observation("train", "tr1", "2026-09-25T08:00:00Z", 100);
  const second = observation("train", "tr2", "2026-09-25T08:05:00Z", 100, "ABSENT");
  const dataset = buildPredictionDataset({ observations: [first, second], outcomes: [] }, datasetConfig);
  const split = splitPredictionDataset(dataset, "2026-09-25T09:00:00Z");
  const training = trainEmpiricalRateModel(dataset, split.training_samples, "PRESENCE_AT_HORIZON", 2);

  assert.equal(training.status, "INSUFFICIENT_DATA");
  assert.equal(training.model, null);
});

test("empirical baseline is deterministic and reports only measured holdout metrics", () => {
  const streamA = [
    observation("train", "tr1", "2026-09-25T08:00:00Z", 100),
    observation("train", "tr2", "2026-09-25T08:05:00Z", 100, "PRESENT"),
  ];
  const streamB = [
    observation("eval", "ev1", "2026-09-25T11:00:00Z", 100),
    observation("eval", "ev2", "2026-09-25T11:05:00Z", 100, "ABSENT"),
  ];
  const dataset = buildPredictionDataset({
    observations: [...streamA, ...streamB],
    outcomes: [],
  }, datasetConfig);
  const split = splitPredictionDataset(dataset, "2026-09-25T10:00:00Z");
  const training = trainEmpiricalRateModel(
    dataset,
    split.training_samples,
    "PRESENCE_AT_HORIZON",
    1,
    "phase-06-test-model.1",
  );

  assert.equal(training.status, "READY");
  assert.ok(training.model);
  assert.equal(training.model?.estimated_positive_rate, 1);
  assert.equal(training.model?.training_sample_count, 1);

  const evaluation = evaluateEmpiricalRateModel(training.model!, split.evaluation_samples);
  assert.equal(evaluation.status, "EVALUATED");
  assert.equal(evaluation.sample_count, 1);
  assert.equal(evaluation.accuracy, 0);
  assert.equal(evaluation.brier_score, 1);
  assert.equal(evaluation.calibration_status, "NOT_ASSESSED");

  assert.equal(training.model?.training_window_start, "2026-09-25T08:00:00Z");
  assert.equal(training.model?.training_window_end, "2026-09-25T08:00:00Z");

  assert.deepEqual(
    predictEmpiricalRate(training.model!, "PRESENCE_AT_HORIZON", split.evaluation_samples[0] ?? null),
    {
      status: "PREDICTED",
      target_kind: "PRESENCE_AT_HORIZON",
      model_version: "phase-06-test-model.1",
      dataset_id: dataset.metadata.dataset_id,
      sample_id: split.evaluation_samples[0]?.sample_id ?? null,
      feature_observed_at: "2026-09-25T11:00:00Z",
      scope: split.evaluation_samples[0]?.scope ?? null,
      sample_size: 1,
      estimated_probability: 1,
      quality: "TRAINING_ONLY",
      confidence: "NOT_ASSESSED",
      provenance: split.evaluation_samples[0]?.provenance ?? [],
    },
  );
});
