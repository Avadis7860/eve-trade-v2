import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Pool } from "pg";
import type { TradeScenario, TradeAnalysisResult } from "@eve-trade/contracts";
import { createOpportunityObservation } from "@eve-trade/domain";
import { OpportunityTrackingRepository } from "../src/opportunity-tracking-repository.js";

const databaseUrl = process.env.DATABASE_URL;
const migrations = [
  "001_market_ingestion.sql",
  "002_market_history.sql",
  "003_player_data.sql",
  "004_opportunity_tracking.sql",
].map((name) =>
  join(dirname(fileURLToPath(import.meta.url)), "../../../database/migrations", name),
);

const scenario: TradeScenario = {
  type_id: 34,
  requested_quantity: 5,
  acquisition: {
    source: "MARKET",
    market: {
      execution_mode: "TAKER_AGAINST_SELL",
      execution_location: { region_id: 10000002, system_id: 30000142, location_id: 60003760 },
      quantity: 5,
      limit_price: 100,
      order_range: "region",
    },
  },
  disposition: {
    source: "MARKET",
    market: {
      execution_mode: "TAKER_AGAINST_BUY",
      execution_location: { region_id: 10000043, system_id: 30002187, location_id: 60008494 },
      quantity: 5,
      limit_price: 120,
      order_range: "region",
    },
  },
  origin: { region_id: 10000002, system_id: 30000142, location_id: 60003760 },
  destination: { region_id: 10000043, system_id: 30002187, location_id: 60008494 },
};

const analysis: TradeAnalysisResult = {
  contract_version: "phase-04.2",
  status: "EXECUTABLE",
  status_reasons: [],
  scenario_fingerprint: "phase4-db-1",
  acquisition_leg: {
    execution_mode: "TAKER_AGAINST_SELL",
    requested_quantity: 5,
    filled_quantity: 5,
    remaining_quantity: 0,
    simulated_fills: [],
    status: "EXECUTABLE",
    reasons: [],
  },
  logistics_leg: { status: "COMPLETE", cost: 0, jump_count: 0, travel_time_seconds: 0, provenance: null },
  disposition_leg: {
    execution_mode: "TAKER_AGAINST_BUY",
    requested_quantity: 5,
    filled_quantity: 5,
    remaining_quantity: 0,
    simulated_fills: [],
    status: "EXECUTABLE",
    reasons: [],
  },
  capital_context: { wallet_cash: null, committed_escrow: 0, inventory: null, deployable_capital: 1000, source: "EXPLICIT_DEPLOYABLE" },
  fee_context: { broker_fee_rate: null, sales_tax_rate: 0.05, source: "EXPLICIT" },
  market_evidence: {
    acquisition_snapshot_id: "a",
    disposition_snapshot_id: "b",
    acquisition_order_ids: [11],
    disposition_order_ids: [22],
    acquisition_provenance: { source_kind: "ESI", source_id: "mkt-a", endpoint: "/markets/a/orders/", principal_scope: "PUBLIC" },
    disposition_provenance: { source_kind: "ESI", source_id: "mkt-b", endpoint: "/markets/b/orders/", principal_scope: "PUBLIC" },
  },
  economic_result: {
    acquisition_cash_outflow: 500,
    disposition_proceeds: 600,
    gross_result: 100,
    fees_total: 30,
    logistics_cost: 0,
    simulated_net_result: 70,
    capital_required: 500,
    simulated_return: 0.14,
  },
};

test("persists opportunity identity, repeated observations and outcomes idempotently", { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    for (const path of migrations) await pool.query(await readFile(path, "utf8"));
    await pool.query("TRUNCATE opportunity_outcomes, opportunity_observations, opportunities CASCADE");

    const repository = new OpportunityTrackingRepository(pool);
    const first = createOpportunityObservation({
      observed_at: "2026-09-25T10:00:00Z",
      scenario,
      phase4_result: analysis,
      presence: "PRESENT",
    });
    const second = createOpportunityObservation({
      observed_at: "2026-09-25T10:05:00Z",
      scenario,
      phase4_result: { ...analysis, scenario_fingerprint: "phase4-db-2", economic_result: { ...analysis.economic_result, simulated_net_result: 80, simulated_return: 0.16 } },
      presence: "PRESENT",
    });

    await repository.saveObservation(first);
    await repository.saveObservation(first);
    await repository.saveObservation(second);

    const outcomes = [{
      ...({} as never),
    }];
    const outcome = {
      opportunity_id: first.opportunity_id,
      outcome_id: "outcome-1",
      observed_at: "2026-09-25T10:30:00Z",
      status: "PARTIALLY_OBSERVED" as const,
      evidence_coverage: "PARTIAL" as const,
      expected_quantity: 5,
      observed_quantity: 2,
      evidence: [],
      observed_subresult: { quantity: 2 },
    };
    await repository.saveOutcome(outcome);
    await repository.saveOutcome(outcome);

    const persisted = await repository.listObservations(first.opportunity_id);
    assert.equal(persisted.length, 2);
    assert.equal(persisted[0]?.opportunity_id, first.opportunity_id);
    assert.equal(persisted[1]?.phase4_result.economic_result.simulated_net_result, 80);

    const persistedOutcomes = await repository.listOutcomes(first.opportunity_id);
    assert.equal(persistedOutcomes.length, 1);
    assert.equal(persistedOutcomes[0]?.status, "PARTIALLY_OBSERVED");

    const counts = await pool.query(
      "SELECT " +
      "(SELECT count(*) FROM opportunities)::int AS opportunities, " +
      "(SELECT count(*) FROM opportunity_observations)::int AS observations, " +
      "(SELECT count(*) FROM opportunity_outcomes)::int AS outcomes",
    );
    assert.deepEqual(counts.rows[0], { opportunities: 1, observations: 2, outcomes: 1 });
  } finally {
    await pool.end();
  }
});
