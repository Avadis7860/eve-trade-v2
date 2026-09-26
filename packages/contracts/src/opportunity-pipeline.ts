export const OPPORTUNITY_PIPELINE_CONTRACT_VERSION = "phase-08.1";

export type OpportunityPipelineStatus =
  | "SUCCESS"
  | "NO_CANDIDATES"
  | "INPUT_UNAVAILABLE"
  | "ERROR";

export interface OpportunityPipelineError {
  code: string;
  message: string;
}

export interface OpportunityPipelineRun {
  run_id: string;
  region_id: number;
  market_collection_id: string | null;
  observed_at: string;
  completed_at: string | null;
  status: OpportunityPipelineStatus;
  candidates_generated: number;
  analyses_produced: number;
  observations_persisted: number;
  economic_operations_created?: number;
  economic_operation_observations_persisted?: number;
  error: OpportunityPipelineError | null;
}
