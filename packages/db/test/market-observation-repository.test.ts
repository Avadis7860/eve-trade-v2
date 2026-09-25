import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import type { MarketPageObservation } from "@eve-trade/contracts";
import { MarketObservationRepository } from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../database/migrations/001_market_ingestion.sql",
);

const collectionId = "00000000-0000-0000-0000-000000000010";

function page(observationId: string, pageNumber: number, orderId: number): MarketPageObservation {
  const records = [{
    duration: 90,
    escrow: 0,
    is_buy_order: false,
    issued: "2026-09-25T10:00:00.000Z",
    location_id: 60003760,
    min_volume: 1,
    order_id: orderId,
    price: 100,
    range: "region",
    system_id: 30000142,
    type_id: 34,
    volume_remain: 10,
    volume_total: 10,
  }];
  return {
    observation_id: observationId,
    collection_id: collectionId,
    region_id: 10000002,
    page: pageNumber,
    total_pages: 2,
    observed_at: "2026-09-25T10:00:00.000Z",
    status: "COMPLETE",
    provenance: {
      source_kind: "ESI",
      source_id: "esi:markets/10000002/orders",
      endpoint: "/markets/10000002/orders/",
      principal_scope: "PUBLIC",
    },
    http_status: 200,
    retry_count: 0,
    records,
    raw_payload: records,
    headers: {
      x_pages: "2",
      last_modified: "Fri, 25 Sep 2026 10:00:00 GMT",
      etag: "test-etag",
      expires: null,
      ratelimit_group: null,
      ratelimit_limit: null,
      ratelimit_remaining: null,
      ratelimit_used: null,
      retry_after: null,
      error_limit_remain: null,
      error_limit_reset: null,
      compatibility_date: "2026-09-25",
    },
    error: null,
  };
}

test("persists append-only observations and reconstructible canonical market state", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(await readFile(migrationPath, "utf8"));
    await pool.query("TRUNCATE canonical_market_orders, canonical_market_states, market_page_observations, market_collections CASCADE");
    const repository = new MarketObservationRepository(pool);
    await repository.createCollection({
      collection_id: collectionId,
      region_id: 10000002,
      observed_at: "2026-09-25T10:00:00.000Z",
      expected_pages: 2,
      completed_pages: [],
      status: "PARTIAL",
      provenance: page("00000000-0000-0000-0000-000000000011", 1, 1).provenance,
      cache_last_modified: "Fri, 25 Sep 2026 10:00:00 GMT",
      cache_consistency: "UNVERIFIED",
      error: null,
    });

    await repository.savePage(page("00000000-0000-0000-0000-000000000011", 1, 1));
    await repository.savePage(page("00000000-0000-0000-0000-000000000012", 1, 2));
    await repository.savePage(page("00000000-0000-0000-0000-000000000013", 2, 3));

    const rawCount = await pool.query("SELECT count(*)::int AS count FROM market_page_observations WHERE collection_id=$1", [collectionId]);
    assert.equal(rawCount.rows[0]?.count, 3);
    const pages = await repository.loadPages(collectionId);
    assert.equal(pages.length, 2);
    assert.equal(pages.find((entry) => entry.page === 1)?.records[0]?.order_id, 2);

    await repository.saveCanonical({
      collection_id: collectionId,
      region_id: 10000002,
      observed_at: "2026-09-25T10:00:00.000Z",
      status: "COMPLETE",
      provenance: pages[0]!.provenance,
      orders: pages.flatMap((entry) => entry.records),
      source_pages: 2,
      duplicate_order_count: 0,
      cache_last_modified: "Fri, 25 Sep 2026 10:00:00 GMT",
      cache_consistency: "CONSISTENT",
    });
    const canonicalOrders = await pool.query("SELECT order_id FROM canonical_market_orders WHERE collection_id=$1 ORDER BY order_id", [collectionId]);
    assert.deepEqual(canonicalOrders.rows.map((row) => Number(row.order_id)), [2, 3]);
  } finally {
    await pool.end();
  }
});
