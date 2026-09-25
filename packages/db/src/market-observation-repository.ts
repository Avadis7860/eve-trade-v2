import type {
  CanonicalMarketState,
  MarketCollection,
  MarketPageObservation,
} from "@eve-trade/contracts";
import { Pool } from "pg";

export class MarketObservationRepository {
  constructor(private readonly pool: Pool) {}

  async createCollection(collection: MarketCollection): Promise<void> {
    await this.pool.query(
      "INSERT INTO market_collections " +
      "(collection_id, region_id, observed_at, expected_pages, status, provenance, cache_last_modified, cache_consistency, error) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [collection.collection_id, collection.region_id, collection.observed_at, collection.expected_pages, collection.status,
       JSON.stringify(collection.provenance), collection.cache_last_modified, collection.cache_consistency,
       collection.error ? JSON.stringify(collection.error) : null],
    );
  }

  async savePage(observation: MarketPageObservation): Promise<void> {
    await this.pool.query(
      "INSERT INTO market_page_observations " +
      "(collection_id, region_id, page, total_pages, observed_at, status, provenance, http_status, retry_count, records, raw_payload, headers, error) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) " +
      "ON CONFLICT (collection_id, page) DO UPDATE SET total_pages=EXCLUDED.total_pages, observed_at=EXCLUDED.observed_at, " +
      "status=EXCLUDED.status, http_status=EXCLUDED.http_status, retry_count=EXCLUDED.retry_count, records=EXCLUDED.records, " +
      "raw_payload=EXCLUDED.raw_payload, headers=EXCLUDED.headers, error=EXCLUDED.error",
      [observation.collection_id, observation.region_id, observation.page, observation.total_pages, observation.observed_at,
       observation.status, JSON.stringify(observation.provenance), observation.http_status, observation.retry_count,
       JSON.stringify(observation.records), JSON.stringify(observation.raw_payload), JSON.stringify(observation.headers),
       observation.error ? JSON.stringify(observation.error) : null],
    );
  }

  async markCollection(
    collectionId: string,
    update: Pick<MarketCollection, "expected_pages" | "status" | "cache_last_modified" | "cache_consistency" | "error">,
  ): Promise<void> {
    await this.pool.query(
      "UPDATE market_collections SET expected_pages=$2,status=$3,cache_last_modified=$4,cache_consistency=$5,error=$6,updated_at=NOW() WHERE collection_id=$1",
      [collectionId, update.expected_pages, update.status, update.cache_last_modified, update.cache_consistency,
       update.error ? JSON.stringify(update.error) : null],
    );
  }

  async getCollection(collectionId: string): Promise<MarketCollection | null> {
    const result = await this.pool.query(
      "SELECT collection_id,region_id,observed_at,expected_pages,status,provenance,cache_last_modified,cache_consistency,error " +
      "FROM market_collections WHERE collection_id=$1", [collectionId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      collection_id: row.collection_id,
      region_id: row.region_id,
      observed_at: new Date(row.observed_at).toISOString(),
      expected_pages: row.expected_pages,
      completed_pages: await this.completedPages(collectionId),
      status: row.status,
      provenance: row.provenance,
      cache_last_modified: row.cache_last_modified,
      cache_consistency: row.cache_consistency,
      error: row.error,
    };
  }

  async loadPages(collectionId: string): Promise<MarketPageObservation[]> {
    const result = await this.pool.query(
      "SELECT collection_id,region_id,page,total_pages,observed_at,status,provenance,http_status,retry_count,records,raw_payload,headers,error " +
      "FROM market_page_observations WHERE collection_id=$1 ORDER BY page", [collectionId],
    );
    return result.rows.map((row) => ({
      collection_id: row.collection_id, region_id: row.region_id, page: row.page, total_pages: row.total_pages,
      observed_at: new Date(row.observed_at).toISOString(), status: row.status, provenance: row.provenance,
      http_status: row.http_status, retry_count: row.retry_count, records: row.records, raw_payload: row.raw_payload,
      headers: row.headers, error: row.error,
    }));
  }

  async saveCanonical(state: CanonicalMarketState): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO canonical_market_states " +
        "(collection_id, region_id, observed_at, status, provenance, source_pages, duplicate_order_count, cache_last_modified, cache_consistency) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) " +
        "ON CONFLICT (collection_id) DO UPDATE SET observed_at=EXCLUDED.observed_at,status=EXCLUDED.status,provenance=EXCLUDED.provenance," +
        "source_pages=EXCLUDED.source_pages,duplicate_order_count=EXCLUDED.duplicate_order_count,cache_last_modified=EXCLUDED.cache_last_modified," +
        "cache_consistency=EXCLUDED.cache_consistency",
        [state.collection_id, state.region_id, state.observed_at, state.status, JSON.stringify(state.provenance),
         state.source_pages, state.duplicate_order_count, state.cache_last_modified, state.cache_consistency],
      );
      await client.query("DELETE FROM canonical_market_orders WHERE collection_id=$1", [state.collection_id]);
      for (const order of state.orders) {
        await client.query(
          "INSERT INTO canonical_market_orders " +
          "(collection_id, order_id, region_id, type_id, location_id, system_id, is_buy_order, price, volume_remain, volume_total, issued, duration, min_volume, order_range, escrow) " +
          "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
          [state.collection_id, order.order_id, state.region_id, order.type_id, order.location_id, order.system_id,
           order.is_buy_order, order.price, order.volume_remain, order.volume_total, order.issued, order.duration,
           order.min_volume, order.range, order.escrow],
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

  private async completedPages(collectionId: string): Promise<number[]> {
    const result = await this.pool.query(
      "SELECT page FROM market_page_observations WHERE collection_id=$1 AND status='COMPLETE' ORDER BY page", [collectionId],
    );
    return result.rows.map((row) => Number(row.page));
  }
}
