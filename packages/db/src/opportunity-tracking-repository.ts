import type {
  OpportunityObservation,
  OpportunityOutcome,
  OpportunityPipelineRun,
} from "@eve-trade/contracts";
import { OPPORTUNITY_TRACKING_CONTRACT_VERSION } from "@eve-trade/contracts";
import { Pool } from "pg";

export class OpportunityTrackingRepository {
  constructor(private readonly pool: Pool) {}

  async saveObservation(observation: OpportunityObservation): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        "INSERT INTO opportunities " +
        "(opportunity_id,identity_contract_version,identity_payload) " +
        "VALUES ($1,$2,$3) " +
        "ON CONFLICT (opportunity_id) DO NOTHING",
        [
          observation.opportunity_id,
          observation.identity.contract_version,
          JSON.stringify(observation.identity.payload),
        ],
      );

      await client.query(
        "INSERT INTO opportunity_observations " +
        "(observation_id,opportunity_id,observed_at,phase4_contract_version,phase4_scenario_fingerprint," +
        "presence,freshness_state,type_id,requested_quantity,acquisition_source," +
        "origin_region_id,origin_system_id,origin_location_id,destination_region_id,destination_system_id,destination_location_id," +
        "acquisition_snapshot_id,disposition_snapshot_id,acquisition_order_ids,disposition_order_ids," +
        "provenance,observation_scope,scenario_snapshot,analysis_result) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) " +
        "ON CONFLICT (observation_id) DO NOTHING",
        [
          observation.observation_id,
          observation.opportunity_id,
          observation.observed_at,
          observation.phase4_contract_version,
          observation.phase4_scenario_fingerprint,
          observation.presence,
          observation.freshness_state,
          observation.identity.payload.type_id,
          observation.identity.payload.requested_quantity,
          observation.identity.payload.acquisition_source,
          observation.identity.payload.origin.region_id,
          observation.identity.payload.origin.system_id,
          observation.identity.payload.origin.location_id,
          observation.identity.payload.destination.region_id,
          observation.identity.payload.destination.system_id,
          observation.identity.payload.destination.location_id,
          observation.market_snapshot_ids.acquisition,
          observation.market_snapshot_ids.disposition,
          observation.order_ids.acquisition,
          observation.order_ids.disposition,
          JSON.stringify(observation.provenance),
          JSON.stringify(observation.scope),
          JSON.stringify(observation.scenario_snapshot),
          JSON.stringify(observation.phase4_result),
        ],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async savePipelineRun(run: OpportunityPipelineRun): Promise<void> {
    await this.pool.query(
      "INSERT INTO opportunity_pipeline_runs " +
      "(run_id,region_id,market_collection_id,observed_at,completed_at,status,candidates_generated,analyses_produced,observations_persisted,economic_operations_created,economic_operation_observations_persisted,error) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) " +
      "ON CONFLICT (run_id) DO UPDATE SET " +
      "region_id=EXCLUDED.region_id,market_collection_id=EXCLUDED.market_collection_id,observed_at=EXCLUDED.observed_at," +
      "completed_at=EXCLUDED.completed_at,status=EXCLUDED.status,candidates_generated=EXCLUDED.candidates_generated," +
      "analyses_produced=EXCLUDED.analyses_produced,observations_persisted=EXCLUDED.observations_persisted,economic_operations_created=EXCLUDED.economic_operations_created,economic_operation_observations_persisted=EXCLUDED.economic_operation_observations_persisted,error=EXCLUDED.error",
      [
        run.run_id,
        run.region_id,
        run.market_collection_id,
        run.observed_at,
        run.completed_at,
        run.status,
        run.candidates_generated,
        run.analyses_produced,
        run.observations_persisted,
        run.economic_operations_created ?? 0,
        run.economic_operation_observations_persisted ?? 0,
        run.error ? JSON.stringify(run.error) : null,
      ],
    );
  }

  async getLatestPipelineRun(): Promise<OpportunityPipelineRun | null> {
    const result = await this.pool.query(
      "SELECT run_id,region_id,market_collection_id,observed_at,completed_at,status," +
      "candidates_generated,analyses_produced,observations_persisted,economic_operations_created,economic_operation_observations_persisted,error " +
      "FROM opportunity_pipeline_runs ORDER BY observed_at DESC,run_id DESC LIMIT 1",
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      run_id: row.run_id,
      region_id: Number(row.region_id),
      market_collection_id: row.market_collection_id,
      observed_at: new Date(row.observed_at).toISOString(),
      completed_at: row.completed_at === null ? null : new Date(row.completed_at).toISOString(),
      status: row.status,
      candidates_generated: Number(row.candidates_generated),
      analyses_produced: Number(row.analyses_produced),
      observations_persisted: Number(row.observations_persisted),
      economic_operations_created: Number(row.economic_operations_created ?? 0),
      economic_operation_observations_persisted: Number(row.economic_operation_observations_persisted ?? 0),
      error: row.error ?? null,
    };
  }

  async saveOutcome(outcome: OpportunityOutcome): Promise<void> {
    await this.pool.query(
      "INSERT INTO opportunity_outcomes " +
      "(outcome_id,opportunity_id,observed_at,status,evidence_coverage,expected_quantity,observed_quantity,evidence,observed_subresult) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) " +
      "ON CONFLICT (outcome_id) DO NOTHING",
      [
        outcome.outcome_id,
        outcome.opportunity_id,
        outcome.observed_at,
        outcome.status,
        outcome.evidence_coverage,
        outcome.expected_quantity,
        outcome.observed_quantity,
        JSON.stringify(outcome.evidence),
        outcome.observed_subresult === null
          ? null
          : JSON.stringify(outcome.observed_subresult),
      ],
    );
  }

  async listObservations(opportunityId: string): Promise<OpportunityObservation[]> {
    const result = await this.pool.query(
      "SELECT o.observation_id,o.opportunity_id,o.observed_at,o.phase4_contract_version," +
      "o.phase4_scenario_fingerprint,o.presence,o.freshness_state,o.provenance,o.observation_scope," +
      "o.scenario_snapshot,o.analysis_result,t.identity_contract_version,t.identity_payload " +
      "FROM opportunity_observations o " +
      "JOIN opportunities t ON t.opportunity_id=o.opportunity_id " +
      "WHERE o.opportunity_id=$1 ORDER BY o.observed_at,o.observation_id",
      [opportunityId],
    );

    return result.rows.map((row) => {
      const resultValue = row.analysis_result as OpportunityObservation["phase4_result"];
      return {
        opportunity_id: row.opportunity_id,
        observation_id: row.observation_id,
        observed_at: new Date(row.observed_at).toISOString(),
        identity: {
          opportunity_id: row.opportunity_id,
          contract_version: row.identity_contract_version,
          payload: row.identity_payload,
        },
        scenario_snapshot: row.scenario_snapshot,
        phase4_contract_version: row.phase4_contract_version,
        phase4_scenario_fingerprint: row.phase4_scenario_fingerprint,
        presence: row.presence,
        freshness_state: row.freshness_state,
        phase4_result: resultValue,
        market_snapshot_ids: {
          acquisition: resultValue.market_evidence.acquisition_snapshot_id,
          disposition: resultValue.market_evidence.disposition_snapshot_id,
        },
        order_ids: {
          acquisition: [...resultValue.market_evidence.acquisition_order_ids],
          disposition: [...resultValue.market_evidence.disposition_order_ids],
        },
        provenance: row.provenance ?? [],
        scope: row.observation_scope,
      };
    });
  }

  async listAllObservations(): Promise<OpportunityObservation[]> {
    const result = await this.pool.query(
      "SELECT o.observation_id,o.opportunity_id,o.observed_at,o.phase4_contract_version," +
      "o.phase4_scenario_fingerprint,o.presence,o.freshness_state,o.provenance,o.observation_scope," +
      "o.scenario_snapshot,o.analysis_result,t.identity_contract_version,t.identity_payload " +
      "FROM opportunity_observations o " +
      "JOIN opportunities t ON t.opportunity_id=o.opportunity_id " +
      "ORDER BY o.observed_at,o.observation_id",
    );

    return result.rows.map((row) => {
      const resultValue = row.analysis_result as OpportunityObservation["phase4_result"];
      return {
        opportunity_id: row.opportunity_id,
        observation_id: row.observation_id,
        observed_at: new Date(row.observed_at).toISOString(),
        identity: {
          opportunity_id: row.opportunity_id,
          contract_version: row.identity_contract_version,
          payload: row.identity_payload,
        },
        scenario_snapshot: row.scenario_snapshot,
        phase4_contract_version: row.phase4_contract_version,
        phase4_scenario_fingerprint: row.phase4_scenario_fingerprint,
        presence: row.presence,
        freshness_state: row.freshness_state,
        phase4_result: resultValue,
        market_snapshot_ids: {
          acquisition: resultValue.market_evidence.acquisition_snapshot_id,
          disposition: resultValue.market_evidence.disposition_snapshot_id,
        },
        order_ids: {
          acquisition: [...resultValue.market_evidence.acquisition_order_ids],
          disposition: [...resultValue.market_evidence.disposition_order_ids],
        },
        provenance: row.provenance ?? [],
        scope: row.observation_scope,
      };
    });
  }

  async listOutcomes(opportunityId: string): Promise<OpportunityOutcome[]> {
    const result = await this.pool.query(
      "SELECT outcome_id,opportunity_id,observed_at,status,evidence_coverage,expected_quantity," +
      "observed_quantity,evidence,observed_subresult FROM opportunity_outcomes " +
      "WHERE opportunity_id=$1 ORDER BY observed_at,outcome_id",
      [opportunityId],
    );
    return result.rows.map((row) => ({
      opportunity_id: row.opportunity_id,
      outcome_id: row.outcome_id,
      observed_at: new Date(row.observed_at).toISOString(),
      status: row.status,
      evidence_coverage: row.evidence_coverage,
      expected_quantity: row.expected_quantity === null ? null : Number(row.expected_quantity),
      observed_quantity: row.observed_quantity === null ? null : Number(row.observed_quantity),
      evidence: row.evidence ?? [],
      observed_subresult: row.observed_subresult ?? null,
    }));
  }

  async listAllOutcomes(): Promise<OpportunityOutcome[]> {
    const result = await this.pool.query(
      "SELECT outcome_id,opportunity_id,observed_at,status,evidence_coverage,expected_quantity," +
      "observed_quantity,evidence,observed_subresult FROM opportunity_outcomes " +
      "ORDER BY observed_at,outcome_id",
    );
    return result.rows.map((row) => ({
      opportunity_id: row.opportunity_id,
      outcome_id: row.outcome_id,
      observed_at: new Date(row.observed_at).toISOString(),
      status: row.status,
      evidence_coverage: row.evidence_coverage,
      expected_quantity: row.expected_quantity === null ? null : Number(row.expected_quantity),
      observed_quantity: row.observed_quantity === null ? null : Number(row.observed_quantity),
      evidence: row.evidence ?? [],
      observed_subresult: row.observed_subresult ?? null,
    }));
  }

  async getOpportunityIdentity(opportunityId: string): Promise<OpportunityObservation["identity"] | null> {
    const result = await this.pool.query(
      "SELECT opportunity_id,identity_contract_version,identity_payload FROM opportunities WHERE opportunity_id=$1",
      [opportunityId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      opportunity_id: row.opportunity_id,
      contract_version: row.identity_contract_version,
      payload: row.identity_payload,
    };
  }
}
