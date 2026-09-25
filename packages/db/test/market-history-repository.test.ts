import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import type { MarketHistoryBuildResult } from "@eve-trade/contracts";
import { MarketHistoryRepository } from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
const migration1Path = join(dirname(fileURLToPath(import.meta.url)), "../../../database/migrations/001_market_ingestion.sql");
const migration2Path = join(dirname(fileURLToPath(import.meta.url)), "../../../database/migrations/002_market_history.sql");

const firstId = "00000000-0000-0000-0000-000000000201";
const secondId = "00000000-0000-0000-0000-000000000202";

const result: MarketHistoryBuildResult = {
  snapshots: [
    {
      snapshot_id: firstId,
      collection_id: firstId,
      region_id: 10000002,
      observed_at: "2026-09-25T10:00:00.000Z",
      status: "COMPLETE",
      comparison_eligible: true,
      state_fingerprint: "aaaaaaaa",
      source_last_modified: "Fri, 25 Sep 2026 10:00:00 GMT",
      source_compatibility_date: "2026-09-25",
      source_consistency: "CONSISTENT",
      observation_kind: "INITIAL",
      previous_snapshot_id: null,
      source_pages: 1,
    },
    {
      snapshot_id: secondId,
      collection_id: secondId,
      region_id: 10000002,
      observed_at: "2026-09-25T10:10:00.000Z",
      status: "COMPLETE",
      comparison_eligible: true,
      state_fingerprint: "bbbbbbbb",
      source_last_modified: "Fri, 25 Sep 2026 10:10:00 GMT",
      source_compatibility_date: "2026-09-25",
      source_consistency: "CONSISTENT",
      observation_kind: "NEW_STATE",
      previous_snapshot_id: firstId,
      source_pages: 1,
    },
    {
      snapshot_id: "00000000-0000-0000-0000-000000000203",
      collection_id: "00000000-0000-0000-0000-000000000203",
      region_id: 10000002,
      observed_at: "2026-09-25T10:20:00.000Z",
      status: "PARTIAL",
      comparison_eligible: false,
      state_fingerprint: null,
      source_last_modified: null,
      source_compatibility_date: null,
      source_consistency: "UNVERIFIED",
      observation_kind: "NOT_COMPARABLE",
      previous_snapshot_id: null,
      source_pages: 2,
    },
  ],
  metrics: [
    {
      snapshot_id: firstId,
      type_id: 34,
      best_buy_price: 90,
      best_buy_volume: 5,
      best_sell_price: 100,
      best_sell_volume: 10,
      spread_absolute: 10,
      spread_relative: 0.1,
      buy_visible_volume: 5,
      sell_visible_volume: 10,
    },
  ],
  depth_levels: [
    {
      snapshot_id: firstId,
      type_id: 34,
      is_buy_order: false,
      price: 100,
      volume_remain: 10,
      order_count: 1,
    },
  ],
  order_evolution: [
    {
      previous_snapshot_id: firstId,
      snapshot_id: secondId,
      order_id: 34,
      kind: "DISAPPEARED",
      changed_fields: [],
      previous_order: null,
      current_order: null,
    },
  ],
};

test("persists and replaces derived market history atomically", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(await readFile(migration1Path, "utf8"));
    await pool.query(await readFile(migration2Path, "utf8"));
    await pool.query("TRUNCATE market_order_evolution, market_snapshot_depth_levels, market_snapshot_type_metrics, market_history_snapshots CASCADE");
    await pool.query(
      "INSERT INTO market_collections " +
      "(collection_id,region_id,observed_at,expected_pages,status,provenance,cache_last_modified,cache_consistency,error) " +
      "VALUES " +
      "($1,10000002,$4,1,'COMPLETE',$3,$5,'CONSISTENT',NULL)," +
      "($2,10000002,$6,1,'COMPLETE',$3,$7,'CONSISTENT',NULL)," +
      "($8,10000002,$9,2,'PARTIAL',$3,NULL,'UNVERIFIED',NULL)",
      [
        firstId,
        secondId,
        {
          source_kind: "ESI",
          source_id: "esi:markets/10000002/orders",
          endpoint: "/markets/10000002/orders/",
          principal_scope: "PUBLIC",
        },
        "2026-09-25T10:00:00.000Z",
        "Fri, 25 Sep 2026 10:00:00 GMT",
        "2026-09-25T10:10:00.000Z",
        "Fri, 25 Sep 2026 10:10:00 GMT",
        "00000000-0000-0000-0000-000000000203",
        "2026-09-25T10:20:00.000Z",
      ],
    );
    const repository = new MarketHistoryRepository(pool);

    await repository.replace(result);
    const firstCounts = await pool.query(
      "SELECT (SELECT count(*) FROM market_history_snapshots)::int AS snapshots, " +
      "(SELECT count(*) FROM market_snapshot_type_metrics)::int AS metrics, " +
      "(SELECT count(*) FROM market_snapshot_depth_levels)::int AS depth",
    );
    assert.deepEqual(firstCounts.rows[0], {snapshots: 3, metrics: 1, depth: 1});

    const evolutionRows = await pool.query("SELECT order_id,kind FROM market_order_evolution WHERE snapshot_id=$1", [secondId]);
    assert.deepEqual(evolutionRows.rows.map((row) => ({order_id: Number(row.order_id), kind: row.kind})), [{order_id: 34, kind: "DISAPPEARED"}]);

    const snapshots = await repository.listSnapshots();
    assert.equal(snapshots[1]?.previous_snapshot_id, firstId);
    assert.equal(snapshots[2]?.comparison_eligible, false);

    await repository.replace(result);
    const secondCounts = await pool.query("SELECT count(*)::int AS count FROM market_history_snapshots");
    assert.equal(secondCounts.rows[0]?.count, 3);
  } finally {
    await pool.end();
  }
});
