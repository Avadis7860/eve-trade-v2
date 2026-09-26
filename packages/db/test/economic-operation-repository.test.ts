import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Pool } from "pg";
import { EconomicOperationRepository } from "../src/economic-operation-repository.js";
import type { EconomicEvidence } from "@eve-trade/contracts";

const databaseUrl = process.env.DATABASE_URL;
const migrations = [
  "001_market_ingestion.sql",
  "002_market_history.sql",
  "003_player_data.sql",
  "004_opportunity_tracking.sql",
  "006_remove_market_order_escrow.sql",
  "007_economic_operations.sql",
  "008_economic_operation_immutability.sql",
].map((name) =>
  join(dirname(fileURLToPath(import.meta.url)), "../../../database/migrations", name),
);

const provenance = {
  source_kind: "ESI" as const,
  source_id: "db-test",
  endpoint: "/characters/1/transactions/",
  principal_scope: "CHARACTER" as const,
  principal_id: 1,
};

const evidence: EconomicEvidence = {
  evidence_id: "tx-1",
  kind: "TRANSACTION",
  observed_at: "2026-09-26T04:10:00Z",
  quantity: 5,
  unit_price: 100,
  value: 500,
  order_id: null,
  transaction_id: 7001,
  issuer: null,
  provenance,
};

test("persists economic operation snapshots idempotently and preserves history", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    for (const path of migrations) await pool.query(await readFile(path, "utf8"));
    await pool.query("TRUNCATE economic_operation_observations, economic_operations CASCADE");

    const repository = new EconomicOperationRepository(pool);
    let operation = {
      operation_id: "operation-db-1",
      contract_version: "phase-08.3" as const,
      opportunity_id: "opportunity-1",
      type_id: 34,
      initial_quantity: 5,
      acquired_quantity: 5,
      unacquired_quantity: 0,
      disposed_quantity: 0,
      remaining_quantity: 5,
      lifecycle_state: "OPEN" as const,
      evaluation_state: "ECONOMICALLY_EVALUABLE" as const,
      acquisition_mode: "TAKER_AGAINST_SELL" as const,
      disposition_mode: "TAKER_AGAINST_BUY" as const,
      acquisition_evidence: [{
        record_id: "acq-1",
        execution_state: "OBSERVED" as const,
        observed_at: "2026-09-26T04:02:00Z",
        quantity: 5,
        cost: 500,
        evidence: [evidence],
        provenance: [provenance],
      }],
      disposition_evidence: [],
      projected_disposition: null,
      position: {
        position_id: "position:operation-db-1",
        operation_id: "operation-db-1",
        type_id: 34,
        quantity: 5,
        location: null,
        opened_at: "2026-09-26T04:00:00Z",
        age_seconds: null,
        state: "OPEN" as const,
      },
      result: {
        evaluation_state: "ECONOMICALLY_EVALUABLE" as const,
        observed_sub_result: 0,
        observed_current_result: -500,
        projected_current_result: null,
        terminal_result: null,
        observed_current_return: -1,
        projected_current_return: null,
        terminal_return: null,
        known_acquisition_cost: 500,
        known_disposition_proceeds: 0,
        known_fees: 0,
        known_logistics: 0,
        remaining_quantity: 5,
      },
      scope: {
        principal_scope: "CHARACTER" as const,
        principal_id: 1,
        character_id: 1,
        provenance,
      },
      provenance: [provenance],
      created_at: "2026-09-26T04:00:00Z",
      updated_at: "2026-09-26T04:02:00Z",
    };


    await repository.save(operation, "operation-observation-1");
    await repository.save(operation, "operation-observation-1");

    const updatedObservation = {
      ...operation,
      updated_at: "2026-09-26T04:20:00Z",
      result: {
        ...operation.result,
        observed_current_result: -450,
        remaining_quantity: 5,
      },
    };
    await repository.save(updatedObservation, "operation-observation-2");

    const current = await repository.get("operation-db-1");
    assert.equal(current?.operation_id, "operation-db-1");
    assert.equal(current?.lifecycle_state, "OPEN");
    assert.equal(current?.remaining_quantity, 5);
    assert.equal(current?.updated_at, "2026-09-26T04:02:00.000Z");

    const history = await repository.listObservations("operation-db-1");
    assert.equal(history.length, 2);

    const list = await repository.listAll();
    assert.equal(list.length, 1);

    await assert.rejects(
      pool.query(
        "UPDATE economic_operations SET disposition_mode='MAKER_SELL' WHERE operation_id='operation-db-1'",
      ),
      /append-only/,
    );
    await assert.rejects(
      pool.query(
        "UPDATE economic_operation_observations SET lifecycle_state='COMPLETED' WHERE observation_id='operation-observation-2'",
      ),
      /append-only/,
    );
    await assert.rejects(
      pool.query(
        "DELETE FROM economic_operation_observations WHERE observation_id='operation-observation-2'",
      ),
      /append-only/,
    );
    await assert.rejects(
      pool.query(
        "DELETE FROM economic_operations WHERE operation_id='operation-db-1'",
      ),
      /append-only/,
    );
  } finally {
    await pool.end();
  }
});
