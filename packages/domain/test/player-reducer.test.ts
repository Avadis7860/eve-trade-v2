import assert from "node:assert/strict";
import test from "node:test";
import type { PlayerObservation } from "@eve-trade/contracts";
import { reconstructPlayerState } from "../src/player-reducer.js";

function obs(kind: PlayerObservation["data_kind"], records: unknown[], overrides: Partial<PlayerObservation> = {}): PlayerObservation {
  return {
    observation_id: `obs-${kind}`,
    collection_id: "sync-1",
    character_id: 90000001,
    data_kind: kind,
    page_identity: "current",
    observed_at: "2026-09-25T10:00:00.000Z",
    status: "COMPLETE",
    provenance: { source_kind: "ESI", source_id: "esi:character/90000001", endpoint: "/endpoint", principal_scope: "CHARACTER", principal_id: 90000001 },
    http_status: 200,
    retry_count: 0,
    records,
    raw_payload: records,
    headers: {
      x_pages: "1", last_modified: "same", etag: null, expires: null,
      ratelimit_group: null, ratelimit_limit: null, ratelimit_remaining: null,
      ratelimit_used: null, retry_after: null, error_limit_remain: null,
      error_limit_reset: null, compatibility_date: "2026-09-25",
    },
    error: null,
    ...overrides,
  };
}

const transaction = (id: number) => ({
  client_id: 1, date: "2026-09-25T10:00:00Z", is_buy: true, is_personal: true,
  journal_ref_id: 7, location_id: 3, quantity: 2, transaction_id: id, type_id: 34, unit_price: 10,
});

const asset = (id: number) => ({
  item_id: id, location_flag: "Hangar", location_id: 60003760, location_type: "station",
  quantity: 5, is_singleton: false, type_id: 34,
});

test("unknown authenticated data remains null even when a legitimate zero would be possible", () => {
  const state = reconstructPlayerState({
    collection_id: "sync-1",
    character_id: 90000001,
    observed_at: "2026-09-25T10:00:00Z",
    observations: [obs("IDENTITY", [{ name: "Pilot", corporation_id: 98000001 }])],
  });
  assert.equal(state.wallet.records, null);
  assert.equal(state.wallet.quality.availability, "UNKNOWN");
  assert.equal(state.assets.records, null);
  assert.equal(state.active_orders.records, null);
});

test("a successfully observed empty collection is complete and remains distinguishable from unknown", () => {
  const state = reconstructPlayerState({
    collection_id: "sync-1",
    character_id: 90000001,
    observed_at: "2026-09-25T10:00:00Z",
    observations: [
      obs("WALLET_BALANCE", [0]),
      obs("WALLET_JOURNAL", []),
      obs("WALLET_TRANSACTION", []),
      obs("ASSET", []),
      obs("ACTIVE_ORDER", []),
    ],
  });
  assert.equal(state.wallet.records?.[0], 0);
  assert.deepEqual(state.transactions.records, []);
  assert.equal(state.transactions.quality.coverage, "COMPLETE");
});

test("journal, transactions, assets and orders keep independent identities", () => {
  const state = reconstructPlayerState({
    collection_id: "sync-1",
    character_id: 90000001,
    observed_at: "2026-09-25T10:00:00Z",
    observations: [
      obs("WALLET_JOURNAL", [{ id: 10, date: "2026-09-25T10:00:00Z", amount: 5, balance: 10, description: "x", first_party_id: 1, ref_type: "market_transaction", second_party_id: 2 }]),
      obs("WALLET_TRANSACTION", [transaction(7), transaction(7)]),
      obs("ASSET", [asset(8), asset(8)]),
      obs("ACTIVE_ORDER", [{
        duration: 90, escrow: 0, is_buy_order: false, issued: "2026-09-25T10:00:00Z",
        location_id: 60003760, min_volume: 1, order_id: 9, price: 100, range: "region",
        system_id: 30000142, type_id: 34, volume_remain: 10, volume_total: 10,
      }]),
    ],
  });
  assert.equal(state.journal.records?.length, 1);
  assert.equal(state.transactions.records?.length, 1);
  assert.equal(state.assets.records?.length, 1);
  assert.equal(state.active_orders.records?.length, 1);
});

test("partial component never exposes partial records as canonical complete state", () => {
  const partial = obs("ASSET", [asset(1)], {
    status: "PARTIAL",
    error: { code: "PARTIAL_PAGE", message: "page 2 unavailable", retryable: true },
  });
  const state = reconstructPlayerState({
    collection_id: "sync-1",
    character_id: 90000001,
    observed_at: "2026-09-25T10:00:00Z",
    observations: [partial],
  });
  assert.equal(state.assets.records, null);
  assert.equal(state.assets.quality.availability, "PARTIAL");
  assert.equal(state.assets.quality.coverage, "PARTIAL");
  assert.equal(state.assets.quality.health, "DEGRADED");
});
