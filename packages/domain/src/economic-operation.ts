import { createHash } from "node:crypto";
import type {
  EconomicAcquisitionRecord,
  EconomicDispositionRecord,
  EconomicEvidence,
  EconomicOperation,
  EconomicOperationResult,
  EconomicOperationScope,
  Position,
  ProjectDispositionInput,
  RecordAcquisitionInput,
  RecordDispositionInput,
  CreateEconomicOperationInput,
  ProjectedDisposition,
} from "@eve-trade/contracts";
import { ECONOMIC_OPERATION_CONTRACT_VERSION } from "@eve-trade/contracts";

function operationHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function economicOperationId(opportunityId: string): string {
  return "operation:" + operationHash({
    contract_version: ECONOMIC_OPERATION_CONTRACT_VERSION,
    opportunity_id: opportunityId,
  });
}

export function economicOperationObservationId(operation: EconomicOperation): string {
  return operationHash({
    contract_version: ECONOMIC_OPERATION_CONTRACT_VERSION,
    operation_id: operation.operation_id,
    observed_at: operation.updated_at,
    state: operation,
  });
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(label + " must be a positive safe integer");
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(label + " must be a non-negative safe integer");
  }
}

function assertFiniteNonNegative(value: number | null, label: string): void {
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    throw new Error(label + " must be null or a finite non-negative number");
  }
}

function validateEvidence(evidence: EconomicEvidence[]): void {
  for (const item of evidence) {
    assertPositiveInteger(item.evidence_id.length, "evidence_id length");
    if (!item.provenance.source_id) throw new Error("evidence provenance source_id is required");
    if (item.quantity !== null) assertNonNegativeInteger(item.quantity, "evidence quantity");
    if (item.unit_price !== null && (!Number.isFinite(item.unit_price) || item.unit_price < 0)) {
      throw new Error("evidence unit_price must be null or finite non-negative");
    }
    if (item.value !== null && (!Number.isFinite(item.value) || item.value < 0)) {
      throw new Error("evidence value must be null or finite non-negative");
    }
  }
}

function recalculate(operation: EconomicOperation): EconomicOperationResult {
  const hasAcquisitionEvidence = operation.acquisition_evidence.length > 0;
  const acquisitionKnown =
    hasAcquisitionEvidence &&
    operation.acquisition_evidence.every((item) => item.cost !== null);
  const dispositionProceedsKnown = operation.disposition_evidence.every((item) => item.proceeds !== null);
  const feesKnown = operation.disposition_evidence.every((item) => item.fees !== null);
  const logisticsKnown = operation.disposition_evidence.every((item) => item.logistics !== null);

  const acquisitionCost = acquisitionKnown
    ? operation.acquisition_evidence.reduce((sum, item) => sum + (item.cost ?? 0), 0)
    : null;
  const hasDispositionEvidence = operation.disposition_evidence.length > 0;
  const dispositionProceeds = hasDispositionEvidence && dispositionProceedsKnown
    ? operation.disposition_evidence.reduce((sum, item) => sum + (item.proceeds ?? 0), 0)
    : null;

  const knownFees = hasDispositionEvidence && feesKnown
    ? operation.disposition_evidence.reduce((sum, item) => sum + (item.fees ?? 0), 0)
    : null;
  const knownLogistics = hasDispositionEvidence && logisticsKnown
    ? operation.disposition_evidence.reduce((sum, item) => sum + (item.logistics ?? 0), 0)
    : null;

  const current =
    acquisitionCost !== null &&
    (hasDispositionEvidence ? dispositionProceeds !== null && knownFees !== null && knownLogistics !== null : true)
      ? (hasDispositionEvidence ? dispositionProceeds! - acquisitionCost - knownFees! - knownLogistics! : -acquisitionCost)
      : null;

  const subResultValues = operation.disposition_evidence
    .map((item) => {
      if (item.proceeds === null || item.disposed_cost_basis === null) return null;
      if (item.fees === null || item.logistics === null) return null;
      return item.proceeds - item.disposed_cost_basis - item.fees - item.logistics;
    });
  const observedSubResult =
    subResultValues.length > 0 && subResultValues.every((value) => value !== null)
      ? subResultValues.reduce((sum, value) => sum + (value ?? 0), 0)
      : null;

  const projected = operation.projected_disposition;
  const projectedKnownObservedFees =
    hasDispositionEvidence ? knownFees : 0;
  const projectedKnownObservedLogistics =
    hasDispositionEvidence ? knownLogistics : 0;
  const projectedKnownObservedProceeds =
    hasDispositionEvidence ? dispositionProceeds : 0;
  const projectedCurrent =
    projected !== null &&
    projected.quantity === operation.remaining_quantity &&
    acquisitionCost !== null &&
    projectedKnownObservedProceeds !== null &&
    projectedKnownObservedFees !== null &&
    projectedKnownObservedLogistics !== null &&
    projected.projected_fees !== null &&
    projected.projected_logistics !== null
      ? projectedKnownObservedProceeds +
        projected.projected_proceeds -
        acquisitionCost -
        projectedKnownObservedFees -
        projectedKnownObservedLogistics -
        projected.projected_fees -
        projected.projected_logistics
      : null;

  const terminal =
    operation.lifecycle_state === "COMPLETED" && current !== null ? current : null;

  const evaluation_state: EconomicOperation["evaluation_state"] =
    current !== null || observedSubResult !== null || projectedCurrent !== null
      ? "ECONOMICALLY_EVALUABLE"
      : "ECONOMICALLY_UNAVAILABLE";

  const observedReturn =
    current !== null && acquisitionCost !== null && acquisitionCost > 0
      ? current / acquisitionCost
      : null;
  const projectedReturn =
    projectedCurrent !== null && acquisitionCost !== null && acquisitionCost > 0
      ? projectedCurrent / acquisitionCost
      : null;
  const terminalReturn =
    terminal !== null && acquisitionCost !== null && acquisitionCost > 0
      ? terminal / acquisitionCost
      : null;

  return {
    evaluation_state,
    observed_sub_result: observedSubResult,
    observed_current_result: current,
    projected_current_result: projectedCurrent,
    terminal_result: terminal,
    observed_current_return: observedReturn,
    projected_current_return: projectedReturn,
    terminal_return: terminalReturn,
    known_acquisition_cost: acquisitionCost,
    known_disposition_proceeds: dispositionProceeds,
    known_fees: knownFees,
    known_logistics: knownLogistics,
    remaining_quantity: operation.remaining_quantity,
  };
}

