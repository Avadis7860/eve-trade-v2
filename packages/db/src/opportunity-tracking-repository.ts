import type {
  OpportunityObservation,
  OpportunityOutcome,
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
        "provenance,observer,scenario_snapshot,analysis_result) " +
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
          observation.observer ? JSON.stringify(observation.observer) : null,
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
      "o.phase4_scenario_fingerprint,o.presence,o.freshness_state,o.provenance,o.observer," +
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
        observer: row.observer ?? null,
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
