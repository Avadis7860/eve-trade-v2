import assert from "node:assert/strict";
import test from "node:test";
import { createEconomicOperation } from "@eve-trade/domain";
import { projectEconomicOperation, projectEconomicOperationDetail } from "../src/projection.js";
import type { EconomicOperationScope } from "@eve-trade/contracts";

const scope: EconomicOperationScope = {
  principal_scope: "PUBLIC",
  principal_id: null,
  character_id: null,
  provenance: null,
};

test("API projection preserves operation lifecycle, quantities, result and position boundary", () => {
  const operation = createEconomicOperation({
    operation_id: "operation-api-1",
    opportunity_id: "opportunity-1",
    type_id: 34,
    initial_quantity: 10,
    acquisition_mode: "TAKER_AGAINST_SELL",
    disposition_mode: "MAKER_SELL",
    scope,
    provenance: [],
    created_at: "2026-09-26T04:00:00Z",
  });
  const summary = projectEconomicOperation(operation);
  assert.equal(summary.contract_version, "phase-08.3");
  assert.equal(summary.operation_id, "operation-api-1");
  assert.equal(summary.remaining_quantity, 0);
  assert.equal(summary.lifecycle_state, "DETECTED");
  assert.equal(summary.disposition_mode, "MAKER_SELL");
  assert.equal(summary.position, null);

  const detail = projectEconomicOperationDetail(operation, [operation]);
  assert.equal(detail.history.length, 1);
  assert.equal(detail.operation.operation_id, "operation-api-1");
});
