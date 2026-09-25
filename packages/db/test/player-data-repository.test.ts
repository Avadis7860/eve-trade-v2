import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import type { CanonicalPlayerState, PlayerObservation } from "@eve-trade/contracts";
import { PlayerDataRepository } from "../src/player-data-repository.js";

const databaseUrl = process.env.DATABASE_URL;
const migrationPaths = [1, 2, 3].map((n) =>
  join(dirname(fileURLToPath(import.meta.url)), `../../../database/migrations/00${n}_${n === 1 ? "market_ingestion" : n === 2 ? "market_history" : "player_data"}.sql`),
);

const id = (n: number) => `00000000-0000-0000-0000-000000000${String(n).padStart(3, "0")}`;

function observation(
  collectionId: string,
  characterId: number,
  kind: PlayerObservation["data_kind"],
  observationId: string,
  records: unknown[],
): PlayerObservation {
  return {
    observation_id: observationId,
    collection_id: collectionId,
    character_id: characterId,
    data_kind: kind,
    page_identity: "current",
    observed_at: "2026-09-25T10:00:00.000Z",
    status: "COMPLETE",
    provenance: {
      source_kind: "ESI",
      source_id: `esi:character/${characterId}`,
      endpoint: "/v1/player",
      principal_scope: "CHARACTER",
      principal_id: characterId,
    },
    http_status: 200,
    retry_count: 0,
    records,
    raw_payload: records,
    headers: {
      x_pages: "1",
      last_modified: null,
      etag: null,
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

function state(characterId: number, observationIds: string[], complete = true): CanonicalPlayerState {
  const quality = (observationId: string, available = complete) => ({
    availability: available ? "COMPLETE" as const : "UNKNOWN" as const,
    coverage: available ? "COMPLETE" as const : "UNKNOWN" as const,
    health: available ? "HEALTHY" as const : "UNKNOWN" as const,
    observed_at: available ? "2026-09-25T10:00:00.000Z" : null,
    fresh_until: null,
    observation_ids: available ? [observationId] : [],
    error: null,
  });
  return {
    character_id: characterId,
    principal: {
      character_id: characterId,
      name: `Pilot-${characterId}`,
      corporation_id: 98000001,
      identity_observation_id: observationIds[0] ?? null,
      observed_at: "2026-09-25T10:00:00.000Z",
      provenance: {
        source_kind: "ESI",
        source_id: "esi:character",
        endpoint: "/characters/{character_id}/",
        principal_scope: "PUBLIC",
      },
    },
    identity: null,
    wallet: { quality: quality(observationIds[1]!, complete), records: complete ? [1000] : null },
    journal: { quality: quality(observationIds[2]!, complete), records: complete ? [] : null },
    transactions: { quality: quality(observationIds[3]!, complete), records: complete ? [] : null },
    assets: { quality: quality(observationIds[4]!, complete), records: complete ? [] : null },
    active_orders: { quality: quality(observationIds[5]!, complete), records: complete ? [{
      duration: 90, escrow: 0, is_buy_order: false, issued: "2026-09-25T10:00:00Z",
      location_id: 60003760, min_volume: 1, order_id: 77, price: 100, range: "region",
      system_id: 30000142, type_id: 34, volume_remain: 10, volume_total: 10,
    }] : null },
  };
}

test("persists raw observations, isolates characters, and keeps last complete canonical rows on degraded sync", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    for (const migrationPath of migrationPaths) await pool.query(await readFile(migrationPath, "utf8"));
    await pool.query(
      "TRUNCATE player_active_orders_current, player_assets_current, player_wallet_transactions_current, " +
      "player_wallet_journal_current, player_wallet_current, player_component_states, player_principals, " +
      "player_observations, player_syncs CASCADE",
    );

    const repository = new PlayerDataRepository(pool);
    const idsA = [1, 2, 3, 4, 5, 6].map(id);
    const idsB = [11, 12, 13, 14, 15, 16].map(id);
    for (const [characterId, syncId, ids] of [
      [90000001, id(101), idsA],
      [90000002, id(102), idsB],
    ] as const) {
      await repository.createSync({ collection_id: syncId, character_id: characterId, observed_at: "2026-09-25T10:00:00Z", status: "UNKNOWN" });
      const kinds: PlayerObservation["data_kind"][] = ["IDENTITY","WALLET_BALANCE","WALLET_JOURNAL","WALLET_TRANSACTION","ASSET","ACTIVE_ORDER"];
      for (let i = 0; i < kinds.length; i += 1) {
        const kind = kinds[i]!;
        const records = kind === "IDENTITY"
          ? [{ name: `Pilot-${characterId}`, corporation_id: 98000001 }]
          : kind === "WALLET_BALANCE"
            ? [1000]
            : kind === "ACTIVE_ORDER"
              ? [state(characterId, ids).active_orders.records![0]!]
              : [];
        await repository.saveObservation(observation(syncId, characterId, kind, ids[i]!, records));
      }
      await repository.saveCanonical(state(characterId, ids));
    }

    await assert.rejects(
      () =>
        repository.saveObservation(
          observation(id(101), 90000002, "WALLET_BALANCE", id(201), [999]),
        ),
      /violates foreign key constraint/,
    );

    const rows = await pool.query(
      "SELECT character_id, balance FROM player_wallet_current ORDER BY character_id",
    );
    assert.deepEqual(rows.rows.map((row) => [Number(row.character_id), Number(row.balance)]), [[90000001, 1000], [90000002, 1000]]);

    const orders = await pool.query(
      "SELECT character_id, order_id FROM player_active_orders_current ORDER BY character_id",
    );
    assert.deepEqual(orders.rows.map((row) => [Number(row.character_id), Number(row.order_id)]), [[90000001, 77], [90000002, 77]]);

    await repository.saveCanonical(state(90000001, idsA, false));
    const preserved = await pool.query(
      "SELECT character_id, balance FROM player_wallet_current WHERE character_id=90000001",
    );
    assert.deepEqual(preserved.rows.map((row) => [Number(row.character_id), Number(row.balance)]), [[90000001, 1000]]);

    const quality = await pool.query(
      "SELECT availability, coverage, health FROM player_component_states WHERE character_id=90000001 AND data_kind='WALLET_BALANCE'",
    );
    assert.deepEqual(quality.rows[0], { availability: "UNKNOWN", coverage: "UNKNOWN", health: "UNKNOWN" });

    const raw = await pool.query("SELECT count(*)::int AS count FROM player_observations");
    assert.equal(raw.rows[0]?.count, 12);
  } finally {
    await pool.end();
  }
});
