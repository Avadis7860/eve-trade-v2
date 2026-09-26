import type {
  OpportunityObservation,
  OpportunityObservationScope,
  OpportunityPresence,
  OpportunityFreshnessState,
} from "./opportunity-tracking.js";
import type {
  PredictionConfidenceStatus,
  PredictionQualityStatus,
  PredictionResult,
} from "./prediction.js";
import type { SourceProvenance } from "./market.js";
import type {
  TradeAnalysisResult,
  TradeAnalysisStatus,
} from "./trade-analysis.js";

export const SCORING_CONTRACT_VERSION = "phase-07.1";
export const SCORING_POLICY_V1_VERSION = "phase-07-policy.1";

export type ScoringDimensionKey =
  | "ECONOMICS"
  | "EXECUTABILITY"
  | "DATA_QUALITY"
  | "PREDICTION_SIGNAL";

export type ScoringComponentStatus =
  | "USED"
  | "NOT_USED"
  | "UNAVAILABLE"
  | "BLOCKED";

export type ScoringAvailability = "AVAILABLE" | "SCORE_UNAVAILABLE";

export type ScoringAdviceKind =
  | "ACTIONABLE"
  | "ACTIONABLE_WITH_LIMITATION"
  | "WATCH"
  | "NO_ACTION"
  | "INSUFFICIENT_DATA";

export type ScoringEvidenceLevel =
  | "DIRECT"
  | "LIMITED"
  | "INSUFFICIENT";

export type ScoringReasonCode =
  | "INPUT_MISMATCH"
  | "ECONOMIC_RESULT_MISSING"
  | "ECONOMIC_NON_POSITIVE"
  | "EXECUTABILITY_UNAVAILABLE"
  | "EXECUTION_PARTIAL"
  | "DATA_UNAVAILABLE"
  | "DATA_PARTIAL"
  | "OPPORTUNITY_ABSENT"
  | "OPPORTUNITY_UNAVAILABLE"
  | "FRESHNESS_STALE"
  | "FRESHNESS_UNKNOWN"
  | "PREDICTION_NOT_USED"
  | "PREDICTION_NOT_MEASURED"
  | "PREDICTION_INSUFFICIENT_DATA"
  | "PREDICTION_SCOPE_MISMATCH"
  | "PREDICTION_USED"
  | "SCORE_AVAILABLE"
  | "SCORE_UNAVAILABLE"
  | "DISPOSITION_PROJECTED";

export interface ScoringReason {
  code: ScoringReasonCode;
  message: string;
  blocking: boolean;
}

export type ScoringEvidenceKind =
  | "OPPORTUNITY_OBSERVATION"
  | "MARKET_SNAPSHOT"
  | "MARKET_ORDER"
  | "PREDICTION_DATASET"
  | "PREDICTION_SAMPLE";

export interface ScoringEvidenceRef {
  kind: ScoringEvidenceKind;
  id: string;
  field: string | null;
}

export interface ScoringDimensionPolicy {
  economics: number;
  executability: number;
  data_quality: number;
  prediction_signal: number;
}

export interface ScoringPolicyDefinition {
  contract_version: typeof SCORING_CONTRACT_VERSION;
  policy_version: string;
  score_min: number;
  score_max: number;
  economic_return_floor: number;
  economic_return_target: number;
  partial_execution_min_fill_ratio: number;
  data_quality_partial_score: number;
  stale_data: "BLOCK" | "PENALIZE";
  unknown_freshness: "BLOCK";
  use_prediction_quality: "MEASURED_HOLDOUT_ONLY" | "DISABLED";
  prediction_is_optional: boolean;
  weights: ScoringDimensionPolicy;
}

export interface ScoringPolicy extends ScoringPolicyDefinition {
  fingerprint: string;
}

export interface ScoringComponent {
  dimension: ScoringDimensionKey;
  status: ScoringComponentStatus;
  weight: number;
  normalized_value: number | null;
  contribution: number | null;
  reasons: ScoringReason[];
  evidence: ScoringEvidenceRef[];
}

export interface ScoringPredictionContext {
  status: "USED" | "IGNORED" | "ABSENT" | "INVALID";
  model_version: string | null;
  dataset_id: string | null;
  sample_id: string | null;
  estimated_probability: number | null;
  quality: PredictionQualityStatus | null;
  confidence: PredictionConfidenceStatus | null;
}

export interface ScoringAdvice {
  kind: ScoringAdviceKind;
  evidence_level: ScoringEvidenceLevel;
  reasons: ScoringReason[];
  blockers: ScoringReasonCode[];
  limitations: string[];
}

export interface ScoringInput {
  opportunity: OpportunityObservation;
  trade_analysis: TradeAnalysisResult;
  prediction: PredictionResult | null;
  policy: ScoringPolicy;
}

export interface ScoringResult {
  contract_version: typeof SCORING_CONTRACT_VERSION;
  policy_version: string;
  policy_fingerprint: string;
  opportunity_id: string;
  observation_id: string;
  observed_at: string;
  scope: OpportunityObservationScope;
  trade_analysis_status: TradeAnalysisStatus;
  freshness_state: OpportunityFreshnessState;
  presence: OpportunityPresence;
  availability: ScoringAvailability;
  score: number | null;
  components: ScoringComponent[];
  reasons: ScoringReason[];
  prediction: ScoringPredictionContext;
  advice: ScoringAdvice;
  provenance: SourceProvenance[];
  evidence: ScoringEvidenceRef[];
  fingerprint: string;
}
