import type { PrincipalScope, SourceProvenance } from "./market.js";

export const ECONOMIC_OPERATION_CONTRACT_VERSION = "phase-08.3";

export type EconomicOperationLifecycleState =
  | "DETECTED"
  | "ACQUISITION_PLANNED"
  | "ACQUIRED"
  | "OPEN"
  | "PARTIALLY_DISPOSED"
  | "COMPLETED";

export type EconomicEvaluationState =
  | "ECONOMICALLY_EVALUABLE"
  | "ECONOMICALLY_UNAVAILABLE";

export type EconomicExecutionState = "OBSERVED" | "PROJECTED";

export type EconomicOperationStateKind = "PLANNED" | "OBSERVED" | "PROJECTED";

export type EconomicEvidenceKind =
  | "TRANSACTION"
  | "ORDER"
  | "JOURNAL"
  | "ASSET"
  | "MARKET_SNAPSHOT";

export interface EconomicOperationScope {
  principal_scope: PrincipalScope;
  principal_id: number | null;
  character_id: number | null;
  provenance: SourceProvenance | null;
}

export interface EconomicEvidence {
  evidence_id: string;
  kind: EconomicEvidenceKind;
  observed_at: string;
  quantity: number | null;
  unit_price: number | null;
  value: number | null;
  order_id: number | null;
  transaction_id: number | null;
  issuer: number | null;
  provenance: SourceProvenance;
}

export interface EconomicAcquisitionRecord {
  record_id: string;
  execution_state: "OBSERVED";
  observed_at: string;
  quantity: number;
  cost: number | null;
  evidence: EconomicEvidence[];
  provenance: SourceProvenance[];
}

export interface EconomicDispositionRecord {
  record_id: string;
  execution_state: "OBSERVED";
  observed_at: string;
  quantity: number;
  proceeds: number | null;
  disposed_cost_basis: number | null;
  fees: number | null;
  logistics: number | null;
  evidence: EconomicEvidence[];
  provenance: SourceProvenance[];
}

export interface ProjectedDisposition {
  execution_state: "PROJECTED";
  projected_at: string;
  quantity: number;
  unit_price: number;
  projected_proceeds: number;
  projected_fees: number | null;
  projected_logistics: number | null;
  provenance: SourceProvenance[];
}

export interface EconomicOperationResult {
  evaluation_state: EconomicEvaluationState;
  observed_sub_result: number | null;
  observed_current_result: number | null;
  projected_current_result: number | null;
  terminal_result: number | null;
  observed_current_return: number | null;
  projected_current_return: number | null;
  terminal_return: number | null;
  known_acquisition_cost: number | null;
  known_disposition_proceeds: number | null;
  known_fees: number | null;
  known_logistics: number | null;
  remaining_quantity: number;
}

export interface Position {
  position_id: string;
  operation_id: string;
  type_id: number;
  quantity: number;
  location: {
    region_id: number;
    system_id: number;
    location_id: number;
  } | null;
  opened_at: string;
  age_seconds: number | null;
  state: "OPEN" | "CLOSED";
}

export interface PortfolioSnapshot {
  observed_at: string;
  scope: EconomicOperationScope;
  cash: number | null;
  inventory_value: number | null;
  open_orders_value: number | null;
  capital_committed: number | null;
  portfolio_value: number | null;
  largest_position_value: number | null;
  concentration_ratio: number | null;
  position_count: number | null;
}

export interface EconomicOperation {
  operation_id: string;
  contract_version: typeof ECONOMIC_OPERATION_CONTRACT_VERSION;
  opportunity_id: string | null;
  type_id: number;
  initial_quantity: number;
  acquired_quantity: number;
  unacquired_quantity: number;
  disposed_quantity: number;
  remaining_quantity: number;
  lifecycle_state: EconomicOperationLifecycleState;
  evaluation_state: EconomicEvaluationState;
  state_kind: EconomicOperationStateKind;
  acquisition_mode: "TAKER_AGAINST_SELL" | "EXISTING_INVENTORY";
  disposition_mode: "TAKER_AGAINST_BUY" | "MAKER_SELL";
  acquisition_evidence: EconomicAcquisitionRecord[];
  disposition_evidence: EconomicDispositionRecord[];
  projected_disposition: ProjectedDisposition | null;
  position: Position | null;
  result: EconomicOperationResult;
  scope: EconomicOperationScope;
  provenance: SourceProvenance[];
  created_at: string;
  updated_at: string;
}

export interface CreateEconomicOperationInput {
  operation_id: string;
  opportunity_id?: string | null;
  type_id: number;
  initial_quantity: number;
  acquisition_mode: EconomicOperation["acquisition_mode"];
  disposition_mode: EconomicOperation["disposition_mode"];
  scope: EconomicOperationScope;
  provenance: SourceProvenance[];
  created_at: string;
}

export interface RecordAcquisitionInput {
  record_id: string;
  observed_at: string;
  quantity: number;
  cost: number | null;
  evidence: EconomicEvidence[];
  provenance: SourceProvenance[];
}

export interface RecordDispositionInput {
  record_id: string;
  observed_at: string;
  quantity: number;
  proceeds: number | null;
  disposed_cost_basis: number | null;
  fees: number | null;
  logistics: number | null;
  evidence: EconomicEvidence[];
  provenance: SourceProvenance[];
}

export interface ProjectDispositionInput {
  projected_at: string;
  quantity: number;
  unit_price: number;
  projected_fees: number | null;
  projected_logistics: number | null;
  provenance: SourceProvenance[];
}
