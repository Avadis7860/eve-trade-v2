import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createApiHandler } from "../src/server.js";
import { createEconomicOperation } from "@eve-trade/domain";
import type { EconomicOperation } from "@eve-trade/contracts";
import type { OpportunityReadModel } from "../src/read-model.js";

const opportunityReader: OpportunityReadModel = {
  async listAllObservations() { return []; },
  async listObservations() { return []; },
};

function operation(
  operationId: string,
  principalScope: "PUBLIC" | "CHARACTER",
  principalId: number | null,
): EconomicOperation {
  return createEconomicOperation({
    operation_id: operationId,
    opportunity_id: null,
    type_id: 34,
    initial_quantity: 5,
    acquisition_mode: "TAKER_AGAINST_SELL",
    disposition_mode: "MAKER_SELL",
    scope: {
      principal_scope: principalScope,
      principal_id: principalId,
      character_id: principalScope === "CHARACTER" ? principalId : null,
      provenance: null,
    },
    provenance: [],
    created_at: "2026-09-26T04:00:00Z",
  });
}

test("operation API preserves scope isolation", async () => {
  const publicOperation = operation("op-public", "PUBLIC", null);
  const characterOperation = operation("op-character", "CHARACTER", 42);
  const operationReader = {
    async listAll() {
      return [publicOperation, characterOperation];
    },
    async get(operationId: string) {
      return operationId === publicOperation.operation_id
        ? publicOperation
        : operationId === characterOperation.operation_id
          ? characterOperation
          : null;
    },
    async listObservations(operationId: string) {
      const item = await this.get(operationId);
      return item ? [item] : [];
    },
  };

  const server = createServer(createApiHandler({
    reader: opportunityReader,
    operationReader,
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const publicResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/operations?principal_scope=PUBLIC`,
    );
    const publicPayload = await publicResponse.json();
    assert.equal(publicResponse.status, 200);
    assert.deepEqual(
      publicPayload.data.items.map((item: { operation_id: string }) => item.operation_id),
      ["op-public"],
    );

    const characterResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/operations?principal_scope=CHARACTER&principal_id=42`,
    );
    const characterPayload = await characterResponse.json();
    assert.equal(characterResponse.status, 403);
    assert.equal(characterPayload.error.code, "FORBIDDEN");

    const detailResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/operations/op-public?principal_scope=PUBLIC`,
    );
    const detailPayload = await detailResponse.json();
    assert.equal(detailResponse.status, 200);
    assert.equal(detailPayload.data.operation_id, "op-public");
    assert.equal(detailPayload.data.history.length, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
