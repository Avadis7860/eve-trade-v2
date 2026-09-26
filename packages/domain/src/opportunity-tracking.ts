import { createHash } from "node:crypto";
import type {
  OpportunityFreshnessState,
  OpportunityHistoryEvent,
  OpportunityIdentity,
  OpportunityIdentityMarketLeg,
  OpportunityIdentityPayload,
  OpportunityObservation,
  OpportunityObservationScope,
  OpportunityOutcome,
  OpportunityOutcomeAssessmentInput,
  OpportunityOutcomeEvidence,
  OpportunityPresence,
  TradeAnalysisResult,
  TradeScenario,
} from "@eve-trade/contracts";
import { OPPORTUNITY_TRACKING_CONTRACT_VERSION } from "@eve-trade/contracts";

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

function marketIdentity(
  market: Extract<TradeScenario["acquisition"], { source: "MARKET" }>["market"],
): OpportunityIdentityMarketLeg {
  return {
    execution_mode: market.execution_mode,
    execution_location: {
      region_id: market.execution_location.region_id,
      system_id: market.execution_location.system_id,
      location_id: market.execution_location.location_id,
    },
    limit_price: market.limit_price,
    order_range: market.order_range,
  };
}

function identityPayload(scenario: TradeScenario): OpportunityIdentityPayload {
  return {
    type_id: scenario.type_id,
    requested_quantity: scenario.requested_quantity,
    acquisition_source: scenario.acquisition.source,
    acquisition_market:
      scenario.acquisition.source === "MARKET"
        ? marketIdentity(scenario.acquisition.market)
        : null,
    disposition_market: marketIdentity(scenario.disposition.market),
    origin: { ...scenario.origin },
    destination: { ...scenario.destination },
  };
}

export function fingerprintOpportunityScenario(
  scenario: TradeScenario,
): string {
  return hash({
    contract_version: OPPORTUNITY_TRACKING_CONTRACT_VERSION,
    identity: identityPayload(scenario),
  });
}

export function buildOpportunityIdentity(
  scenario: TradeScenario,
): OpportunityIdentity {
  return {
    opportunity_id: fingerprintOpportunityScenario(scenario),
    contract_version: OPPORTUNITY_TRACKING_CONTRACT_VERSION,
    payload: identityPayload(scenario),
  };
}

function freshnessState(result: TradeAnalysisResult): OpportunityFreshnessState {
  if (result.status === "STALE") return "STALE";
  if (result.status_reasons.some((item) => item.code === "FRESHNESS_METADATA_MISSING")) {
    return "UNKNOWN";
  }
  return "CURRENT";
}

