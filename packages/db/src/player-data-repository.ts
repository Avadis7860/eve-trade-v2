import type {
  CanonicalPlayerState,
  PlayerComponent,
  PlayerDataKind,
  PlayerObservation,
  PlayerSync,
} from "@eve-trade/contracts";
import { Pool, type PoolClient } from "pg";

export interface PlayerSyncRecord {
  collection_id: string;
  character_id: number;
  observed_at: string;
  status: PlayerSync["status"];
}

export class PlayerDataRepository {
  constructor(private readonly pool: Pool) {}

  async createSync(sync: PlayerSyncRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO player_syncs (collection_id,character_id,observed_at,status) VALUES ($1,$2,$3,$4)",
      [sync.collection_id, sync.character_id, sync.observed_at, sync.status],
    );
  }

  async markSync(collectionId: string, status: PlayerSync["status"]): Promise<void> {
    await this.pool.query("UPDATE player_syncs SET status=$2 WHERE collection_id=$1", [collectionId, status]);
  }

  async saveObservation(observation: PlayerObservation): Promise<void> {
    await this.pool.query(
      "INSERT INTO player_observations " +
      "(observation_id,collection_id,character_id,data_kind,page_identity,observed_at,status,provenance,http_status,retry_count,records,raw_payload,headers,error) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
      [
        observation.observation_id,
        observation.collection_id,
        observation.character_id,
        observation.data_kind,
        observation.page_identity,
        observation.observed_at,
        observation.status,
        JSON.stringify(observation.provenance),
        observation.http_status,
        observation.retry_count,
        JSON.stringify(observation.records),
        JSON.stringify(observation.raw_payload),
        JSON.stringify(observation.headers),
        observation.error ? JSON.stringify(observation.error) : null,
      ],
    );
  }

  async listObservations(collectionId: string): Promise<PlayerObservation[]> {
    const result = await this.pool.query(
      "SELECT observation_id,collection_id,character_id,data_kind,page_identity,observed_at,status,provenance,http_status,retry_count,records,raw_payload,headers,error " +
      "FROM player_observations WHERE collection_id=$1 ORDER BY observation_sequence",
      [collectionId],
    );
    return result.rows.map((row) => ({
      observation_id: row.observation_id,
      collection_id: row.collection_id,
      character_id: Number(row.character_id),
      data_kind: row.data_kind,
      page_identity: row.page_identity,
      observed_at: new Date(row.observed_at).toISOString(),
      status: row.status,
      provenance: row.provenance,
      http_status: row.http_status,
      retry_count: row.retry_count,
      records: row.records,
      raw_payload: row.raw_payload,
      headers: row.headers,
      error: row.error,
    }));
  }

  async saveCanonical(state: CanonicalPlayerState): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const principal = state.principal;
      if (principal) {
        if (state.identity?.quality.availability === "COMPLETE" && principal.identity_observation_id) {
          await client.query(
            "INSERT INTO player_principals (character_id,name,corporation_id,identity_observation_id,observed_at,provenance) " +
            "VALUES ($1,$2,$3,$4,$5,$6) " +
            "ON CONFLICT (character_id) DO UPDATE SET name=EXCLUDED.name,corporation_id=EXCLUDED.corporation_id," +
            "identity_observation_id=EXCLUDED.identity_observation_id,observed_at=EXCLUDED.observed_at,provenance=EXCLUDED.provenance",
            [
              principal.character_id,
              principal.name,
              principal.corporation_id,
              principal.identity_observation_id,
              principal.observed_at,
              principal.provenance ? JSON.stringify(principal.provenance) : null,
            ],
          );
        } else {
          await client.query(
            "INSERT INTO player_principals (character_id) VALUES ($1) ON CONFLICT (character_id) DO NOTHING",
            [principal.character_id],
          );
        }
      }

      await this.saveComponentState(client, state.character_id, "WALLET_BALANCE", state.wallet);
      await this.saveComponentState(client, state.character_id, "WALLET_JOURNAL", state.journal);
      await this.saveComponentState(client, state.character_id, "WALLET_TRANSACTION", state.transactions);
      await this.saveComponentState(client, state.character_id, "ASSET", state.assets);
      await this.saveComponentState(client, state.character_id, "ACTIVE_ORDER", state.active_orders);

      if (state.wallet.quality.availability === "COMPLETE") {
        await client.query("DELETE FROM player_wallet_current WHERE character_id=$1", [state.character_id]);
        const balance = state.wallet.records?.[0];
        if (balance !== undefined) {
          const observationId = state.wallet.quality.observation_ids.at(-1);
          if (!observationId) throw new Error("Complete wallet state is missing observation provenance");
          await client.query(
            "INSERT INTO player_wallet_current (character_id,observation_id,observed_at,balance) VALUES ($1,$2,$3,$4)",
            [state.character_id, observationId, state.wallet.quality.observed_at, balance],
          );
        }
      }

      if (state.journal.quality.availability === "COMPLETE") {
        await client.query("DELETE FROM player_wallet_journal_current WHERE character_id=$1", [state.character_id]);
        for (const entry of state.journal.records ?? []) {
          const observationId = state.journal.quality.observation_ids.at(-1);
          if (!observationId || !state.journal.quality.observed_at) throw new Error("Complete journal state lacks provenance");
          await client.query(
            "INSERT INTO player_wallet_journal_current " +
            "(character_id,entry_id,observation_id,observed_at,entry_date,amount,balance,description,first_party_id,ref_type,second_party_id,context_id,context_id_type,reason,tax,tax_receiver_id) " +
            "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
            [state.character_id,entry.id,observationId,state.journal.quality.observed_at,entry.date,entry.amount,entry.balance,entry.description,entry.first_party_id,entry.ref_type,entry.second_party_id,entry.context_id ?? null,entry.context_id_type ?? null,entry.reason ?? null,entry.tax ?? null,entry.tax_receiver_id ?? null],
          );
        }
      }

      if (state.transactions.quality.availability === "COMPLETE") {
        await client.query("DELETE FROM player_wallet_transactions_current WHERE character_id=$1", [state.character_id]);
        for (const entry of state.transactions.records ?? []) {
          const observationId = state.transactions.quality.observation_ids.at(-1);
          if (!observationId || !state.transactions.quality.observed_at) throw new Error("Complete transaction state lacks provenance");
          await client.query(
            "INSERT INTO player_wallet_transactions_current " +
            "(character_id,transaction_id,observation_id,observed_at,transaction_date,client_id,is_buy,is_personal,journal_ref_id,location_id,quantity,type_id,unit_price) " +
            "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
            [state.character_id,entry.transaction_id,observationId,state.transactions.quality.observed_at,entry.date,entry.client_id,entry.is_buy,entry.is_personal,entry.journal_ref_id,entry.location_id,entry.quantity,entry.type_id,entry.unit_price],
          );
        }
      }

      if (state.assets.quality.availability === "COMPLETE") {
        await client.query("DELETE FROM player_assets_current WHERE character_id=$1", [state.character_id]);
        for (const asset of state.assets.records ?? []) {
          const observationId = state.assets.quality.observation_ids.at(-1);
          if (!observationId || !state.assets.quality.observed_at) throw new Error("Complete asset state lacks provenance");
          await client.query(
            "INSERT INTO player_assets_current " +
            "(character_id,item_id,observation_id,observed_at,location_flag,location_id,location_type,quantity,is_singleton,type_id) " +
            "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
            [state.character_id,asset.item_id,observationId,state.assets.quality.observed_at,asset.location_flag,asset.location_id,asset.location_type,asset.quantity,asset.is_singleton,asset.type_id],
          );
        }
      }

      if (state.active_orders.quality.availability === "COMPLETE") {
        await client.query("DELETE FROM player_active_orders_current WHERE character_id=$1", [state.character_id]);
        for (const order of state.active_orders.records ?? []) {
          const observationId = state.active_orders.quality.observation_ids.at(-1);
          if (!observationId || !state.active_orders.quality.observed_at) throw new Error("Complete order state lacks provenance");
          await client.query(
            "INSERT INTO player_active_orders_current " +
            "(character_id,order_id,observation_id,observed_at,duration,escrow,is_buy_order,issued,location_id,min_volume,price,order_range,system_id,type_id,volume_remain,volume_total) " +
            "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
            [state.character_id,order.order_id,observationId,state.active_orders.quality.observed_at,order.duration,order.escrow,order.is_buy_order,order.issued,order.location_id,order.min_volume,order.price,order.range,order.system_id,order.type_id,order.volume_remain,order.volume_total],
          );
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async saveComponentState(
    client: PoolClient,
    characterId: number,
    kind: Exclude<PlayerDataKind, "IDENTITY">,
    component: PlayerComponent<unknown>,
  ): Promise<void> {
    await client.query(
      "INSERT INTO player_component_states " +
      "(character_id,data_kind,availability,coverage,health,observed_at,fresh_until,observation_ids,error) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) " +
      "ON CONFLICT (character_id,data_kind) DO UPDATE SET availability=EXCLUDED.availability,coverage=EXCLUDED.coverage," +
      "health=EXCLUDED.health,observed_at=EXCLUDED.observed_at,fresh_until=EXCLUDED.fresh_until," +
      "observation_ids=EXCLUDED.observation_ids,error=EXCLUDED.error",
      [
        characterId,
        kind,
        component.quality.availability,
        component.quality.coverage,
        component.quality.health,
        component.quality.observed_at,
        component.quality.fresh_until,
        JSON.stringify(component.quality.observation_ids),
        component.quality.error ? JSON.stringify(component.quality.error) : null,
      ],
    );
  }
}
