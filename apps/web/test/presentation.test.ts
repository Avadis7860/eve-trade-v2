import assert from "node:assert/strict";
import test from "node:test";
import type { ApiOpportunitySummary } from "@eve-trade/contracts";
import {
  adviceLabel,
  evidenceState,
  scoreLabel,
  shouldEmphasizeLimitations,
} from "../src/presentation.js";

const base = (): ApiOpportunitySummary => ({
  opportunity_id: "opp-1",
  observation_id: "obs-1",
  observed_at: "2026-09-25T19:00:00Z",
  type_id: 34,
  requested_quantity: 10,
  presence: "PRESENT",
  freshness_state: "CURRENT",
  trade_analysis_status: "EXECUTABLE",
  economic_result: {
    simulated_net_result: 140,
    simulated_return: 0.14,
    capital_required: 1000,
  },
  score: {
    availability: "AVAILABLE",
    value: 100,
    contract_version: "phase-07.1",
    policy_version: "phase-07-policy.1",
  },
  advice: {
    kind: "ACTIONABLE",
    evidence_level: "DIRECT",
  },
  data_state: "COMPLETE",
  blockers: [],
  limitations: [],
  scope: {
    principal_scope: "PUBLIC",
    principal_id: null,
    character_id: null,
    provenance: null,
  },
  provenance: [],
  evidence_count: 3,
});

test("complete evidence renders as COMPLETE", () => {
  assert.equal(evidenceState(base()), "COMPLETE");
});

test("degraded evidence remains explicit", () => {
  for (const [state, expected] of [
    ["PARTIAL", "PARTIAL"],
    ["ERROR", "ERROR"],
    ["UNKNOWN", "UNKNOWN"],
    ["STALE", "STALE"],
    ["ABSENT", "ABSENT"],
  ] as const) {
    assert.equal(evidenceState({ ...base(), data_state: state }), expected);
  }
});

test("unavailable scores do not render as zero", () => {
  assert.equal(
    scoreLabel({ ...base().score, availability: "SCORE_UNAVAILABLE", value: null }),
    "Unavailable",
  );
});

test("advice remains human-readable without changing semantics", () => {
  assert.equal(
    adviceLabel({ kind: "ACTIONABLE_WITH_LIMITATION", evidence_level: "LIMITED" }),
    "ACTIONABLE WITH LIMITATION",
  );
});

test("limitations and blockers force visible emphasis", () => {
  assert.equal(
    shouldEmphasizeLimitations({
      ...base(),
      limitations: ["prediction signal is absent"],
    }),
    true,
  );
  assert.equal(
    shouldEmphasizeLimitations({
      ...base(),
      blockers: ["FRESHNESS_STALE"],
    }),
    true,
  );
});
