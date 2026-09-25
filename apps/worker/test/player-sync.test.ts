import assert from "node:assert/strict";
import test from "node:test";
import type {
  CanonicalPlayerState,
  EsiCharacterOrder,
  EsiCharacterPublicInfo,
  PlayerObservation,
  PlayerSync,
} from "@eve-trade/contracts";
import type { EsiHttpResult } from "@eve-trade/esi";
import { EsiHttpError } from "@eve-trade/esi";
import { syncPlayerData } from "../src/player-sync.js";

function result<T>(data: T, endpoint: string, observedAt = "2026-09-25T10:00:00.000Z"): EsiHttpResult<T> {
  return {
    request_id: "request",
    endpoint,
    status: 200,
    observed_at: observedAt,
    retry_count: 0,
    data,
    headers: {
      x_pages: "1",
      last_modified: "same",
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
  };
}

const identity: EsiCharacterPublicInfo = { name: "Pilot", corporation_id: 98000001 };
const order = (id: number): EsiCharacterOrder => ({
  duration: 90, escrow: 0, is_buy_order: false, issued: "2026-09-25T10:00:00Z",
  location_id: 60003760, min_volume: 1, order_id: id, price: 100, range: "region",
  system_id: 30000142, type_id: 34, volume_remain: 10, volume_total: 10,
});

class MemoryRepository {
  syncs = new Map<string, PlayerSync["status"]>();
  observations: PlayerObservation[] = [];
  states: CanonicalPlayerState[] = [];

  async createSync(sync: { collection_id: string; status: PlayerSync["status"] }) {
    this.syncs.set(sync.collection_id, sync.status);
  }
  async saveObservation(observation: PlayerObservation) {
    this.observations.push(structuredClone(observation));
  }
  async saveCanonical(state: CanonicalPlayerState) {
    this.states.push(structuredClone(state));
  }
  async markSync(id: string, status: PlayerSync["status"]) {
    this.syncs.set(id, status);
  }
  async listObservations() {
    return structuredClone(this.observations);
  }
}

function clientFor(options: {
  failJournal?: boolean;
  characterId?: number;
}) {
  const characterId = options.characterId ?? 90000001;
  return {
    async fetchCharacter(id: number) {
      assert.equal(id, characterId);
      return result(identity, "/characters/{character_id}/");
    },
    async fetchWallet(id: number, _token: string) {
      assert.equal(id, characterId);
      return result(1250000, "/v1/characters/{character_id}/wallet/");
    },
    async fetchWalletJournalPage(id: number, page: number, _token: string) {
      assert.equal(id, characterId);
      if (options.failJournal) throw new EsiHttpError(403, "ESI_AUTHORIZATION", false, null);
      return result(page === 1 ? [] : [], "/v6/characters/{character_id}/wallet/journal/");
    },
    async fetchWalletTransactions(id: number, fromId: number | undefined, _token: string) {
      assert.equal(id, characterId);
      return fromId === undefined
        ? result([{ client_id: 1, date: "2026-09-25T10:00:00Z", is_buy: true, is_personal: true, journal_ref_id: 2, location_id: 3, quantity: 1, transaction_id: 2, type_id: 34, unit_price: 10 }], "/v1/characters/{character_id}/wallet/transactions/")
        : result([{ client_id: 1, date: "2026-09-24T10:00:00Z", is_buy: false, is_personal: true, journal_ref_id: 1, location_id: 3, quantity: 1, transaction_id: 1, type_id: 34, unit_price: 9 }], "/v1/characters/{character_id}/wallet/transactions/");
    },
    async fetchAssetsPage(id: number, page: number, _token: string) {
      assert.equal(id, characterId);
      return result(page === 1 ? [] : [], "/v5/characters/{character_id}/assets/");
    },
    async fetchActiveOrders(id: number, _token: string) {
      assert.equal(id, characterId);
      return result([order(42)], "/v2/characters/{character_id}/orders/");
    },
  };
}

test("missing credentials preserves UNKNOWN instead of manufacturing zeros", async () => {
  const repo = new MemoryRepository();
  let authenticatedCalls = 0;
  const client = {
    ...clientFor({}),
    async fetchWallet() { authenticatedCalls += 1; throw new Error("must not call"); },
    async fetchWalletJournalPage(_id: number, _page: number, _token: string) { authenticatedCalls += 1; throw new Error("must not call"); },
    async fetchWalletTransactions(_id: number, _fromId: number | undefined, _token: string) { authenticatedCalls += 1; throw new Error("must not call"); },
    async fetchAssetsPage() { authenticatedCalls += 1; throw new Error("must not call"); },
    async fetchActiveOrders() { authenticatedCalls += 1; throw new Error("must not call"); },
  };
  const sync = await syncPlayerData(
    client as never,
    repo as never,
    { async getAccessToken() { return null; } },
    { characterId: 90000001, collectionId: "00000000-0000-0000-0000-000000000001", observedAt: "2026-09-25T10:00:00Z" },
  );
  assert.equal(authenticatedCalls, 0);
  assert.equal(sync.status, "PARTIAL");
  assert.equal(sync.state.wallet.records, null);
  assert.equal(sync.state.wallet.quality.availability, "UNKNOWN");
  assert.equal(sync.state.wallet.quality.health, "UNKNOWN");
  assert.equal(sync.state.principal?.character_id, 90000001);
  assert.equal(sync.state.principal?.name, "Pilot");
});

test("one endpoint can fail without turning successful sibling components into empty invalid data", async () => {
  const repo = new MemoryRepository();
  const token = "secret-token";
  const sync = await syncPlayerData(
    clientFor({ failJournal: true }) as never,
    repo as never,
    { async getAccessToken() { return token; } },
    { characterId: 90000001, collectionId: "00000000-0000-0000-0000-000000000002", observedAt: "2026-09-25T10:00:00Z" },
  );
  assert.equal(sync.status, "ERROR");
  assert.equal(sync.state.wallet.records?.[0], 1250000);
  assert.equal(sync.state.journal.records, null);
  assert.equal(sync.state.transactions.records?.map((x) => x.transaction_id).join(","), "1,2");
  assert.equal(sync.state.active_orders.records?.[0]?.order_id, 42);
  assert.equal(repo.observations.length, 9);
  assert.ok(repo.observations.every((x) => !JSON.stringify(x).includes(token)));
});

test("synchronization keeps character isolation when two principals are collected", async () => {
  const repoA = new MemoryRepository();
  const repoB = new MemoryRepository();
  const provider = { async getAccessToken(id: number) { return `token-${id}`; } };
  const first = await syncPlayerData(clientFor({ characterId: 90000001 }) as never, repoA as never, provider,
    { characterId: 90000001, collectionId: "00000000-0000-0000-0000-000000000003", observedAt: "2026-09-25T10:00:00Z" });
  const second = await syncPlayerData(clientFor({ characterId: 90000002 }) as never, repoB as never, provider,
    { characterId: 90000002, collectionId: "00000000-0000-0000-0000-000000000004", observedAt: "2026-09-25T10:01:00Z" });
  assert.equal(first.character_id, 90000001);
  assert.equal(second.character_id, 90000002);
  assert.ok(repoA.observations.every((x) => x.character_id === 90000001));
  assert.ok(repoB.observations.every((x) => x.character_id === 90000002));
});

test("transactions terminate on the ESI from-id one-record boundary and deduplicate that overlap", async () => {
  const repo = new MemoryRepository();
  const sync = await syncPlayerData(
    clientFor({}) as never,
    repo as never,
    { async getAccessToken() { return "token"; } },
    { characterId: 90000001, collectionId: "00000000-0000-0000-0000-000000000005", observedAt: "2026-09-25T10:00:00Z" },
  );
  assert.deepEqual(sync.state.transactions.records?.map((x) => x.transaction_id), [1, 2]);
  const txObs = repo.observations.filter((x) => x.data_kind === "WALLET_TRANSACTION");
  assert.equal(txObs.length, 2);
  assert.equal(txObs[1]?.page_identity, "from_id:2");
});
