import { createHash } from "node:crypto";
import type {
  PredictionResult,
  ScoringAdvice,
  ScoringComponent,
  ScoringEvidenceRef,
  ScoringInput,
  ScoringPolicy,
  ScoringReason,
  ScoringResult,
  SourceProvenance,
  TradeAnalysisResult,
} from "@eve-trade/contracts";
import {
  SCORING_CONTRACT_VERSION,
  SCORING_POLICY_V1_VERSION,
} from "@eve-trade/contracts";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return [...value]
      .map(stableValue)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function reason(
  code: ScoringReason["code"],
  message: string,
  blocking: boolean,
): ScoringReason {
  return { code, message, blocking };
}

const evidenceKey = (value: ScoringEvidenceRef) =>
  [value.kind, value.id, value.field ?? ""].join(":");
const provenanceKey = (value: SourceProvenance) =>
  [
    value.source_kind,
    value.source_id,
    value.endpoint,
    value.principal_scope,
    value.principal_id ?? "none",
  ].join(":");

function uniqueSorted<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return [...values]
    .sort((a, b) => key(a).localeCompare(key(b)))
    .filter((value) => {
      const id = key(value);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

export function fingerprintScoringPolicy(
  definition: Omit<ScoringPolicy, "fingerprint">,
): string {
  return hash({ contract_version: SCORING_CONTRACT_VERSION, policy: definition });
}

function validatePolicy(policy: ScoringPolicy): void {
  const weightTotal = Object.values(policy.weights).reduce((sum, value) => sum + value, 0);
  if (!Object.values(policy.weights).every((value) => Number.isFinite(value) && value >= 0) ||
      Math.abs(weightTotal - 1) > 1e-9) {
    throw new Error("scoring policy weights must be finite, non-negative and sum to 1");
  }
  if (policy.score_min >= policy.score_max || !Number.isFinite(policy.score_min) || !Number.isFinite(policy.score_max)) {
    throw new Error("scoring policy score bounds are invalid");
  }
  if (policy.economic_return_floor >= policy.economic_return_target ||
      !Number.isFinite(policy.economic_return_floor) || !Number.isFinite(policy.economic_return_target)) {
    throw new Error("scoring policy economic return bounds are invalid");
  }
  if (policy.partial_execution_min_fill_ratio < 0 || policy.partial_execution_min_fill_ratio > 1 ||
      !Number.isFinite(policy.partial_execution_min_fill_ratio)) {
    throw new Error("partial execution threshold must be between 0 and 1");
  }
  if (policy.data_quality_partial_score < 0 || policy.data_quality_partial_score > 1 ||
      !Number.isFinite(policy.data_quality_partial_score)) {
    throw new Error("partial data quality score must be between 0 and 1");
  }
  if (policy.contract_version !== SCORING_CONTRACT_VERSION || !policy.policy_version.trim()) {
    throw new Error("unsupported scoring policy version");
  }
  const { fingerprint: _ignored, ...definition } = policy;
  void _ignored;
  if (policy.fingerprint !== fingerprintScoringPolicy(definition)) {
    throw new Error("scoring policy fingerprint does not match its definition");
  }
  if (policy.unknown_freshness !== "BLOCK") {
    throw new Error("unsupported unknown-freshness policy");
  }
  if (!policy.prediction_is_optional && policy.use_prediction_quality === "DISABLED") {
    throw new Error("required prediction cannot use disabled policy");
  }
}

const SCORING_POLICY_V1_DEFINITION: Omit<ScoringPolicy, "fingerprint"> = {
  contract_version: SCORING_CONTRACT_VERSION,
  policy_version: SCORING_POLICY_V1_VERSION,
  score_min: 0,
  score_max: 100,
  economic_return_floor: 0,
  economic_return_target: 0.1,
  partial_execution_min_fill_ratio: 1,
  data_quality_partial_score: 0.5,
  stale_data: "BLOCK",
  unknown_freshness: "BLOCK",
  use_prediction_quality: "MEASURED_HOLDOUT_ONLY",
  prediction_is_optional: true,
  weights: {
    economics: 0.5,
    executability: 0.25,
    data_quality: 0.15,
    prediction_signal: 0.1,
  },
};

export const SCORING_POLICY_V1: ScoringPolicy = {
  ...SCORING_POLICY_V1_DEFINITION,
  fingerprint: fingerprintScoringPolicy(SCORING_POLICY_V1_DEFINITION),
};

function sameScope(
  left: ScoringInput["opportunity"]["scope"],
  right: NonNullable<PredictionResult["scope"]>,
): boolean {
  return left.principal_scope === right.principal_scope &&
    (left.principal_id ?? null) === (right.principal_id ?? null) &&
    (left.character_id ?? null) === (right.character_id ?? null);
}

function evidenceFor(input: ScoringInput): ScoringEvidenceRef[] {
  const evidence: ScoringEvidenceRef[] = [
    { kind: "OPPORTUNITY_OBSERVATION", id: input.opportunity.observation_id, field: "phase4_result" },
  ];
  for (const id of [input.opportunity.market_snapshot_ids.acquisition, input.opportunity.market_snapshot_ids.disposition]) {
    if (id !== null) evidence.push({ kind: "MARKET_SNAPSHOT", id, field: null });
  }
  for (const id of [...input.opportunity.order_ids.acquisition, ...input.opportunity.order_ids.disposition]) {
    evidence.push({ kind: "MARKET_ORDER", id: String(id), field: null });
  }
  return uniqueSorted(evidence, evidenceKey);
}

function sharedInputReasons(input: ScoringInput): ScoringReason[] {
  const reasons: ScoringReason[] = [];
  if (input.trade_analysis.contract_version !== input.opportunity.phase4_contract_version ||
      input.trade_analysis.scenario_fingerprint !== input.opportunity.phase4_scenario_fingerprint ||
      input.opportunity.phase4_result.scenario_fingerprint !== input.trade_analysis.scenario_fingerprint) {
    reasons.push(reason(
      "INPUT_MISMATCH",
      "trade-analysis evidence does not match the opportunity observation",
      true,
    ));
  }
  return reasons;
}

function component(
  dimension: ScoringComponent["dimension"],
  status: ScoringComponent["status"],
  weight: number,
  normalizedValue: number | null,
  reasons: ScoringReason[],
  evidence: ScoringEvidenceRef[],
): ScoringComponent {
  return {
    dimension,
    status,
    weight,
    normalized_value: normalizedValue,
    contribution: normalizedValue === null ? null : normalizedValue * weight,
    reasons,
    evidence,
  };
}

function economicsComponent(
  analysis: TradeAnalysisResult,
  policy: ScoringPolicy,
  evidence: ScoringEvidenceRef[],
): ScoringComponent {
  const value =
    analysis.status === "PROJECTED"
      ? analysis.economic_result.projected_return ?? null
      : analysis.economic_result.simulated_return;
  if (value === null || !Number.isFinite(value)) {
    return component("ECONOMICS", "BLOCKED", policy.weights.economics, null, [
      reason("ECONOMIC_RESULT_MISSING", "simulated return is unavailable", true),
    ], evidence);
  }
  const normalized = clamp(
    (value - policy.economic_return_floor) /
      (policy.economic_return_target - policy.economic_return_floor),
    0,
    1,
  );
  return component(
    "ECONOMICS",
    "USED",
    policy.weights.economics,
    normalized,
    value <= 0 ? [reason("ECONOMIC_NON_POSITIVE", "simulated return is non-positive", false)] : [],
    evidence,
  );
}

function executionRatio(analysis: TradeAnalysisResult): number | null {
  const requested = analysis.acquisition_leg.requested_quantity;
  if (!Number.isInteger(requested) || requested <= 0 ||
      analysis.disposition_leg.requested_quantity !== requested) return null;
  const acquisition = analysis.acquisition_leg.filled_quantity / requested;
  const disposition =
    analysis.status === "PROJECTED"
      ? acquisition
      : analysis.disposition_leg.filled_quantity / requested;
  return Number.isFinite(acquisition) && Number.isFinite(disposition)
    ? clamp(Math.min(acquisition, disposition), 0, 1)
    : null;
}

function executionComponent(
  analysis: TradeAnalysisResult,
  policy: ScoringPolicy,
  evidence: ScoringEvidenceRef[],
): ScoringComponent {
  const ratio = executionRatio(analysis);
  if (ratio === null || analysis.status === "NOT_EXECUTABLE" ||
      analysis.status === "DATA_UNAVAILABLE" || analysis.status === "STALE") {
    return component("EXECUTABILITY", "BLOCKED", policy.weights.executability, null, [
      reason("EXECUTABILITY_UNAVAILABLE", "trade analysis does not provide usable execution evidence", true),
    ], evidence);
  }
  return component(
    "EXECUTABILITY",
    "USED",
    policy.weights.executability,
    ratio,
    ratio < policy.partial_execution_min_fill_ratio
      ? [reason("EXECUTION_PARTIAL", "full requested quantity is not currently executable", false)]
      : [],
    evidence,
  );
}

function dataQualityComponent(
  input: ScoringInput,
  policy: ScoringPolicy,
  evidence: ScoringEvidenceRef[],
): ScoringComponent {
  if (input.opportunity.presence === "ABSENT") {
    return component("DATA_QUALITY", "BLOCKED", policy.weights.data_quality, null, [
      reason("OPPORTUNITY_ABSENT", "opportunity presence is ABSENT; scoring cannot treat absence as favorable evidence", true),
    ], evidence);
  }
  if (input.opportunity.presence === "UNAVAILABLE") {
    return component("DATA_QUALITY", "BLOCKED", policy.weights.data_quality, null, [
      reason("OPPORTUNITY_UNAVAILABLE", "opportunity presence is UNAVAILABLE; scoring evidence is incomplete", true),
    ], evidence);
  }
  if (input.trade_analysis.status === "DATA_UNAVAILABLE") {
    return component("DATA_QUALITY", "BLOCKED", policy.weights.data_quality, null, [
      reason("DATA_UNAVAILABLE", "upstream trade-analysis data is unavailable", true),
    ], evidence);
  }
  if (input.opportunity.freshness_state === "STALE") {
    if (policy.stale_data === "BLOCK") {
      return component("DATA_QUALITY", "BLOCKED", policy.weights.data_quality, null, [
        reason("FRESHNESS_STALE", "opportunity evidence is stale according to policy", true),
      ], evidence);
    }
    return component("DATA_QUALITY", "USED", policy.weights.data_quality, 0, [
      reason("FRESHNESS_STALE", "opportunity evidence is stale and is penalized by policy", false),
    ], evidence);
  }
  if (input.opportunity.freshness_state === "UNKNOWN") {
    return component("DATA_QUALITY", "BLOCKED", policy.weights.data_quality, null, [
      reason("FRESHNESS_UNKNOWN", "opportunity freshness is unknown and policy blocks scoring", true),
    ], evidence);
  }
  const partial = input.trade_analysis.status === "PARTIAL";
  return component(
    "DATA_QUALITY",
    "USED",
    policy.weights.data_quality,
    partial ? policy.data_quality_partial_score : 1,
    partial ? [reason("DATA_PARTIAL", "trade-analysis evidence is partial", false)] : [],
    evidence,
  );
}

function predictionComponent(
  input: ScoringInput,
  policy: ScoringPolicy,
): { component: ScoringComponent; context: ScoringResult["prediction"] } {
  const prediction = input.prediction;
  const weight = policy.weights.prediction_signal;
  if (prediction === null) {
    const blocking = !policy.prediction_is_optional;
    return {
      component: component("PREDICTION_SIGNAL", blocking ? "BLOCKED" : "NOT_USED", weight, null, [
        reason("PREDICTION_NOT_USED", blocking ? "prediction is required by policy" : "no prediction result was supplied", blocking),
      ], []),
      context: {
        status: "ABSENT",
        model_version: null,
        dataset_id: null,
        sample_id: null,
        estimated_probability: null,
        quality: null,
        confidence: null,
      },
    };
  }

  const predictionScopeMismatch = prediction.scope === null
    ? input.opportunity.scope.principal_scope !== "PUBLIC"
    : !sameScope(input.opportunity.scope, prediction.scope);
  if (predictionScopeMismatch) {
    const blocking = !policy.prediction_is_optional;
    return {
      component: component("PREDICTION_SIGNAL", blocking ? "BLOCKED" : "NOT_USED", weight, null, [
        reason("PREDICTION_SCOPE_MISMATCH", "prediction scope does not match opportunity scope", blocking),
      ], []),
      context: {
        status: "INVALID",
        model_version: prediction.model_version,
        dataset_id: prediction.dataset_id,
        sample_id: prediction.sample_id,
        estimated_probability: prediction.estimated_probability,
        quality: prediction.quality,
        confidence: prediction.confidence,
      },
    };
  }

  const usable = policy.use_prediction_quality === "MEASURED_HOLDOUT_ONLY" &&
    prediction.status === "PREDICTED" &&
    prediction.quality === "MEASURED_HOLDOUT" &&
    prediction.estimated_probability !== null &&
    Number.isFinite(prediction.estimated_probability) &&
    prediction.estimated_probability >= 0 && prediction.estimated_probability <= 1;

  if (usable) {
    const evidence = [
      ...(prediction.dataset_id === null ? [] : [{ kind: "PREDICTION_DATASET" as const, id: prediction.dataset_id, field: null }]),
      ...(prediction.sample_id === null ? [] : [{ kind: "PREDICTION_SAMPLE" as const, id: prediction.sample_id, field: null }]),
    ];
    return {
      component: component("PREDICTION_SIGNAL", "USED", weight, prediction.estimated_probability, [
        reason("PREDICTION_USED", "measured holdout prediction is used as an explicit signal", false),
      ], evidence),
      context: {
        status: "USED",
        model_version: prediction.model_version,
        dataset_id: prediction.dataset_id,
        sample_id: prediction.sample_id,
        estimated_probability: prediction.estimated_probability,
        quality: prediction.quality,
        confidence: prediction.confidence,
      },
    };
  }

  const blocking = !policy.prediction_is_optional;
  const insufficient = prediction.status === "INSUFFICIENT_DATA" || prediction.quality === "INSUFFICIENT_DATA";
  return {
    component: component("PREDICTION_SIGNAL", blocking ? "BLOCKED" : "NOT_USED", weight, null, [
      reason(
        insufficient ? "PREDICTION_INSUFFICIENT_DATA" : "PREDICTION_NOT_MEASURED",
        insufficient ? "prediction data is insufficient" : "prediction quality is not eligible for scoring",
        blocking,
      ),
    ], []),
    context: {
      status: "IGNORED",
      model_version: prediction.model_version,
      dataset_id: prediction.dataset_id,
      sample_id: prediction.sample_id,
      estimated_probability: prediction.estimated_probability,
      quality: prediction.quality,
      confidence: prediction.confidence,
    },
  };
}

function computeScore(
  components: ScoringComponent[],
  policy: ScoringPolicy,
): number | null {
  const mandatoryBlocked = components.some((item) =>
    item.weight > 0 && (item.dimension !== "PREDICTION_SIGNAL" || !policy.prediction_is_optional) &&
    (item.status === "BLOCKED" || item.status === "UNAVAILABLE" || item.contribution === null),
  );
  if (mandatoryBlocked) return null;
  const used = components.filter((item) => item.status === "USED" && item.contribution !== null && item.weight > 0);
  const totalWeight = used.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return null;
  const normalized = used.reduce((sum, item) => sum + (item.contribution ?? 0), 0) / totalWeight;
  return clamp(Math.round((policy.score_min + normalized * (policy.score_max - policy.score_min)) * 100) / 100, policy.score_min, policy.score_max);
}

function adviceFor(
  input: ScoringInput,
  score: number | null,
  availability: ScoringResult["availability"],
  components: ScoringComponent[],
  prediction: ScoringResult["prediction"],
  reasons: ScoringReason[],
): ScoringAdvice {
  const blockers: ScoringReason["code"][] = [...new Set(reasons.filter((item) => item.blocking).map((item) => item.code))];
  if (availability === "SCORE_UNAVAILABLE") {
    return {
      kind: "INSUFFICIENT_DATA",
      evidence_level: "INSUFFICIENT",
      reasons: [...reasons, reason("SCORE_UNAVAILABLE", "score cannot be reconstructed from sufficient evidence", true)],
      blockers: [...new Set<ScoringReason["code"]>([...blockers, "SCORE_UNAVAILABLE"])],
      limitations: [],
    };
  }

  const economicReturn =
    input.trade_analysis.status === "PROJECTED"
      ? input.trade_analysis.economic_result.projected_return ?? null
      : input.trade_analysis.economic_result.simulated_return;
  if (economicReturn === null || economicReturn <= 0) {
    return {
      kind: "NO_ACTION",
      evidence_level: "DIRECT",
      reasons: [...reasons, reason("ECONOMIC_NON_POSITIVE", "simulated economics do not justify an action signal", false)],
      blockers,
      limitations: [],
    };
  }
  const partial = input.trade_analysis.status === "PARTIAL" ||
    components.some((item) => item.dimension === "EXECUTABILITY" && item.reasons.some((itemReason) => itemReason.code === "EXECUTION_PARTIAL"));
  if (partial) {
    return {
      kind: "WATCH",
      evidence_level: "LIMITED",
      reasons: [...reasons, reason("EXECUTION_PARTIAL", "positive economics are not backed by full requested-quantity execution", false)],
      blockers,
      limitations: ["full requested quantity is not currently executable"],
    };
  }
  if (input.trade_analysis.status === "PROJECTED") {
    return {
      kind: "ACTIONABLE_WITH_LIMITATION",
      evidence_level: "LIMITED",
      reasons: [
        ...reasons,
        reason(
          "DISPOSITION_PROJECTED",
          "maker sell disposition is projected and has no fill evidence",
          false,
        ),
      ],
      blockers,
      limitations: ["maker sell disposition is projected; execution remains unobserved"],
    };
  }
  if (prediction.status === "ABSENT" || prediction.status === "IGNORED" || prediction.status === "INVALID") {
    return {
      kind: "ACTIONABLE_WITH_LIMITATION",
      evidence_level: "LIMITED",
      reasons: [...reasons, reason(
        prediction.status === "INVALID" ? "PREDICTION_SCOPE_MISMATCH" : "PREDICTION_NOT_USED",
        prediction.status === "ABSENT"
          ? "prediction signal is absent and is therefore not included in the score"
          : "prediction signal is excluded from the score by policy or scope",
        false,
      )],
      blockers,
      limitations: [
        prediction.status === "ABSENT"
          ? "prediction signal is absent"
          : "prediction signal is not included in the score",
      ],
    };
  }
  return {
    kind: "ACTIONABLE",
    evidence_level: "DIRECT",
    reasons: [...reasons, reason("SCORE_AVAILABLE", `positive simulated economics and usable evidence support an actionable state; score=${score}`, false)],
    blockers,
    limitations: [],
  };
}

export function scoreOpportunity(input: ScoringInput): ScoringResult {
  validatePolicy(input.policy);
  const evidence = evidenceFor(input);
  const economics = economicsComponent(input.trade_analysis, input.policy, evidence);
  const execution = executionComponent(input.trade_analysis, input.policy, evidence);
  const dataQuality = dataQualityComponent(input, input.policy, evidence);
  const prediction = predictionComponent(input, input.policy);
  const components = [economics, execution, dataQuality, prediction.component];
  const reasons = uniqueSorted(
    [...sharedInputReasons(input), ...components.flatMap((item) => item.reasons)],
    (item) => `${item.code}:${item.message}:${item.blocking}`,
  );
  const score = sharedInputReasons(input).some((item) => item.blocking) ? null : computeScore(components, input.policy);
  const availability: ScoringResult["availability"] = score === null ? "SCORE_UNAVAILABLE" : "AVAILABLE";
  const allEvidence = uniqueSorted(
    [...evidence, ...components.flatMap((item) => item.evidence)],
    evidenceKey,
  );
  const provenance = uniqueSorted(
    [
      ...input.opportunity.provenance,
      ...(input.trade_analysis.market_evidence.acquisition_provenance ? [input.trade_analysis.market_evidence.acquisition_provenance] : []),
      ...(input.trade_analysis.market_evidence.disposition_provenance ? [input.trade_analysis.market_evidence.disposition_provenance] : []),
      ...(input.prediction?.provenance ?? []),
    ],
    provenanceKey,
  );

  const resultWithoutFingerprint: Omit<ScoringResult, "fingerprint"> = {
    contract_version: SCORING_CONTRACT_VERSION,
    policy_version: input.policy.policy_version,
    policy_fingerprint: input.policy.fingerprint,
    opportunity_id: input.opportunity.opportunity_id,
    observation_id: input.opportunity.observation_id,
    observed_at: input.opportunity.observed_at,
    scope: input.opportunity.scope,
    trade_analysis_status: input.trade_analysis.status,
    freshness_state: input.opportunity.freshness_state,
    presence: input.opportunity.presence,
    availability,
    score,
    components,
    reasons,
    prediction: prediction.context,
    advice: adviceFor(input, score, availability, components, prediction.context, reasons),
    provenance,
    evidence: allEvidence,
  };

  return { ...resultWithoutFingerprint, fingerprint: reconstructScoringFingerprint(resultWithoutFingerprint, input) };
}

export function reconstructScoringFingerprint(
  result: Omit<ScoringResult, "fingerprint">,
  input: ScoringInput,
): string {
  return hash({
    contract_version: SCORING_CONTRACT_VERSION,
    policy_fingerprint: input.policy.fingerprint,
    input: {
      opportunity: input.opportunity,
      trade_analysis: input.trade_analysis,
      prediction: input.prediction,
    },
    result,
  });
}
