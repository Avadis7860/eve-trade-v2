import assert from "node:assert/strict";
import test from "node:test";
import type { EsiMarketOrder, MarketCollection, MarketHistoryBuildResult, MarketPageObservation } from "@eve-trade/contracts";
import { rebuildMarketHistory } from "../src/index.js";

const order = (id: number, price: number): EsiMarketOrder => ({
  duration: 90,
  is_buy_order: false,
  issued: "2026-09-25T10:00:00.000Z",
  location_id: 60003760,
  min_volume: 1,
  order_id: id,
  price,
  range: "region",
  system_id: 30000142,
  type_id: 34,
  volume_remain: 10,
  volume_total: 10,
});

function collection(id: string, observedAt: string): MarketCollection {
  return {
    collection_id: id,
    region_id: 10000002,
    observed_at: observedAt,
    expected_pages: 1,
    completed_pages: [1],
    status: "COMPLETE",
    provenance: {
      source_kind: "ESI",
      source_id: "esi:markets/10000002/orders",
      endpoint: "/markets/10000002/orders/",
      principal_scope: "PUBLIC",
    },
    cache_last_modified: "Fri, 25 Sep 2026 10:00:00 GMT",
    cache_consistency: "CONSISTENT",
    error: null,
  };
}

function page(observationId: string, collectionId: string, observedAt: string, records: EsiMarketOrder[]): MarketPageObservation {
  return {
    observation_id: observationId,
    collection_id: collectionId,
    region_id: 10000002,
    page: 1,
    total_pages: 1,
    observed_at: observedAt,
    status: "COMPLETE",
    provenance: collection(collectionId, observedAt).provenance,
    http_status: 200,
    retry_count: 0,
    records,
    raw_payload: records,
    headers: {
      x_pages: "1",
      last_modified: "Fri, 25 Sep 2026 10:00:00 GMT",
      etag: "etag",
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

test("rebuilds history from persisted observations without an ESI client", async () => {
  const firstId = "00000000-0000-0000-0000-000000000101";
  const secondId = "00000000-0000-0000-0000-000000000102";
  const source = {
    async listCollections() {
      return [collection(firstId, "2026-09-25T10:00:00.000Z"), collection(secondId, "2026-09-25T10:10:00.000Z")];
    },
    async loadPages(id: string) {
      return id === firstId
        ? [page("obs101", firstId, "2026-09-25T10:00:00.000Z", [order(1, 100)])]
        : [page("obs102", secondId, "2026-09-25T10:10:00.000Z", [order(1, 101)])];
    },
  };
  const saved: { value: MarketHistoryBuildResult | null } = { value: null };
  const target = { async replace(result: MarketHistoryBuildResult) { saved.value = structuredClone(result); } };
  const result = await rebuildMarketHistory(source, target);
  assert.equal(result.snapshots.length, 2);
  assert.equal(result.snapshots[0]?.observation_kind, "INITIAL");
  assert.equal(result.snapshots[1]?.observation_kind, "NEW_STATE");
  assert.ok(saved.value);
  assert.equal(saved.value.snapshots.length, 2);
  assert.equal(saved.value.metrics.length, 2);
});
