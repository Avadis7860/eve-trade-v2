import { createHash } from "node:crypto";
import type {
  OpportunityObservation,
  OpportunityOutcome,
  OpportunityOutcomeEvidence,
  OpportunityObservationScope,
  PredictionDataset,
  PredictionDatasetConfig,
  PredictionDatasetSample,
  PredictionEvaluation,
  PredictionFeatureSet,
  PredictionLabelState,
  PredictionModel,
  PredictionResult,
  PredictionSourceData,
  PredictionTargetKind,
  PredictionTemporalSplit,
  PredictionTrainingResult,
} from "@eve-trade/contracts";
import {
  PREDICTION_BASELINE_MODEL_VERSION,
  PREDICTION_CONTRACT_VERSION,
} from "@eve-trade/contracts";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)), "utf8")
    .digest("hex");
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid timestamp`);
  }
  return parsed;
}

function streamKey(scope: OpportunityObservationScope, opportunityId: string): string {
  return [
    opportunityId,
    scope.principal_scope,
    scope.principal_id ?? "none",
  ].join(":");
}

function sortObservations(
  observations: OpportunityObservation[],
): OpportunityObservation[] {
  return [...observations].sort((a, b) =>
    timestamp(a.observed_at, "observed_at") -
      timestamp(b.observed_at, "observed_at") ||
    a.observation_id.localeCompare(b.observation_id),
  );
}

function sameScope(
  left: OpportunityObservationScope,
  right: OpportunityObservationScope,
): boolean {
  return (
    left.principal_scope === right.principal_scope &&
    (left.principal_id ?? null) === (right.principal_id ?? null)
  );
}

function fulfilledQuantity(observation: OpportunityObservation): number | null {
  const acquisition = observation.phase4_result.acquisition_leg.filled_quantity;
  const disposition = observation.phase4_result.disposition_leg.filled_quantity;
  if (!Number.isFinite(acquisition) || !Number.isFinite(disposition)) return null;
  return Math.min(acquisition, disposition);
}

function featureSet(
  current: OpportunityObservation,
  previous: OpportunityObservation | null,
): PredictionFeatureSet {
  const fulfilled = fulfilledQuantity(current);
  const requested = current.identity.payload.requested_quantity;
  const fillRatio =
    fulfilled === null || requested <= 0 ? null : fulfilled / requested;

  return {
    presence: current.presence,
    freshness_state: current.freshness_state,
    requested_quantity: requested,
    fulfilled_quantity: fulfilled,
    fill_ratio: fillRatio,
    simulated_net_result:
      current.phase4_result.economic_result.simulated_net_result,
    simulated_return: current.phase4_result.economic_result.simulated_return,
    prior_observation_count: previous === null ? 0 : 1,
    seconds_since_previous_observation:
      previous === null
        ? null
        : (timestamp(current.observed_at, "observed_at") -
            timestamp(previous.observed_at, "observed_at")) /
          1000,
    previous_presence: previous?.presence ?? null,
    previous_simulated_net_result:
      previous?.phase4_result.economic_result.simulated_net_result ?? null,
  };
}

function matchingOutcome(
  outcomes: OpportunityOutcome[],
  sample: OpportunityObservation,
  targetAt: number,
  maxLabelLagSeconds: number,
): OpportunityOutcome | null {
  const targetEnd = targetAt + maxLabelLagSeconds * 1000;
  return (
    [...outcomes]
      .filter((outcome) => {
        const observedAt = timestamp(outcome.observed_at, "outcome.observed_at");
        return (
          observedAt >= targetAt &&
          observedAt <= targetEnd &&
          outcomeMatchesScope(outcome.evidence, sample.scope)
        );
      })
      .sort(
        (a, b) =>
          timestamp(a.observed_at, "outcome.observed_at") -
            timestamp(b.observed_at, "outcome.observed_at") ||
          a.outcome_id.localeCompare(b.outcome_id),
      )[0] ?? null
  );
}

function outcomeMatchesScope(
  evidence: OpportunityOutcomeEvidence[],
  scope: OpportunityObservationScope,
): boolean {
  if (evidence.length === 0) return false;
  return evidence.every((item) => {
    const provenance = item.provenance;
    return (
      provenance.principal_scope === scope.principal_scope &&
      (provenance.principal_id ?? null) === (scope.principal_id ?? null)
    );
  });
}

function outcomeLabel(
  outcome: OpportunityOutcome | null,
): PredictionLabelState {
  if (outcome === null) return "UNKNOWN";
  if (outcome.status === "COMPLETELY_OBSERVED") return "POSITIVE";
  if (
    outcome.status === "NO_EVIDENCE" &&
    outcome.evidence_coverage === "COMPLETE"
  ) {
    return "NEGATIVE";
  }
  return "UNKNOWN";
}

function persistenceLabel(
  observations: OpportunityObservation[],
  current: OpportunityObservation,
  targetAt: number,
  maxLabelLagSeconds: number,
): { state: PredictionLabelState; observedAt: string | null; sourceId: string | null } {
  const targetEnd = targetAt + maxLabelLagSeconds * 1000;
  const candidate = observations
    .filter((observation) => {
      const observedAt = timestamp(observation.observed_at, "observed_at");
      return (
        observedAt >= targetAt &&
        observedAt <= targetEnd &&
        observation.observation_id !== current.observation_id &&
        sameScope(observation.scope, current.scope)
      );
    })
    .sort(
      (a, b) =>
        timestamp(a.observed_at, "observed_at") -
          timestamp(b.observed_at, "observed_at") ||
        a.observation_id.localeCompare(b.observation_id),
    )
    .find((observation) => observation.presence !== "UNAVAILABLE");

  if (candidate === undefined) {
    return { state: "UNKNOWN", observedAt: null, sourceId: null };
  }

  return {
    state:
      candidate.presence === "PRESENT" ? "POSITIVE" : "NEGATIVE",
    observedAt: candidate.observed_at,
    sourceId: candidate.observation_id,
  };
}

function validateScope(scope: OpportunityObservationScope): boolean {
  if (scope.principal_scope === "PUBLIC") {
    return scope.principal_id === null && scope.character_id === null;
  }
  return scope.principal_id !== null;
}

function labelIsKnown(label: PredictionDatasetSample["targets"][number]): boolean {
  return label.state !== "UNKNOWN" && label.value !== null;
}

export function buildPredictionDataset(
  source: PredictionSourceData,
  config: PredictionDatasetConfig,
): PredictionDataset {
  if (!config.dataset_version.trim()) {
    throw new Error("dataset_version must not be empty");
  }
  if (
    !Number.isInteger(config.prediction_horizon_seconds) ||
    config.prediction_horizon_seconds <= 0
  ) {
    throw new Error("prediction_horizon_seconds must be a positive integer");
  }
  if (
    !Number.isInteger(config.max_label_lag_seconds) ||
    config.max_label_lag_seconds < 0
  ) {
    throw new Error("max_label_lag_seconds must be a non-negative integer");
  }

  const grouped = new Map<string, OpportunityObservation[]>();
  let rejectedSampleCount = 0;

  for (const observation of source.observations) {
    timestamp(observation.observed_at, "observed_at");
    if (!validateScope(observation.scope)) {
      rejectedSampleCount += 1;
      continue;
    }
    const key = streamKey(observation.scope, observation.opportunity_id);
    const current = grouped.get(key);
    if (current) current.push(observation);
    else grouped.set(key, [observation]);
  }

  const samples: PredictionDatasetSample[] = [];

  for (const observations of grouped.values()) {
    const ordered = sortObservations(observations);

    for (const observation of ordered) {
      const currentAt = timestamp(observation.observed_at, "observed_at");
      const prior = [...ordered]
        .filter(
          (candidate) =>
            timestamp(candidate.observed_at, "observed_at") < currentAt,
        )
        .at(-1) ?? null;

      const persistence = persistenceLabel(
        ordered,
        observation,
        currentAt + config.prediction_horizon_seconds * 1000,
        config.max_label_lag_seconds,
      );

      const outcome = matchingOutcome(
        source.outcomes.filter(
          (candidate) => candidate.opportunity_id === observation.opportunity_id,
        ),
        observation,
        currentAt + config.prediction_horizon_seconds * 1000,
        config.max_label_lag_seconds,
      );

      const outcomeState = outcomeLabel(outcome);
      const outcomeTarget: PredictionDatasetSample["targets"][number] = {
        kind: "OUTCOME_OBSERVED_AT_HORIZON",
        state: outcomeState,
        value:
          outcomeState === "POSITIVE"
            ? true
            : outcomeState === "NEGATIVE"
              ? false
              : null,
        target_observed_at: outcome?.observed_at ?? null,
        source_id: outcome?.outcome_id ?? null,
      };

      const sampleId = hash({
        contract_version: PREDICTION_CONTRACT_VERSION,
        dataset_version: config.dataset_version,
        opportunity_id: observation.opportunity_id,
        observation_id: observation.observation_id,
        feature_observed_at: observation.observed_at,
        prediction_horizon_seconds: config.prediction_horizon_seconds,
        max_label_lag_seconds: config.max_label_lag_seconds,
        scope: observation.scope,
      });

      const sample: PredictionDatasetSample = {
        sample_id: sampleId,
        contract_version: PREDICTION_CONTRACT_VERSION,
        dataset_version: config.dataset_version,
        opportunity_id: observation.opportunity_id,
        observation_id: observation.observation_id,
        feature_observed_at: observation.observed_at,
        label_observed_at:
          [persistence.observedAt, outcome?.observed_at]
            .filter((value): value is string => value !== null)
            .sort()[0] ?? null,
        prediction_horizon_seconds: config.prediction_horizon_seconds,
        scope: observation.scope,
        features: {
          ...featureSet(observation, prior),
          prior_observation_count: ordered.filter(
            (candidate) =>
              timestamp(candidate.observed_at, "observed_at") < currentAt,
          ).length,
        },
        targets: [
          {
            kind: "PRESENCE_AT_HORIZON",
            state: persistence.state,
            value:
              persistence.state === "POSITIVE"
                ? true
                : persistence.state === "NEGATIVE"
                  ? false
                  : null,
            target_observed_at: persistence.observedAt,
            source_id: persistence.sourceId,
          },
          outcomeTarget,
        ],
        provenance: observation.provenance,
      };

      samples.push(sample);
    }
  }

  samples.sort(
    (a, b) =>
      a.feature_observed_at.localeCompare(b.feature_observed_at) ||
      a.scope.principal_scope.localeCompare(b.scope.principal_scope) ||
      String(a.scope.principal_id ?? "").localeCompare(
        String(b.scope.principal_id ?? ""),
      ) ||
      a.sample_id.localeCompare(b.sample_id),
  );

  const labeledSampleCount = samples.filter((sample) =>
    sample.targets.some(labelIsKnown),
  ).length;

  const featureWindowStart = samples[0]?.feature_observed_at ?? null;
  const featureWindowEnd = samples.at(-1)?.feature_observed_at ?? null;

  const datasetId = hash({
    contract_version: PREDICTION_CONTRACT_VERSION,
    config,
    samples,
  });

  return {
    metadata: {
      dataset_id: datasetId,
      dataset_version: config.dataset_version,
      contract_version: PREDICTION_CONTRACT_VERSION,
      feature_window_start: featureWindowStart,
      feature_window_end: featureWindowEnd,
      prediction_horizon_seconds: config.prediction_horizon_seconds,
      max_label_lag_seconds: config.max_label_lag_seconds,
      input_observation_count: source.observations.length,
      input_outcome_count: source.outcomes.length,
      sample_count: samples.length,
      labeled_sample_count: labeledSampleCount,
      rejected_sample_count: rejectedSampleCount,
    },
    samples,
  };
}

function targetFor(
  sample: PredictionDatasetSample,
  targetKind: PredictionTargetKind,
): PredictionDatasetSample["targets"][number] {
  const target = sample.targets.find((candidate) => candidate.kind === targetKind);
  if (!target) throw new Error(`Missing target ${targetKind}`);
  return target;
}

export function splitPredictionDataset(
  dataset: PredictionDataset,
  evaluationStart: string,
  targetKind: PredictionTargetKind = "PRESENCE_AT_HORIZON",
): PredictionTemporalSplit {
  const evaluationAt = timestamp(evaluationStart, "evaluation_start");
  const byStream = new Map<string, PredictionDatasetSample[]>();

  for (const sample of dataset.samples) {
    const key = streamKey(sample.scope, sample.opportunity_id);
    const stream = byStream.get(key);
    if (stream) stream.push(sample);
    else byStream.set(key, [sample]);
  }

  const trainingSamples: PredictionDatasetSample[] = [];
  const evaluationSamples: PredictionDatasetSample[] = [];
  const excludedSamples: PredictionDatasetSample[] = [];

  for (const stream of byStream.values()) {
    const hasBefore = stream.some(
      (sample) => timestamp(sample.feature_observed_at, "feature_observed_at") < evaluationAt,
    );
    const hasAfter = stream.some(
      (sample) => timestamp(sample.feature_observed_at, "feature_observed_at") >= evaluationAt,
    );

    for (const sample of stream) {
      const featureAt = timestamp(sample.feature_observed_at, "feature_observed_at");
      const target = targetFor(sample, targetKind);
      const labelAt = target.target_observed_at
        ? timestamp(target.target_observed_at, "target_observed_at")
        : null;
      const eligible = target.state !== "UNKNOWN" && labelAt !== null;

      if (hasBefore && hasAfter) {
        excludedSamples.push(sample);
      } else if (
        featureAt < evaluationAt &&
        eligible &&
        labelAt < evaluationAt
      ) {
        trainingSamples.push(sample);
      } else if (
        featureAt >= evaluationAt &&
        eligible &&
        labelAt >= evaluationAt
      ) {
        evaluationSamples.push(sample);
      } else {
        excludedSamples.push(sample);
      }
    }
  }

  return {
    evaluation_start: evaluationStart,
    training_samples: trainingSamples.sort(
      (a, b) =>
        a.feature_observed_at.localeCompare(b.feature_observed_at) ||
        a.sample_id.localeCompare(b.sample_id),
    ),
    evaluation_samples: evaluationSamples.sort(
      (a, b) =>
        a.feature_observed_at.localeCompare(b.feature_observed_at) ||
        a.sample_id.localeCompare(b.sample_id),
    ),
    excluded_samples: excludedSamples.sort(
      (a, b) =>
        a.feature_observed_at.localeCompare(b.feature_observed_at) ||
        a.sample_id.localeCompare(b.sample_id),
    ),
  };
}

export function trainEmpiricalRateModel(
  dataset: PredictionDataset,
  trainingSamples: PredictionDatasetSample[],
  targetKind: PredictionTargetKind,
  minimumSampleCount = 10,
  modelVersion = PREDICTION_BASELINE_MODEL_VERSION,
): PredictionTrainingResult {
  if (!Number.isInteger(minimumSampleCount) || minimumSampleCount <= 0) {
    throw new Error("minimumSampleCount must be a positive integer");
  }

  const labels = trainingSamples
    .map((sample) => targetFor(sample, targetKind))
    .filter((label) => label.state !== "UNKNOWN" && label.value !== null);

  if (labels.length < minimumSampleCount) {
    return {
      status: "INSUFFICIENT_DATA",
      model: null,
      target_kind: targetKind,
      sample_count: labels.length,
      reason: `minimum sample count not reached: ${labels.length} < ${minimumSampleCount}`,
    };
  }

  const positiveCount = labels.filter((label) => label.value === true).length;
  const negativeCount = labels.length - positiveCount;
  const model: PredictionModel = {
    contract_version: PREDICTION_CONTRACT_VERSION,
    model_version: modelVersion,
    target_kind: targetKind,
    dataset_id: dataset.metadata.dataset_id,
    training_sample_count: labels.length,
    positive_sample_count: positiveCount,
    negative_sample_count: negativeCount,
    estimated_positive_rate: positiveCount / labels.length,
    fingerprint: hash({
      contract_version: PREDICTION_CONTRACT_VERSION,
      model_version: modelVersion,
      target_kind: targetKind,
      dataset_id: dataset.metadata.dataset_id,
      training_samples: trainingSamples
        .filter((sample) => {
          const label = targetFor(sample, targetKind);
          return label.state !== "UNKNOWN" && label.value !== null;
        })
        .map((sample) => ({
          sample_id: sample.sample_id,
          value: targetFor(sample, targetKind).value,
        })),
    }),
  };

  return {
    status: "READY",
    model,
    target_kind: targetKind,
    sample_count: labels.length,
    reason: null,
  };
}

export function predictEmpiricalRate(
  model: PredictionModel | null,
  targetKind: PredictionTargetKind = "PRESENCE_AT_HORIZON",
): PredictionResult {
  if (model === null) {
    return {
      status: "INSUFFICIENT_DATA",
      target_kind: targetKind,
      model_version: null,
      dataset_id: null,
      sample_size: 0,
      estimated_probability: null,
    };
  }

  return {
    status: "PREDICTED",
    target_kind: model.target_kind,
    model_version: model.model_version,
    dataset_id: model.dataset_id,
    sample_size: model.training_sample_count,
    estimated_probability: model.estimated_positive_rate,
  };
}

export function evaluateEmpiricalRateModel(
  model: PredictionModel,
  evaluationSamples: PredictionDatasetSample[],
): PredictionEvaluation {
  const labels = evaluationSamples
    .map((sample) => targetFor(sample, model.target_kind))
    .filter((label) => label.state !== "UNKNOWN" && label.value !== null);

  if (labels.length === 0) {
    return {
      status: "INSUFFICIENT_DATA",
      target_kind: model.target_kind,
      model_version: model.model_version,
      dataset_id: model.dataset_id,
      sample_count: 0,
      positive_count: 0,
      negative_count: 0,
      accuracy: null,
      brier_score: null,
      calibration_status: "NOT_ASSESSED",
    };
  }

  const probability = model.estimated_positive_rate;
  const threshold = probability >= 0.5;
  const positiveCount = labels.filter((label) => label.value === true).length;
  const negativeCount = labels.length - positiveCount;
  const correct = labels.filter((label) => label.value === threshold).length;
  const accuracy = correct / labels.length;
  const brierScore =
    labels.reduce((sum, label) => {
      const actual = label.value ? 1 : 0;
      return sum + (probability - actual) ** 2;
    }, 0) / labels.length;

  return {
    status: "EVALUATED",
    target_kind: model.target_kind,
    model_version: model.model_version,
    dataset_id: model.dataset_id,
    sample_count: labels.length,
    positive_count: positiveCount,
    negative_count: negativeCount,
    accuracy,
    brier_score: brierScore,
    calibration_status: "NOT_ASSESSED",
  };
}
