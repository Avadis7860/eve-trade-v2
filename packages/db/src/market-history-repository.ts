import type {
  MarketDepthLevel,
  MarketHistoryBuildResult,
  MarketHistorySnapshot,
  MarketSnapshotTypeMetrics,
  MarketCollection,
  MarketPageObservation,
} from "@eve-trade/contracts";
import { Pool } from "pg";

export class MarketHistoryRepository {
  constructor(private readonly pool: Pool) {}

  async replace(result: MarketHistoryBuildResult): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM market_snapshot_depth_levels");
      await client.query("DELETE FROM market_snapshot_type_metrics");
      await client.query("DELETE FROM market_history_snapshots");

      for (const snapshot of result.snapshots) {
        await this.insertSnapshot(client, snapshot);
      }
      for (const metric of result.metrics) {
        await this.insertMetric(client, metric);
      }
      for (const level of result.depth_levels) {
        await this.insertDepth(client, level);
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listSnapshots(): Promise<MarketHistorySnapshot[]> {
    const result = await this.pool.query(
      "SELECT snapshot_id,collection_id,region_id,observed_at,status,comparison_eligible,state_fingerprint," +
      "source_last_modified,source_compatibility_date,source_consistency,observation_kind,previous_snapshot_id," +
      "source_pages,history_contract_version FROM market_history_snapshots ORDER BY observed_at,snapshot_id",
    );

    return result.rows.map((row) => ({
      snapshot_id: row.snapshot_id,
      collection_id: row.collection_id,
      region_id: Number(row.region_id),
      observed_at: new Date(row.observed_at).toISOString(),
      status: row.status,
      comparison_eligible: row.comparison_eligible,
      state_fingerprint: row.state_fingerprint,
      source_last_modified: row.source_last_modified,
      source_compatibility_date: row.source_compatibility_date,
      source_consistency: row.source_consistency,
      observation_kind: row.observation_kind,
      previous_snapshot_id: row.previous_snapshot_id,
      source_pages: row.source_pages === null ? null : Number(row.source_pages),
    })).map((snapshot) => ({ ...snapshot }));
  }

  private async insertSnapshot(client: { query: Pool["query"] }, snapshot: MarketHistorySnapshot): Promise<void> {
    await client.query(
      "INSERT INTO market_history_snapshots " +
      "(snapshot_id,collection_id,region_id,observed_at,status,comparison_eligible,state_fingerprint,source_last_modified," +
      "source_compatibility_date,source_consistency,observation_kind,previous_snapshot_id,source_pages,history_contract_version) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
      [
        snapshot.snapshot_id,
        snapshot.collection_id,
        snapshot.region_id,
        snapshot.observed_at,
        snapshot.status,
        snapshot.comparison_eligible,
        snapshot.state_fingerprint,
        snapshot.source_last_modified,
        snapshot.source_compatibility_date,
        snapshot.source_consistency,
        snapshot.observation_kind,
        snapshot.previous_snapshot_id,
        snapshot.source_pages,
        1,
      ],
    );
  }

  private async insertMetric(client: { query: Pool["query"] }, metric: MarketSnapshotTypeMetrics): Promise<void> {
    await client.query(
      "INSERT INTO market_snapshot_type_metrics " +
      "(snapshot_id,type_id,best_buy_price,best_buy_volume,best_sell_price,best_sell_volume,spread_absolute,spread_relative,buy_visible_volume,sell_visible_volume) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        metric.snapshot_id,
        metric.type_id,
        metric.best_buy_price,
        metric.best_buy_volume,
        metric.best_sell_price,
        metric.best_sell_volume,
        metric.spread_absolute,
        metric.spread_relative,
        metric.buy_visible_volume,
        metric.sell_visible_volume,
      ],
    );
  }

  private async insertDepth(client: { query: Pool["query"] }, level: MarketDepthLevel): Promise<void> {
    await client.query(
      "INSERT INTO market_snapshot_depth_levels " +
      "(snapshot_id,type_id,is_buy_order,price,volume_remain,order_count) VALUES ($1,$2,$3,$4,$5,$6)",
      [level.snapshot_id, level.type_id, level.is_buy_order, level.price, level.volume_remain, level.order_count],
    );
  }
}

export interface MarketHistorySource {
  listCollections(): Promise<MarketCollection[]>;
  loadPages(collectionId: string): Promise<MarketPageObservation[]>;
}
