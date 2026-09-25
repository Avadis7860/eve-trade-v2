import { Pool } from "pg";
import {
  EsiHttpClient,
  EsiMarketClient,
  EsiPlayerClient,
} from "@eve-trade/esi";
import { MarketObservationRepository, PlayerDataRepository } from "@eve-trade/db";
import { ingestMarketRegion } from "./market-ingestion.js";
import { syncPlayerData } from "./player-sync.js";

const databaseUrl = process.env.DATABASE_URL;
const userAgent = process.env.ESI_USER_AGENT;

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!userAgent) throw new Error("ESI_USER_AGENT is required");

const pool = new Pool({ connectionString: databaseUrl });
try {
  const playerCharacterId = Number(process.env.PLAYER_CHARACTER_ID);
  if (Number.isInteger(playerCharacterId) && playerCharacterId > 0) {
    const http = new EsiHttpClient({ userAgent });
    const client = new EsiPlayerClient(http);
    const repository = new PlayerDataRepository(pool);
    const sync = await syncPlayerData(
      client,
      repository,
      { async getAccessToken() { return process.env.ESI_ACCESS_TOKEN ?? null; } },
      { characterId: playerCharacterId },
    );
    console.log(JSON.stringify({
      collection_id: sync.collection_id,
      character_id: sync.character_id,
      status: sync.status,
      observations: sync.observations.length,
      wallet_available: sync.state.wallet.quality.availability,
      journal_available: sync.state.journal.quality.availability,
      transactions_available: sync.state.transactions.quality.availability,
      assets_available: sync.state.assets.quality.availability,
      active_orders_available: sync.state.active_orders.quality.availability,
    }));
  } else {
    const regionId = Number(process.env.REGION_ID);
    if (!Number.isInteger(regionId) || regionId <= 0) throw new Error("REGION_ID must be a positive integer in market mode");
    const repository = new MarketObservationRepository(pool);
    const client = new EsiMarketClient({ userAgent });
    const state = await ingestMarketRegion(client, repository, { regionId });
    console.log(JSON.stringify({
      collection_id: state.collection_id,
      region_id: state.region_id,
      status: state.status,
      source_pages: state.source_pages,
      orders: state.orders.length,
      duplicate_order_count: state.duplicate_order_count,
      cache_consistency: state.cache_consistency,
    }));
  }
} finally {
  await pool.end();
}