function lifecycle(
  initial: number,
  acquired: number,
  disposed: number,
): EconomicOperation["lifecycle_state"] {
  if (
    acquired > 0 &&
    acquired === initial &&
    disposed === acquired
  ) return "COMPLETED";
  if (disposed > 0) return "PARTIALLY_DISPOSED";
  if (acquired === 0) return "DETECTED";
  if (acquired < initial) return "ACQUIRED";
  return "OPEN";
}

function withState(
  operation: EconomicOperation,
  patch: Partial<EconomicOperation>,
): EconomicOperation {
  const next = { ...operation, ...patch };
  next.unacquired_quantity = next.initial_quantity - next.acquired_quantity;
  next.remaining_quantity = next.acquired_quantity - next.disposed_quantity;
  const planned =
    patch.lifecycle_state === "ACQUISITION_PLANNED" ||
    (operation.lifecycle_state === "ACQUISITION_PLANNED" &&
      next.acquired_quantity === 0);
  next.lifecycle_state = planned
    ? "ACQUISITION_PLANNED"
    : lifecycle(
        next.initial_quantity,
        next.acquired_quantity,
        next.disposed_quantity,
      );
  next.evaluation_state = recalculate(next).evaluation_state;
  next.result = recalculate(next);
  next.position = derivePosition(next, next.updated_at);
  return next;
}

export function createEconomicOperation(
  input: CreateEconomicOperationInput,
): EconomicOperation {
  assertPositiveInteger(input.initial_quantity, "initial_quantity");
  if (!input.operation_id.trim()) throw new Error("operation_id must not be empty");
  if (!input.created_at || !Number.isFinite(Date.parse(input.created_at))) {
    throw new Error("created_at must be a valid timestamp");
  }
  return {
    operation_id: input.operation_id,
    contract_version: ECONOMIC_OPERATION_CONTRACT_VERSION,
    opportunity_id: input.opportunity_id ?? null,
    type_id: input.type_id,
    initial_quantity: input.initial_quantity,
    acquired_quantity: 0,
    unacquired_quantity: input.initial_quantity,
    disposed_quantity: 0,
    remaining_quantity: 0,
    lifecycle_state: "DETECTED",
    evaluation_state: "ECONOMICALLY_UNAVAILABLE",
    state_kind: "PLANNED",
    acquisition_mode: input.acquisition_mode,
    disposition_mode: input.disposition_mode,
    acquisition_evidence: [],
    disposition_evidence: [],
    projected_disposition: null,
    position: null,
    result: {
      evaluation_state: "ECONOMICALLY_UNAVAILABLE",
      observed_sub_result: null,
      observed_current_result: null,
      projected_current_result: null,
      terminal_result: null,
      observed_current_return: null,
      projected_current_return: null,
      terminal_return: null,
      known_acquisition_cost: null,
      known_disposition_proceeds: null,
      known_fees: null,
      known_logistics: null,
      remaining_quantity: 0,
    },
    scope: input.scope,
    provenance: [...input.provenance],
    created_at: input.created_at,
    updated_at: input.created_at,
  };
}

