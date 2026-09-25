import type {
  OpportunityObservation,
  OpportunityOutcome,
  OpportunityObservationScope,
  OpportunityPresence,
} from "./opportunity-tracking.js";
import type { SourceProvenance } from "./market.js";

export const PREDICTION_CONTRACT_VERSION = "phase-06.1";
export const PREDICTION_BASELINE_MODEL_VERSION = "phase-06-baseline.1";

export type PredictionTargetKind =
  | "PRESENCE_AT_HORIZON"
  | "OUTCOME_OBSERVED_AT_HORIZON";

export type PredictionLabelState = "POSITIVE" | "NEGATIVE" | "UNKNOWN";

export type PredictionArtifactStatus =
  | "READY"
  | "INSUFFICIENT_DATA"
  | "INVALID";

export interface PredictionDatasetConfig {
  dataset_version: string;
  prediction_horizon_seconds: number;
  max_label_lag_seconds: number;
}

export interface PredictionFeatureSet {
  presence: OpportunityPresence;
  freshness_state: OpportunityObservation["freshness_state"];
  requested_quantity: number;
  fulfilled_quantity: number | null;
  fill_ratio: number | null;
  simulated_net_result: number | null;
  simulated_return: number | null;
  prior_observation_count: number;
  seconds_since_previous_observation: number | null;
  previous_presence: OpportunityPresence | null;
  previous_simulated_net_result: number | null;
}

export interface PredictionTargetLabel {
  kind: PredictionTargetKind;
  state: PredictionLabelState;
  value: boolean | null;
  target_observed_at: string | null;
  source_id: string | null;
}

export interface PredictionDatasetSample {
  sample_id: string;
  contract_version: typeof PREDICTION_CONTRACT_VERSION;
  dataset_version: string;
  opportunity_id: string;
  observation_id: string;
  feature_observed_at: string;
  label_observed_at: string | null;
  prediction_horizon_seconds: number;
  scope: OpportunityObservationScope;
  features: PredictionFeatureSet;
  targets: PredictionTargetLabel[];
  provenance: SourceProvenance[];
}

export interface PredictionDatasetMetadata {
  dataset_id: string;
  dataset_version: string;
  contract_version: typeof PREDICTION_CONTRACT_VERSION;
  feature_window_start: string | null;
  feature_window_end: string | null;
  prediction_horizon_seconds: number;
  max_label_lag_seconds: number;
  input_observation_count: number;
  input_outcome_count: number;
  sample_count: number;
  labeled_sample_count: number;
  rejected_sample_count: number;
}

export interface PredictionDataset {
  metadata: PredictionDatasetMetadata;
  samples: PredictionDatasetSample[];
}

export interface PredictionTemporalSplit {
  evaluation_start: string;
  training_samples: PredictionDatasetSample[];
  evaluation_samples: PredictionDatasetSample[];
  excluded_samples: PredictionDatasetSample[];
}

export interface PredictionModel {
  contract_version: typeof PREDICTION_CONTRACT_VERSION;
  model_version: string;
  target_kind: PredictionTargetKind;
  dataset_id: string;
  training_sample_count: number;
  positive_sample_count: number;
  negative_sample_count: number;
  estimated_positive_rate: number;
  fingerprint: string;
}

export interface PredictionTrainingResult {
  status: PredictionArtifactStatus;
  model: PredictionModel | null;
  target_kind: PredictionTargetKind;
  sample_count: number;
  reason: string | null;
}

export interface PredictionResult {
  status: "PREDICTED" | "INSUFFICIENT_DATA";
  target_kind: PredictionTargetKind;
  model_version: string | null;
  dataset_id: string | null;
  sample_size: number;
  estimated_probability: number | null;
}

export interface PredictionEvaluation {
  status: "EVALUATED" | "INSUFFICIENT_DATA";
  target_kind: PredictionTargetKind;
  model_version: string;
  dataset_id: string;
  sample_count: number;
  positive_count: number;
  negative_count: number;
  accuracy: number | null;
  brier_score: number | null;
  calibration_status: "NOT_ASSESSED";
}

export interface PredictionSourceData {
  observations: OpportunityObservation[];
  outcomes: OpportunityOutcome[];
}
