import assert from "node:assert/strict";
import test from "node:test";
import {
  createEconomicOperation,
  derivePosition,
  planAcquisition,
  projectMakerSellDisposition,
  recordObservedAcquisition,
  recordObservedDisposition,
} from "../src/economic-operation.js";
import type { EconomicEvidence } from "@eve-trade/contracts";

const provenance = {
  source_kind: "ESI" as const,
  source_id: "player-test",
  endpoint: "/characters/1/wallet/",
  principal_scope: "CHARACTER" as const,
  principal_id: 1,
};

const evidence = (id: string, kind: EconomicEvidence["kind"], quantity: number): EconomicEvidence => ({
  evidence_id: id,
  kind,
  observed_at: "2026-09-26T04:00:00Z",
  quantity,
  unit_price: 100,
  value: quantity * 100,
  order_id: kind === "ORDER" ? 9001 : null,
  transaction_id: kind === "TRANSACTION" ? 7001 : null,
  issuer: null,
  provenance,
});

function operation(quantity = 10_000) {
  return createEconomicOperation({
    operation_id: "operation-1",
    opportunity_id: "opportunity-1",
    type_id: 34,
    initial_quantity: quantity,
    acquisition_mode: "TAKER_AGAINST_SELL",
    disposition_mode: "MAKER_SELL",
    scope: {
      principal_scope: "CHARACTER",
      principal_id: 1,
      character_id: 1,
      provenance,
    },
    provenance: [provenance],
    created_at: "2026-09-26T04:00:00Z",
  });
}

test("operation identity and lifecycle are independent of order evidence", () => {
  const created = operation();
  const planned = planAcquisition(created, "2026-09-26T04:01:00Z");
  assert.equal(planned.operation_id, "operation-1");
  assert.equal(planned.lifecycle_state, "ACQUISITION_PLANNED");
  assert.equal(planned.state_kind, "PLANNED");

  const acquired = recordObservedAcquisition(planned, {
    record_id: "acq-1",
    observed_at: "2026-09-26T04:02:00Z",
    quantity: 10_000,
    cost: 1_000_000,
    evidence: [evidence("order-9001", "ORDER", 10_000)],
    provenance: [provenance],
  });
  assert.equal(acquired.lifecycle_state, "OPEN");
  assert.equal(acquired.acquired_quantity, 10_000);
  assert.equal(acquired.remaining_quantity, 10_000);
  assert.equal(acquired.position?.quantity, 10_000);
  assert.equal(acquired.position?.operation_id, "operation-1");
  assert.equal(acquired.state_kind, "OBSERVED");
});

test("a positive sub-result does not complete a 10000-unit operation after one disposition", () => {
  const acquired = recordObservedAcquisition(operation(), {
    record_id: "acq-1",
    observed_at: "2026-09-26T04:02:00Z",
    quantity: 10_000,
    cost: 1_000_000,
    evidence: [evidence("order-9001", "ORDER", 10_000)],
    provenance: [provenance],
  });
  const partial = recordObservedDisposition(acquired, {
    record_id: "disp-1",
    observed_at: "2026-09-26T04:10:00Z",
    quantity: 1,
    proceeds: 110,
    disposed_cost_basis: 100,
    fees: 0,
    logistics: 0,
    evidence: [evidence("tx-7001", "TRANSACTION", 1)],
    provenance: [provenance],
  });

  assert.equal(partial.disposed_quantity, 1);
  assert.equal(partial.remaining_quantity, 9_999);
  assert.equal(partial.lifecycle_state, "PARTIALLY_DISPOSED");
  assert.equal(partial.result.observed_sub_result, 10);
  assert.equal(partial.result.terminal_result, null);
  assert.equal(partial.position?.quantity, 9_999);
  assert.equal(partial.result.observed_current_result, -999_890);
});

test("projected maker sell is visibly distinct from observed execution", () => {
  const acquired = recordObservedAcquisition(operation(100), {
    record_id: "acq-1",
    observed_at: "2026-09-26T04:02:00Z",
    quantity: 100,
    cost: 10_000,
    evidence: [evidence("order-9001", "ORDER", 100)],
    provenance: [provenance],
  });
  const projected = projectMakerSellDisposition(acquired, {
    projected_at: "2026-09-26T04:03:00Z",
    quantity: 100,
    unit_price: 120,
    projected_fees: 6,
    projected_logistics: 0,
    provenance: [provenance],
  });

  assert.equal(projected.disposition_evidence.length, 0);
  assert.equal(projected.projected_disposition?.execution_state, "PROJECTED");
  assert.equal(projected.projected_disposition?.projected_proceeds, 12_000);
  assert.equal(projected.result.projected_current_result, 1_994);
  assert.equal(projected.lifecycle_state, "OPEN");
  assert.equal(projected.state_kind, "PROJECTED");
});