export function planAcquisition(
  operation: EconomicOperation,
  observedAt: string,
): EconomicOperation {
  if (operation.lifecycle_state !== "DETECTED") {
    throw new Error("acquisition planning is only valid from DETECTED");
  }
  return withState(operation, {
    lifecycle_state: "ACQUISITION_PLANNED",
    state_kind: "PLANNED",
    updated_at: observedAt,
  });
}

export function recordObservedAcquisition(
  operation: EconomicOperation,
  input: RecordAcquisitionInput,
): EconomicOperation {
  assertPositiveInteger(input.quantity, "acquisition quantity");
  assertFiniteNonNegative(input.cost, "acquisition cost");
  if (operation.acquired_quantity + input.quantity > operation.initial_quantity) {
    throw new Error("acquisition quantity exceeds initial quantity");
  }
  validateEvidence(input.evidence);
  const record: EconomicAcquisitionRecord = {
    ...input,
    execution_state: "OBSERVED",
  };
  const next: EconomicOperation = {
    ...operation,
    acquisition_evidence: [...operation.acquisition_evidence, record],
    acquired_quantity: operation.acquired_quantity + input.quantity,
    state_kind: "OBSERVED",
    updated_at: input.observed_at,
    provenance: [...new Map(
      [...operation.provenance, ...input.provenance].map((item) => [JSON.stringify(item), item]),
    ).values()],
  };
  return withState(next, {});
}

export function recordObservedDisposition(
  operation: EconomicOperation,
  input: RecordDispositionInput,
): EconomicOperation {
  assertPositiveInteger(input.quantity, "disposition quantity");
  assertFiniteNonNegative(input.proceeds, "disposition proceeds");
  assertFiniteNonNegative(input.disposed_cost_basis, "disposed_cost_basis");
  assertFiniteNonNegative(input.fees, "disposition fees");
  assertFiniteNonNegative(input.logistics, "disposition logistics");
  if (input.quantity > operation.acquired_quantity - operation.disposed_quantity) {
    throw new Error("disposition quantity exceeds remaining position");
  }
  validateEvidence(input.evidence);

  const record: EconomicDispositionRecord = {
    ...input,
    execution_state: "OBSERVED",
  };
  const next: EconomicOperation = {
    ...operation,
    disposition_evidence: [...operation.disposition_evidence, record],
    disposed_quantity: operation.disposed_quantity + input.quantity,
    projected_disposition: null,
    state_kind: "OBSERVED",
    updated_at: input.observed_at,
    provenance: [...new Map(
      [...operation.provenance, ...input.provenance].map((item) => [JSON.stringify(item), item]),
    ).values()],
  };
  return withState(next, {});
}

export function projectMakerSellDisposition(
  operation: EconomicOperation,
  input: ProjectDispositionInput,
): EconomicOperation {
  assertPositiveInteger(input.quantity, "projected disposition quantity");
  if (!Number.isFinite(input.unit_price) || input.unit_price <= 0) {
    throw new Error("projected unit_price must be finite and positive");
  }
  if (input.quantity > operation.acquired_quantity - operation.disposed_quantity) {
    throw new Error("projected quantity exceeds remaining position");
  }
  const projected: ProjectedDisposition = {
    ...input,
    execution_state: "PROJECTED",
    projected_proceeds: input.quantity * input.unit_price,
  };
  return withState(operation, {
    projected_disposition: projected,
    state_kind: "PROJECTED",
    updated_at: input.projected_at,
  });
}

export function derivePosition(
  operation: EconomicOperation,
  asOf: string,
): Position | null {
  if (operation.acquired_quantity <= operation.disposed_quantity) {
    return null;
  }
  const openedAt =
    [...operation.acquisition_evidence]
      .sort((a, b) => a.observed_at.localeCompare(b.observed_at))
      .map((item) => item.observed_at)[0] ?? operation.created_at;
  const opened = Date.parse(openedAt);
  const current = Date.parse(asOf);
  return {
    position_id: "position:" + operation.operation_id,
    operation_id: operation.operation_id,
    type_id: operation.type_id,
    quantity: operation.acquired_quantity - operation.disposed_quantity,
    location: null,
    opened_at: openedAt,
    age_seconds:
      Number.isFinite(opened) && Number.isFinite(current) && current >= opened
        ? (current - opened) / 1000
        : null,
    state: "OPEN",
  };
}

