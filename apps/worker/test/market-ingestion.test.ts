import assert from "node:assert/strict";
import test from "node:test";
import type { MarketCollection, MarketPageObservation } from "@eve-trade/contracts";
import { EsiMarketClient, type EsiTransport } from "@eve-trade/esi";
import { ingestMarketRegion } from "../src/market-ingestion.js";

class MemoryRepository {
  collections = new Map<string, MarketCollection>();
  pages = new Map<string, MarketPageObservation[]>();
  canonical: unknown[] = [];

  async createCollection(c: MarketCollection) { this.collections.set(c.collection_id, structuredClone(c)); }
  async getCollection(id: string) { return this.collections.get(id) ? structuredClone(this.collections.get(id)!) : null; }
  async savePage(p: MarketPageObservation) {
    const list = this.pages.get(p.collection_id) ?? [];
    const next = list.filter((x) => x.page !== p.page);
    next.push(structuredClone(p));
    this.pages.set(p.collection_id, next.sort((a,b) => a.page-b.page));
  }
  async markCollection(id: string, update: Pick<MarketCollection, "expected_pages" | "status" | "cache_last_modified" | "cache_consistency" | "error">) {
    const c=this.collections.get(id)!;
    this.collections.set(id, {...c, ...update, completed_pages:(this.pages.get(id)??[]).filter(p=>p.status==="COMPLETE").map(p=>p.page)});
  }
  async loadPages(id: string) { return structuredClone(this.pages.get(id) ?? []); }
  async saveCanonical(c: unknown) { this.canonical.push(structuredClone(c)); }
}

const order = (id: number) => ({
  duration: 90, escrow: 0, is_buy_order: false, issued: "2026-09-25T10:00:00Z",
  location_id: 60003760, min_volume: 1, order_id: id, price: 100, range: "region",
  system_id: 30000142, type_id: 34, volume_remain: 10, volume_total: 10,
});

function response(body: unknown, status=200, headers: Record<string,string>={}) {
  return new Response(JSON.stringify(body), {status, headers: {"content-type":"application/json", ...headers}});
}

test("collects all advertised pages and persists a complete canonical state", async () => {
  const transport: EsiTransport = {
    fetch: async (input) => {
      const page = Number(new URL(String(input)).searchParams.get("page"));
      return response([order(page)], 200, {"X-Pages":"2", "Last-Modified":"same"});
    },
  };
  const repo = new MemoryRepository();
  const client = new EsiMarketClient({userAgent:"EVE-Trade-v2/test", transport});
  const state = await ingestMarketRegion(client, repo as never, {regionId:10000002, collectionId:"00000000-0000-0000-0000-000000000001", observedAt:"2026-09-25T10:00:00Z"});
  assert.equal(state.status, "COMPLETE");
  assert.equal((state as any).orders.length, 2);
  assert.equal(repo.canonical.length, 1);
});

test("resumes from persisted completed pages after an interruption", async () => {
  let failPageTwo = true;
  const transport: EsiTransport = {
    fetch: async (input) => {
      const page = Number(new URL(String(input)).searchParams.get("page"));
      if (page === 2 && failPageTwo) return response({error:"temporary"}, 503);
      return response([order(page)], 200, {"X-Pages":"3", "Last-Modified":"same"});
    },
  };
  const repo = new MemoryRepository();
  const client = new EsiMarketClient({userAgent:"EVE-Trade-v2/test", transport, retryBaseDelayMs:0, sleep:async()=>{}});
  const id = "00000000-0000-0000-0000-000000000002";
  await assert.rejects(() => ingestMarketRegion(client, repo as never, {regionId:10000002, collectionId:id, observedAt:"2026-09-25T10:00:00Z"}));
  failPageTwo = false;
  const state = await ingestMarketRegion(client, repo as never, {regionId:10000002, collectionId:id, observedAt:"2026-09-25T10:00:00Z"});
  assert.equal(state.status, "COMPLETE");
  assert.equal((state as any).orders.length, 3);
});

test("does not declare a collection complete when cache Last-Modified changes", async () => {
  const transport: EsiTransport = {
    fetch: async (input) => {
      const page = Number(new URL(String(input)).searchParams.get("page"));
      return response([order(page)], 200, {"X-Pages":"2", "Last-Modified":page === 1 ? "A" : "B"});
    },
  };
  const repo = new MemoryRepository();
  const client = new EsiMarketClient({userAgent:"EVE-Trade-v2/test", transport});
  const state = await ingestMarketRegion(client, repo as never, {regionId:10000002, collectionId:"00000000-0000-0000-0000-000000000003", observedAt:"2026-09-25T10:00:00Z"});
  assert.equal(state.status, "PARTIAL");
});