function observationProvenance(
  result: TradeAnalysisResult,
  scope: OpportunityObservationScope,
): OpportunityObservation["provenance"] {
  const entries = [
    result.market_evidence.acquisition_provenance,
    result.market_evidence.disposition_provenance,
    scope.provenance,
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = JSON.stringify(stableValue(entry));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface CreateOpportunityObservationInput {
  observed_at: string;
  scenario: TradeScenario;
  phase4_result: TradeAnalysisResult;
  presence: OpportunityPresence;
  observer_character_id?: number | null;
  observer_provenance?: OpportunityObservationScope["provenance"];
}

export function createOpportunityObservation(
  input: CreateOpportunityObservationInput,
): OpportunityObservation {
  const identity = buildOpportunityIdentity(input.scenario);
  const scope: OpportunityObservationScope = {
    principal_scope:
      input.observer_character_id === null ||
      input.observer_character_id === undefined
        ? "PUBLIC"
        : "CHARACTER",
    principal_id: input.observer_character_id ?? null,
    character_id: input.observer_character_id ?? null,
    provenance: input.observer_provenance ?? null,
  };

  const observationId = hash({
    contract_version: OPPORTUNITY_TRACKING_CONTRACT_VERSION,
    opportunity_id: identity.opportunity_id,
    observed_at: input.observed_at,
    phase4_scenario_fingerprint: input.phase4_result.scenario_fingerprint,
    presence: input.presence,
    scope,
    phase4_result: input.phase4_result,
  });

  return {
    opportunity_id: identity.opportunity_id,
    observation_id: observationId,
    observed_at: input.observed_at,
    identity,
    scenario_snapshot: input.scenario,
    phase4_contract_version: input.phase4_result.contract_version,
    phase4_scenario_fingerprint: input.phase4_result.scenario_fingerprint,
    presence: input.presence,
    freshness_state: freshnessState(input.phase4_result),
    phase4_result: input.phase4_result,
    market_snapshot_ids: {
      acquisition: input.phase4_result.market_evidence.acquisition_snapshot_id,
      disposition: input.phase4_result.market_evidence.disposition_snapshot_id,
    },
    order_ids: {
      acquisition: [...input.phase4_result.market_evidence.acquisition_order_ids],
      disposition: [...input.phase4_result.market_evidence.disposition_order_ids],
    },
    provenance: observationProvenance(input.phase4_result, scope),
    scope,
  };
}

function comparableNet(result: TradeAnalysisResult): number | null {
  const value =
    result.status === "PROJECTED"
      ? result.economic_result.projected_net_result
      : result.economic_result.simulated_net_result;
  return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
}

function fulfilledQuantity(result: TradeAnalysisResult): number {
  if (result.status === "PROJECTED") {
    return result.acquisition_leg.filled_quantity;
  }
  return Math.min(
    result.acquisition_leg.filled_quantity,
    result.disposition_leg.filled_quantity,
  );
}

function classifyRelation(
  previous: OpportunityObservation,
  current: OpportunityObservation,
): OpportunityHistoryEvent["kind"] {
  if (previous.presence === "ABSENT" && current.presence === "PRESENT") {
    return "RETURNED";
  }
  if (previous.presence === "PRESENT" && current.presence === "ABSENT") {
    return "DISAPPEARED";
  }
  if (previous.presence === "PRESENT" && current.presence === "UNAVAILABLE") {
    return "PROOF_LOST";
  }
  if (
    previous.presence !== "PRESENT" &&
    current.presence === "PRESENT"
  ) {
    return "RETURNED";
  }

  if (previous.presence !== current.presence) {
    return "PROOF_LOST";
  }

  const previousNet = comparableNet(previous.phase4_result);
  const currentNet = comparableNet(current.phase4_result);

  if (previous.presence === "PRESENT" && current.presence === "PRESENT") {
    if (previousNet !== null && currentNet !== null) {
      if (currentNet > previousNet) return "IMPROVED";
      if (currentNet < previousNet) return "DETERIORATED";
      return "MAINTAINED";
    }

    if (previousNet !== null && currentNet === null) {
      return "PROOF_LOST";
    }

    const previousQuantity = fulfilledQuantity(previous.phase4_result);
    const currentQuantity = fulfilledQuantity(current.phase4_result);
    if (currentQuantity > previousQuantity) return "IMPROVED";
    if (currentQuantity < previousQuantity) return "DETERIORATED";
  }

  return "MAINTAINED";
}

export function reconstructOpportunityHistory(
  observations: OpportunityObservation[],
): OpportunityHistoryEvent[] {
  const streams = new Map<string, OpportunityObservation[]>();

  for (const observation of observations) {
    const key = [
      observation.opportunity_id,
      observation.scope.principal_scope,
      observation.scope.principal_id ?? "none",
    ].join(":");
    const stream = streams.get(key);
    if (stream) stream.push(observation);
    else streams.set(key, [observation]);
  }

  const history: OpportunityHistoryEvent[] = [];
  for (const stream of streams.values()) {
    const ordered = [...stream].sort((a, b) =>
      a.observed_at.localeCompare(b.observed_at) ||
      a.observation_id.localeCompare(b.observation_id),
    );

    for (const [index, current] of ordered.entries()) {
      const previous = ordered[index - 1] ?? null;
      history.push({
        opportunity_id: current.opportunity_id,
        kind: previous === null ? "INITIAL" : classifyRelation(previous, current),
        previous_observation_id: previous?.observation_id ?? null,
        observation_id: current.observation_id,
        observed_at: current.observed_at,
        scope: current.scope,
      });
    }
  }

  return history.sort((a, b) =>
    a.opportunity_id.localeCompare(b.opportunity_id) ||
    a.scope.principal_scope.localeCompare(b.scope.principal_scope) ||
    String(a.scope.principal_id ?? "").localeCompare(String(b.scope.principal_id ?? "")) ||
    a.observed_at.localeCompare(b.observed_at) ||
    a.observation_id.localeCompare(b.observation_id),
  );
}

export function fingerprintOpportunityOutcome(
  outcome: Omit<OpportunityOutcome, "outcome_id">,
): string {
  return hash({
    contract_version: OPPORTUNITY_TRACKING_CONTRACT_VERSION,
    outcome,
  });
}

export function assessOpportunityOutcome(
  input: OpportunityOutcomeAssessmentInput,
): OpportunityOutcome {
  if (!Number.isInteger(input.expected_quantity) || input.expected_quantity <= 0) {
    throw new Error("expected_quantity must be a positive integer");
  }
  if (
    input.observed_quantity !== null &&
    (!Number.isInteger(input.observed_quantity) || input.observed_quantity < 0)
  ) {
    throw new Error("observed_quantity must be null or a non-negative integer");
  }

  let status: OpportunityOutcome["status"];
  if (input.evidence_coverage === "NONE") {
    if (input.observed_quantity !== null && input.observed_quantity > 0) {
      throw new Error("observed_quantity cannot be positive when evidence coverage is NONE");
    }
    status = "NO_EVIDENCE";
  } else if (input.observed_quantity === null) {
    status = "UNKNOWN";
  } else if (input.observed_quantity >= input.expected_quantity) {
    status = "COMPLETELY_OBSERVED";
  } else if (input.observed_quantity > 0) {
    status = "PARTIALLY_OBSERVED";
  } else if (input.evidence_coverage === "COMPLETE") {
    status = "NO_EVIDENCE";
  } else {
    status = "UNKNOWN";
  }

  return {
    opportunity_id: input.opportunity_id,
    outcome_id: input.outcome_id,
    observed_at: input.observed_at,
    status,
    evidence_coverage: input.evidence_coverage,
    expected_quantity: input.expected_quantity,
    observed_quantity: input.observed_quantity,
    evidence: input.evidence,
    observed_subresult: input.observed_subresult,
  };
}

export function notObservedOpportunityOutcome(
  opportunityId: string,
  outcomeId: string,
  observedAt: string,
): OpportunityOutcome {
  return {
    opportunity_id: opportunityId,
    outcome_id: outcomeId,
    observed_at: observedAt,
    status: "NOT_OBSERVED",
    evidence_coverage: "UNKNOWN",
    expected_quantity: null,
    observed_quantity: null,
    evidence: [],
    observed_subresult: null,
  };
}
