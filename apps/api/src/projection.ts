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
