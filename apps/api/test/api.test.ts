import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import type { OpportunityObservation } from "@eve-trade/contracts";
import { createApiHandler } from "../src/server.js";
import { publicObservation } from "./fixtures.js";

class InMemoryReader {
  constructor(private readonly observations: OpportunityObservation[]) {}
  async listAllObservations(): Promise<OpportunityObservation[]> {
    return [...this.observations];
  }
  async listObservations(opportunityId: string): Promise<OpportunityObservation[]> {
    return this.observations.filter((item) => item.opportunity_id === opportunityId);
  }
}

async function withServer(
  observations: OpportunityObservation[],
  callback: (baseUrl: string) => Promise<void>,
  authorizeScope?: (scope: OpportunityObservation["scope"]) => boolean,
): Promise<void> {
  const dependencies =
    authorizeScope === undefined
      ? { reader: new InMemoryReader(observations) }
      : {
          reader: new InMemoryReader(observations),
          authorizeScope,
        };

  const server = createServer(createApiHandler(dependencies));

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await callback(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("GET /api/v1/opportunities exposes deterministic summaries", async () => {
  await withServer([publicObservation()], async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/opportunities?limit=10`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      contract_version: string;
      data: { total: number; items: Array<{ score: { value: number | null }; advice: { kind: string } }> };
    };
    assert.equal(body.contract_version, "phase-08.1");
    assert.equal(body.data.total, 1);
    assert.equal(body.data.items[0]?.score.value, 100);
    assert.equal(body.data.items[0]?.advice.kind, "ACTIONABLE_WITH_LIMITATION");
  });
});

test("GET /api/v1/opportunities/:id exposes the full scoring explanation", async () => {
  await withServer([publicObservation()], async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/opportunities/opp-1`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      data: {
        scoring: {
          contract_version: string;
          availability: string;
          components: unknown[];
          reasons: unknown[];
          evidence: unknown[];
        };
        trade_analysis: { status: string };
      };
    };
    assert.equal(body.data.scoring.contract_version, "phase-07.1");
    assert.equal(body.data.scoring.availability, "AVAILABLE");
    assert.equal(body.data.scoring.components.length, 4);
    assert.equal(body.data.scoring.evidence.length >= 3, true);
    assert.equal(body.data.trade_analysis.status, "EXECUTABLE");
  });
});

test("UNKNOWN, STALE, ABSENT and PARTIAL remain explicit in the API projection", async () => {
  const stale = publicObservation("opp-stale", "obs-stale");
  stale.freshness_state = "STALE";

  const unknown = publicObservation("opp-unknown", "obs-unknown");
  unknown.freshness_state = "UNKNOWN";

  const absent = publicObservation("opp-absent", "obs-absent");
  absent.presence = "ABSENT";

  const partial = publicObservation("opp-partial", "obs-partial");
  partial.phase4_result = {
    ...partial.phase4_result,
    status: "PARTIAL",
    disposition_leg: {
      ...partial.phase4_result.disposition_leg,
      filled_quantity: 5,
      remaining_quantity: 5,
      status: "PARTIAL",
    },
  };

  await withServer([stale, unknown, absent, partial], async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/opportunities?limit=100`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      data: { items: Array<{ opportunity_id: string; data_state: string; score: { value: number | null } }> };
    };
    const states = new Map(body.data.items.map((item) => [item.opportunity_id, item]));

    assert.equal(states.get("opp-stale")?.data_state, "STALE");
    assert.equal(states.get("opp-stale")?.score.value, null);
    assert.equal(states.get("opp-unknown")?.data_state, "UNKNOWN");
    assert.equal(states.get("opp-unknown")?.score.value, null);
    assert.equal(states.get("opp-absent")?.data_state, "ABSENT");
    assert.equal(states.get("opp-absent")?.score.value, null);
    assert.equal(states.get("opp-partial")?.data_state, "PARTIAL");
    assert.equal(states.get("opp-partial")?.score.value !== null, true);
  });
});

test("non-public scopes require an explicit authorized scope", async () => {
  const scoped = publicObservation("opp-character", "obs-character");
  scoped.scope = {
    principal_scope: "CHARACTER",
    principal_id: 90000001,
    character_id: 90000001,
    provenance: {
      source_kind: "ESI",
      source_id: "esi:character:90000001",
      endpoint: "/characters/90000001/orders/",
      principal_scope: "CHARACTER",
      principal_id: 90000001,
    },
  };

  await withServer([scoped], async (baseUrl) => {
    const denied = await fetch(
      `${baseUrl}/api/v1/opportunities?principal_scope=CHARACTER&principal_id=90000001`,
    );
    assert.equal(denied.status, 403);
  });

  await withServer(
    [scoped],
    async (baseUrl) => {
      const allowed = await fetch(
        `${baseUrl}/api/v1/opportunities?principal_scope=CHARACTER&principal_id=90000001&character_id=90000001`,
      );
      assert.equal(allowed.status, 200);
      const body = (await allowed.json()) as { data: { total: number } };
      assert.equal(body.data.total, 1);

      const wrongPrincipal = await fetch(
        `${baseUrl}/api/v1/opportunities?principal_scope=CHARACTER&principal_id=90000002&character_id=90000002`,
      );
      assert.equal(wrongPrincipal.status, 403);
    },
    (scope) =>
      scope.principal_scope === "CHARACTER" &&
      scope.principal_id === 90000001 &&
      scope.character_id === 90000001,
  );
});

test("invalid filters and absent resources are transport errors, not business values", async () => {
  await withServer([publicObservation()], async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/v1/opportunities?limit=0`);
    assert.equal(invalid.status, 400);
    const missing = await fetch(`${baseUrl}/api/v1/opportunities/not-present`);
    assert.equal(missing.status, 404);
  });
});
