import type {
  ApiOpportunityDetail,
  ApiOpportunitySummary,
  OpportunityObservation,
  ScoringResult,
} from "@eve-trade/contracts";
import {
  SCORING_POLICY_V1,
  scoreOpportunity,
} from "@eve-trade/domain";

export function scoreObservation(
  observation: OpportunityObservation,
): ScoringResult {
  return scoreOpportunity({
    opportunity: observation,
    trade_analysis: observation.phase4_result,
    prediction: null,
    policy: SCORING_POLICY_V1,
  });
}

function dataState(
  observation: OpportunityObservation,
): ApiOpportunitySummary["data_state"] {
  if (observation.presence === "ABSENT") return "ABSENT";
  if (
    observation.presence === "UNAVAILABLE" ||
    observation.phase4_result.status === "DATA_UNAVAILABLE"
  ) {
    return "ERROR";
  }
  if (observation.freshness_state === "UNKNOWN") return "UNKNOWN";
  if (observation.freshness_state === "STALE") return "STALE";
  if (observation.phase4_result.status === "PARTIAL") return "PARTIAL";
  return "COMPLETE";
}

export function projectSummary(
  observation: OpportunityObservation,
  scoring = scoreObservation(observation),
): ApiOpportunitySummary {
  return {
    opportunity_id: observation.opportunity_id,
    observation_id: observation.observation_id,
    observed_at: observation.observed_at,
    type_id: observation.identity.payload.type_id,
    requested_quantity: observation.identity.payload.requested_quantity,
    presence: observation.presence,
    freshness_state: observation.freshness_state,
    trade_analysis_status: observation.phase4_result.status,
    economic_result: {
      simulated_net_result:
        observation.phase4_result.economic_result.simulated_net_result,
      simulated_return:
        observation.phase4_result.economic_result.simulated_return,
      capital_required:
        observation.phase4_result.economic_result.capital_required,
      projected_net_result:
        observation.phase4_result.economic_result.projected_net_result ?? null,
      projected_return:
        observation.phase4_result.economic_result.projected_return ?? null,
      projected_disposition_proceeds:
        observation.phase4_result.economic_result.projected_disposition_proceeds ?? null,
    },
    score: {
      availability: scoring.availability,
      value: scoring.score,
      contract_version: scoring.contract_version,
      policy_version: scoring.policy_version,
    },
    advice: {
      kind: scoring.advice.kind,
      evidence_level: scoring.advice.evidence_level,
    },
    data_state: dataState(observation),
    blockers: [...scoring.advice.blockers],
    limitations: [...scoring.advice.limitations],
    scope: observation.scope,
    provenance: [...observation.provenance],
    evidence_count: scoring.evidence.length,
  };
}

export function projectDetail(
  observation: OpportunityObservation,
  scoring = scoreObservation(observation),
): ApiOpportunityDetail {
  return {
    ...projectSummary(observation, scoring),
    scenario: observation.scenario_snapshot,
    trade_analysis: observation.phase4_result,
    scoring,
  };
}


import type {
  ApiEconomicOperationSummary,
  ApiEconomicOperationDetail,
  EconomicOperation,
} from "@eve-trade/contracts";

export function projectEconomicOperation(
  operation: EconomicOperation,
): ApiEconomicOperationSummary {
  return {
    contract_version: "phase-08.3",
    operation_id: operation.operation_id,
    opportunity_id: operation.opportunity_id,
    type_id: operation.type_id,
    initial_quantity: operation.initial_quantity,
    acquired_quantity: operation.acquired_quantity,
    unacquired_quantity: operation.unacquired_quantity,
    disposed_quantity: operation.disposed_quantity,
    remaining_quantity: operation.remaining_quantity,
    lifecycle_state: operation.lifecycle_state,
    evaluation_state: operation.evaluation_state,
    acquisition_mode: operation.acquisition_mode,
    disposition_mode: operation.disposition_mode,
    result: operation.result,
    position: operation.position,
    scope: operation.scope,
    provenance: [...operation.provenance],
    observed_at: operation.updated_at,
  };
}

export function projectEconomicOperationDetail(
  operation: EconomicOperation,
  history: EconomicOperation[],
): ApiEconomicOperationDetail {
  return {
    ...projectEconomicOperation(operation),
    operation,
    history: [...history],
  };
}