test("terminal result exists only after full observed disposition", () => {
  const acquired = recordObservedAcquisition(operation(100), {
    record_id: "acq-1",
    observed_at: "2026-09-26T04:02:00Z",
    quantity: 100,
    cost: 10_000,
    evidence: [evidence("order-9001", "ORDER", 100)],
    provenance: [provenance],
  });
  const completed = recordObservedDisposition(acquired, {
    record_id: "disp-1",
    observed_at: "2026-09-26T04:10:00Z",
    quantity: 100,
    proceeds: 12_000,
    disposed_cost_basis: 10_000,
    fees: 120,
    logistics: 0,
    evidence: [evidence("tx-7001", "TRANSACTION", 100)],
    provenance: [provenance],
  });

  assert.equal(completed.lifecycle_state, "COMPLETED");
  assert.equal(completed.remaining_quantity, 0);
  assert.equal(completed.result.observed_current_result, 1_880);
  assert.equal(completed.result.terminal_result, 1_880);
  assert.equal(completed.result.terminal_return, 0.188);
  assert.equal(completed.position, null);
});

test("unknown acquisition cost keeps economic evaluation explicit", () => {
  const acquired = recordObservedAcquisition(operation(10), {
    record_id: "acq-unknown",
    observed_at: "2026-09-26T04:02:00Z",
    quantity: 10,
    cost: null,
    evidence: [evidence("asset-1", "ASSET", 10)],
    provenance: [provenance],
  });

  assert.equal(acquired.evaluation_state, "ECONOMICALLY_UNAVAILABLE");
  assert.equal(acquired.result.known_acquisition_cost, null);
  assert.equal(acquired.result.observed_current_result, null);
});

test("position duration remains a derived observation and never changes operation identity", () => {
  const acquired = recordObservedAcquisition(operation(10), {
    record_id: "acq-1",
    observed_at: "2026-09-26T04:02:00Z",
    quantity: 10,
    cost: 1000,
    evidence: [evidence("order-9001", "ORDER", 10)],
    provenance: [provenance],
  });
  const position = derivePosition(acquired, "2026-09-26T05:02:00Z");
  assert.equal(position?.position_id, "position:operation-1");
  assert.equal(position?.age_seconds, 3600);
});


test("partial acquisition remains non-terminal even when all acquired units are disposed", () => {
  const created = operation(10);
  const acquired = recordObservedAcquisition(created, {
    record_id: "acq-partial",
    observed_at: "2026-09-26T04:02:00Z",
    quantity: 5,
    cost: 500,
    evidence: [evidence("order-partial", "ORDER", 5)],
    provenance: [provenance],
  });
  const disposed = recordObservedDisposition(acquired, {
    record_id: "disp-partial",
    observed_at: "2026-09-26T04:10:00Z",
    quantity: 5,
    proceeds: 600,
    disposed_cost_basis: 500,
    fees: 0,
    logistics: 0,
    evidence: [evidence("tx-partial", "TRANSACTION", 5)],
    provenance: [provenance],
  });

  assert.equal(disposed.remaining_quantity, 0);
  assert.equal(disposed.lifecycle_state, "PARTIALLY_DISPOSED");
  assert.equal(disposed.result.terminal_result, null);
  assert.equal(disposed.position, null);
});

test("a partial projected disposition does not masquerade as the whole-operation result", () => {
  const acquired = recordObservedAcquisition(operation(100), {
    record_id: "acq-1",
    observed_at: "2026-09-26T04:02:00Z",
    quantity: 100,
    cost: 10_000,
    evidence: [evidence("order-9001", "ORDER", 100)],
    provenance: [provenance],
  });
  const projected = projectMakerSellDisposition(acquired, {
    projected_at: "2026-09-26T04:03:00Z",
    quantity: 1,
    unit_price: 120,
    projected_fees: 1,
    projected_logistics: 0,
    provenance: [provenance],
  });

  assert.equal(projected.projected_disposition?.projected_proceeds, 120);
  assert.equal(projected.result.projected_current_result, null);
});


test("remaining projection preserves already observed disposition economics", () => {
  const acquired = recordObservedAcquisition(operation(10), {
    record_id: "acq-proj",
    observed_at: "2026-09-26T04:02:00Z",
    quantity: 10,
    cost: 1_000,
    evidence: [evidence("order-proj", "ORDER", 10)],
    provenance: [provenance],
  });
  const partial = recordObservedDisposition(acquired, {
    record_id: "disp-proj",
    observed_at: "2026-09-26T04:10:00Z",
    quantity: 1,
    proceeds: 110,
    disposed_cost_basis: 100,
    fees: 0,
    logistics: 0,
    evidence: [evidence("tx-proj", "TRANSACTION", 1)],
    provenance: [provenance],
  });
  const projected = projectMakerSellDisposition(partial, {
    projected_at: "2026-09-26T04:11:00Z",
    quantity: 9,
    unit_price: 120,
    projected_fees: 10,
    projected_logistics: 0,
    provenance: [provenance],
  });

  assert.equal(projected.result.projected_current_result, 180);
  assert.equal(projected.lifecycle_state, "PARTIALLY_DISPOSED");
});
