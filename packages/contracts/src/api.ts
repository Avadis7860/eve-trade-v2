import type {
  OpportunityFreshnessState,
  OpportunityObservationScope,
  OpportunityPresence,
} from "./opportunity-tracking.js";
import type {
  OpportunityPipelineRun,
} from "./opportunity-pipeline.js";
import type {
  ScoringAdviceKind,
  ScoringEvidenceLevel,
  ScoringResult,
} from "./scoring.js";
import type {
  TradeAnalysisResult,
  TradeScenario,
} from "./trade-analysis.js";
import type { SourceProvenance } from "./market.js";

export const API_CONTRACT_VERSION = "phase-08.1";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "METHOD_NOT_ALLOWED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "READ_MODEL_ERROR"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  contract_version: typeof API_CONTRACT_VERSION;
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

export interface ApiOpportunitySummary {
  opportunity_id: string;
  observation_id: string;
  observed_at: string;
  type_id: number;
  requested_quantity: number;
  presence: OpportunityPresence;
  freshness_state: OpportunityFreshnessState;
  trade_analysis_status: TradeAnalysisResult["status"];
  economic_result: Pick<
    TradeAnalysisResult["economic_result"],
    "simulated_net_result" | "simulated_return" | "capital_required"
  >;
  score: {
    availability: ScoringResult["availability"];
    value: number | null;
    contract_version: ScoringResult["contract_version"];
    policy_version: string;
  };
  advice: {
    kind: ScoringAdviceKind;
    evidence_level: ScoringEvidenceLevel;
  };
  data_state:
    | "COMPLETE"
    | "PARTIAL"
    | "ERROR"
    | "UNKNOWN"
    | "STALE"
    | "ABSENT";
  blockers: ScoringResult["advice"]["blockers"];
  limitations: string[];
  scope: OpportunityObservationScope;
  provenance: SourceProvenance[];
  evidence_count: number;
}

export interface ApiOpportunityDetail extends ApiOpportunitySummary {
  scenario: TradeScenario;
  trade_analysis: TradeAnalysisResult;
  scoring: ScoringResult;
}

export interface ApiOpportunityPipelineStatus {
  status: OpportunityPipelineRun["status"];
  region_id: number;
  market_collection_id: string | null;
  observed_at: string;
  completed_at: string | null;
  candidates_generated: number;
  analyses_produced: number;
  observations_persisted: number;
  error: OpportunityPipelineRun["error"];
}

export interface ApiListData<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  pipeline: ApiOpportunityPipelineStatus | null;
}

export interface ApiListResponse<T> {
  contract_version: typeof API_CONTRACT_VERSION;
  data: ApiListData<T>;
}

export interface ApiDetailResponse<T> {
  contract_version: typeof API_CONTRACT_VERSION;
  data: T;
}

export interface ApiHealthResponse {
  contract_version: typeof API_CONTRACT_VERSION;
  status: "ok";
}
