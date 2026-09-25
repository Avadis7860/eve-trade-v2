import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import type {
  OpportunityObservation,
  OpportunityPipelineRun,
} from "@eve-trade/contracts";
import { createApiHandler } from "../src/server.js";

class Reader {
  constructor(
    private readonly observations: OpportunityObservation[],
    private readonly pipeline: OpportunityPipelineRun | null,
  ) {}
  async listAllObservations(): Promise<OpportunityObservation[]> {
    return [...this.observations];
  }
  async listObservations(opportunityId: string): Promise<OpportunityObservation[]> {
    return this.observations.filter((item) => item.opportunity_id === opportunityId);
  }
  async getLatestPipelineRun(): Promise<OpportunityPipelineRun | null> {
    return this.pipeline;
  }
}

async function requestList(pipeline: OpportunityPipelineRun | null): Promise<{ status: number; pipeline: unknown }> {
  const server = createServer(createApiHandler({ reader: new Reader([], pipeline) }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const response = await fetch(
      "http://127.0.0.1:" + address.port + "/api/v1/opportunities",
    );
    const body = (await response.json()) as { data: { pipeline: unknown } };
    return { status: response.status, pipeline: body.data.pipeline };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("API exposes pipeline execution state alongside the opportunity read model", async () => {
  const pipeline: OpportunityPipelineRun = {
    run_id: "00000000-0000-0000-0000-000000000901",
    region_id: 10000002,
    market_collection_id: "00000000-0000-0000-0000-000000000902",
    observed_at: "2026-09-25T22:10:00Z",
    completed_at: "2026-09-25T22:10:05Z",
    status: "NO_CANDIDATES",
    candidates_generated: 0,
    analyses_produced: 0,
    observations_persisted: 0,
    error: null,
  };

  const response = await requestList(pipeline);
  assert.equal(response.status, 200);
  assert.deepEqual(response.pipeline, {
    status: "NO_CANDIDATES",
    region_id: 10000002,
    market_collection_id: pipeline.market_collection_id,
    observed_at: pipeline.observed_at,
    completed_at: pipeline.completed_at,
    candidates_generated: 0,
    analyses_produced: 0,
    observations_persisted: 0,
    error: null,
  });
});

test("API reports no pipeline run before the worker has produced operational evidence", async () => {
  const response = await requestList(null);
  assert.equal(response.status, 200);
  assert.equal(response.pipeline, null);
});
