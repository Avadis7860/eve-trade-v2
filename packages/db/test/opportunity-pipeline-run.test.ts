import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Pool } from "pg";
import type { OpportunityPipelineRun } from "@eve-trade/contracts";
import { OpportunityTrackingRepository } from "../src/opportunity-tracking-repository.js";

const databaseUrl = process.env.DATABASE_URL;
const migrations = [
  "001_market_ingestion.sql",
  "002_market_history.sql",
  "003_player_data.sql",
  "004_opportunity_tracking.sql",
  "005_opportunity_pipeline_runs.sql",
].map((name) =>
  join(dirname(fileURLToPath(import.meta.url)), "../../../database/migrations", name),
);

test(
  "persists and idempotently updates operational opportunity pipeline runs",
  { skip: databaseUrl === undefined ? "DATABASE_URL is not configured" : false },
  async () => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    const run: OpportunityPipelineRun = {
      run_id: "00000000-0000-0000-0000-000000000805",
      region_id: 10000002,
      market_collection_id: "00000000-0000-0000-0000-000000000801",
      observed_at: "2026-09-25T22:00:00Z",
      completed_at: "2026-09-25T22:00:05Z",
      status: "SUCCESS",
      candidates_generated: 3,
      analyses_produced: 3,
      observations_persisted: 3,
      error: null,
    };

    try {
      for (const path of migrations) await pool.query(await readFile(path, "utf8"));
      await pool.query("TRUNCATE opportunity_pipeline_runs");
      const repository = new OpportunityTrackingRepository(pool);

      await repository.savePipelineRun(run);
      await repository.savePipelineRun({
        ...run,
        candidates_generated: 4,
        analyses_produced: 4,
        observations_persisted: 4,
      });

      const latest = await repository.getLatestPipelineRun();
      assert.ok(latest);
      assert.equal(latest.run_id, run.run_id);
      assert.equal(latest.candidates_generated, 4);
      assert.equal(latest.observations_persisted, 4);

      const count = await pool.query(
        "SELECT count(*)::int AS count FROM opportunity_pipeline_runs WHERE run_id=$1",
        [run.run_id],
      );
      assert.equal(count.rows[0]?.count, 1);
    } finally {
      await pool.end();
    }
  },
);
