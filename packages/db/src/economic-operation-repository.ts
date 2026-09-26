import type { EconomicOperation } from "@eve-trade/contracts";
import { Pool } from "pg";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function sameParent(row: Record<string, unknown>, operation: EconomicOperation): boolean {
  return (
    row.opportunity_id === operation.opportunity_id &&
    Number(row.type_id) === operation.type_id &&
    Number(row.initial_quantity) === operation.initial_quantity &&
    row.acquisition_mode === operation.acquisition_mode &&
    row.disposition_mode === operation.disposition_mode &&
    sameJson(row.scope, operation.scope) &&
    sameJson(row.provenance, operation.provenance) &&
    new Date(row.created_at as string).toISOString() ===
      new Date(operation.created_at).toISOString()
  );
}

export class EconomicOperationRepository {
  constructor(private readonly pool: Pool) {}

  async save(operation: EconomicOperation, observationId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO economic_operations " +
        "(operation_id,opportunity_id,type_id,initial_quantity,acquisition_mode,disposition_mode,scope,provenance,created_at,updated_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) " +
        "ON CONFLICT (operation_id) DO NOTHING",
        [
          operation.operation_id,
          operation.opportunity_id,
          operation.type_id,
          operation.initial_quantity,
          operation.acquisition_mode,
          operation.disposition_mode,
          JSON.stringify(operation.scope),
          JSON.stringify(operation.provenance),
          operation.created_at,
          operation.updated_at,
        ],
      );

      const parent = await client.query(
        "SELECT opportunity_id,type_id,initial_quantity,acquisition_mode,disposition_mode,scope,provenance,created_at " +
        "FROM economic_operations WHERE operation_id=$1",
        [operation.operation_id],
      );
      const row = parent.rows[0];
      if (!row || !sameParent(row, operation)) {
        throw new Error(
          "economic operation identity conflict: immutable operation metadata differs",
        );
      }

      const canonicalEvidence = [
        ...operation.acquisition_evidence.flatMap((item) => item.evidence),
        ...operation.disposition_evidence.flatMap((item) => item.evidence),
      ];
      const canonicalObservation = {
        operation_id: operation.operation_id,
        observed_at: new Date(operation.updated_at).toISOString(),
        lifecycle_state: operation.lifecycle_state,
        evaluation_state: operation.evaluation_state,
        acquired_quantity: operation.acquired_quantity,
        disposed_quantity: operation.disposed_quantity,
        remaining_quantity: operation.remaining_quantity,
        operation_state: operation,
        evidence: canonicalEvidence,
        provenance: operation.provenance,
      };

      await client.query(
        "INSERT INTO economic_operation_observations " +
        "(observation_id,operation_id,observed_at,lifecycle_state,evaluation_state,acquired_quantity,disposed_quantity,remaining_quantity,operation_state,evidence,provenance) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) " +
        "ON CONFLICT (observation_id) DO NOTHING",
        [
          observationId,
          canonicalObservation.operation_id,
          operation.updated_at,
          canonicalObservation.lifecycle_state,
          canonicalObservation.evaluation_state,
          canonicalObservation.acquired_quantity,
          canonicalObservation.disposed_quantity,
          canonicalObservation.remaining_quantity,
          JSON.stringify(canonicalObservation.operation_state),
          JSON.stringify(canonicalObservation.evidence),
          JSON.stringify(canonicalObservation.provenance),
        ],
      );

      const existingObservation = await client.query(
        "SELECT operation_id,observed_at,lifecycle_state,evaluation_state,acquired_quantity,disposed_quantity,remaining_quantity,operation_state,evidence,provenance " +
        "FROM economic_operation_observations WHERE observation_id=$1",
        [observationId],
      );
      const observationRow = existingObservation.rows[0];
      const persistedObservation = observationRow
        ? {
            operation_id: observationRow.operation_id,
            observed_at: new Date(observationRow.observed_at).toISOString(),
            lifecycle_state: observationRow.lifecycle_state,
            evaluation_state: observationRow.evaluation_state,
            acquired_quantity: Number(observationRow.acquired_quantity),
            disposed_quantity: Number(observationRow.disposed_quantity),
            remaining_quantity: Number(observationRow.remaining_quantity),
            operation_state: observationRow.operation_state,
            evidence: observationRow.evidence,
            provenance: observationRow.provenance,
          }
        : null;

      if (!persistedObservation || !sameJson(persistedObservation, canonicalObservation)) {
        throw new Error(
          "economic operation observation conflict: observation_id already exists with different canonical payload",
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async get(operationId: string): Promise<EconomicOperation | null> {
    const result = await this.pool.query(
      "SELECT operation_state FROM economic_operation_observations " +
      "WHERE operation_id=$1 ORDER BY observed_at DESC, observation_id DESC LIMIT 1",
      [operationId],
    );
    return result.rows[0]?.operation_state ?? null;
  }

  async listAll(): Promise<EconomicOperation[]> {
    const result = await this.pool.query(
      "SELECT DISTINCT ON (operation_id) operation_state " +
      "FROM economic_operation_observations " +
      "ORDER BY operation_id, observed_at DESC, observation_id DESC",
    );
    return result.rows.map((row) => row.operation_state as EconomicOperation);
  }

  async listObservations(operationId: string): Promise<EconomicOperation[]> {
    const result = await this.pool.query(
      "SELECT operation_state FROM economic_operation_observations " +
      "WHERE operation_id=$1 ORDER BY observed_at, observation_id",
      [operationId],
    );
    return result.rows.map((row) => row.operation_state as EconomicOperation);
  }
}
