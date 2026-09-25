import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { Pool } from "pg";
import test from "node:test";
import { OpportunityTrackingRepository } from "@eve-trade/db";
import { createApiHandler } from "../src/server.js";
import { publicObservation } from "./fixtures.js";

const databaseUrl = process.env.DATABASE_URL;

test(
  "API -> PostgreSQL opportunity read path preserves the persisted contract",
  { skip: databaseUrl === undefined ? "DATABASE_URL is not configured" : false },
  async () => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });

    try {
      const migration = await readFile(
        resolve(process.cwd(), "database/migrations/004_opportunity_tracking.sql"),
        "utf8",
      );
      await pool.query(migration);

      const repository = new OpportunityTrackingRepository(pool);
      await repository.saveObservation(publicObservation("opp-db", "obs-db"));

      const server = createServer(createApiHandler({ reader: repository }));
      await new Promise<void>((resolveListen) =>
        server.listen(0, "127.0.0.1", resolveListen),
      );
      const address = server.address();
      assert.ok(address && typeof address === "object");

      try {
        const response = await fetch(
          `http://127.0.0.1:${address.port}/api/v1/opportunities/opp-db`,
        );
        assert.equal(response.status, 200);
        const body = (await response.json()) as {
          data: {
            opportunity_id: string;
            observation_id: string;
            scope: { principal_scope: string };
            scoring: { availability: string };
          };
        };

        assert.equal(body.data.opportunity_id, "opp-db");
        assert.equal(body.data.observation_id, "obs-db");
        assert.equal(body.data.scope.principal_scope, "PUBLIC");
        assert.equal(body.data.scoring.availability, "AVAILABLE");
      } finally {
        await new Promise<void>((resolveClose, reject) =>
          server.close((error) => (error ? reject(error) : resolveClose())),
        );
      }
    } finally {
      await pool.query(
        "DROP TABLE IF EXISTS opportunity_outcomes, opportunity_observations, opportunities CASCADE",
      );
      await pool.end();
    }
  },
);
