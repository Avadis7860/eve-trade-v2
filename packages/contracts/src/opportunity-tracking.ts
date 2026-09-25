import type { PrincipalScope, SourceProvenance } from "./market.js";
import type { TradeAnalysisResult, TradeExecutionMode, TradeScenario } from "./trade-analysis.js";

export const OPPORTUNITY_TRACKING_CONTRACT_VERSION = "phase-05.1";

export type OpportunityPresence = "PRESENT" | "ABSENT" | "UNAVAILABLE";
export type OpportunityFreshnessState = "CURRENT" | "STALE" | "UNKNOWN";

export type OpportunityObservationRelationKind =
  | "INITIAL"
  | "MAINTAINED"
  | "IMPROVED"
  | "DETERIORATED"
  | "PROOF_LOST"
  | "DISAPPEARED"
  | "RETURNED";

export type OpportunityOutcomeStatus =
  | "NOT_OBSERVED"
  | "NO_EVIDENCE"
  | "PARTIALLY_OBSERVED"
  | "COMPLETELY_OBSERVED"
  | "UNKNOWN";

export type OpportunityOutcomeEvidenceCoverage =
  | "NONE"
  | "PARTIAL"
  | "COMPLETE"
  | "UNKNOWN";

export type OpportunityOutcomeEvidenceKind =
  | "TRANSACTION"
  | "ORDER"
  | "JOURNAL"
  | "ASSET";

export interface OpportunityIdentityMarketLeg {
  execution_mode: TradeExecutionMode;
  execution_location: {
    region_id: number;
    system_id: number;
    location_id: number;
  };
  limit_price: number;
  order_range: string;
}

export interface OpportunityIdentityPayload {
  type_id: number;
  requested_quantity: number;
  acquisition_source: "MARKET" | "EXISTING_INVENTORY";
  acquisition_market: OpportunityIdentityMarketLeg | null;
  disposition_market: OpportunityIdentityMarketLeg;
  origin: {
    region_id: number;
    system_id: number;
    location_id: number;
  };
  destination: {
    region_id: number;
    system_id: number;
    location_id: number;
  };
}

export interface OpportunityIdentity {
  opportunity_id: string;
  contract_version: typeof OPPORTUNITY_TRACKING_CONTRACT_VERSION;
  payload: OpportunityIdentityPayload;
}

export interface OpportunityObservationScope {
  principal_scope: PrincipalScope;
  principal_id: number | null;
  character_id: number | null;
  provenance: SourceProvenance | null;
}

export interface OpportunityObservation {
  opportunity_id: string;
  observation_id: string;
  observed_at: string;
  identity: OpportunityIdentity;
  scenario_snapshot: TradeScenario;
  phase4_contract_version: TradeAnalysisResult["contract_version"];
  phase4_scenario_fingerprint: string;
  presence: OpportunityPresence;
  freshness_state: OpportunityFreshnessState;
  phase4_result: TradeAnalysisResult;
  market_snapshot_ids: {
    acquisition: string | null;
    disposition: string | null;
  };
  order_ids: {
    acquisition: number[];
    disposition: number[];
  };
  provenance: SourceProvenance[];
  scope: OpportunityObservationScope;
}

export interface OpportunityHistoryEvent {
  opportunity_id: string;
  kind: OpportunityObservationRelationKind;
  previous_observation_id: string | null;
  observation_id: string;
  observed_at: string;
  scope: OpportunityObservationScope;
}

export interface OpportunityOutcomeEvidence {
  evidence_id: string;
  kind: OpportunityOutcomeEvidenceKind;
  observed_at: string;
  provenance: SourceProvenance;
}

export interface OpportunityOutcome {
  opportunity_id: string;
  outcome_id: string;
  observed_at: string;
  status: OpportunityOutcomeStatus;
  evidence_coverage: OpportunityOutcomeEvidenceCoverage;
  expected_quantity: number | null;
  observed_quantity: number | null;
  evidence: OpportunityOutcomeEvidence[];
  observed_subresult: unknown | null;
}

export interface OpportunityOutcomeAssessmentInput {
  opportunity_id: string;
  outcome_id: string;
  observed_at: string;
  expected_quantity: number;
  evidence_coverage: OpportunityOutcomeEvidenceCoverage;
  observed_quantity: number | null;
  evidence: OpportunityOutcomeEvidence[];
  observed_subresult: unknown | null;
}
