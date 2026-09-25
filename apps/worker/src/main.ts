import { Pool } from "pg";
import {
  EsiHttpClient,
  EsiMarketClient,
  EsiPlayerClient,
} from "@eve-trade/esi";
import {
  MarketHistoryRepository,
  MarketObservationRepository,
  OpportunityTrackingRepository,
  PlayerDataRepository,
} from "@eve-trade/db";
import { ingestMarketRegion } from "./market-ingestion.js";
import { syncPlayerData } from "./player-sync.js";
import { rebuildMarketHistory } from "./market-history.js";
import { runOpportunityPipeline } from "./opportunity-pipeline.js";

const databaseUrl = process.env.DATABASE_URL;
const userAgent = process.env.ESI_USER_AGENT;
const compatibilityDate = process.env.ESI_COMPATIBILITY_DATE;

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!userAgent) throw new Error("ESI_USER_AGENT is required");

const esiOptions = compatibilityDate
  ? { userAgent, compatibilityDate }
  : { userAgent };

function optionalNonNegativeEnv(name: string): number | null {
  const value = process.env[name];
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(name + " must be a finite non-negative number");
  }
  return parsed;
}

const pool = new Pool({ connectionString: databaseUrl });
try {
  const playerCharacterId = Number(process.env.PLAYER_CHARACTER_ID);
  if (Number.isInteger(playerCharacterId) && playerCharacterId > 0) {
    const http = new EsiHttpClient(esiOptions);
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
    const historyRepository = new MarketHistoryRepository(pool);
    const trackingRepository = new OpportunityTrackingRepository(pool);
    const client = new EsiMarketClient(esiOptions);
    const state = await ingestMarketRegion(client, repository, { regionId });
    const history = await rebuildMarketHistory(repository, historyRepository);
    const historySnapshot =
      history.snapshots.find((item) => item.collection_id === state.collection_id) ?? null;
    const pipeline = await runOpportunityPipeline(
      state,
      historySnapshot,
      trackingRepository,
      {
        regionId: state.region_id,
        observedAt: state.observed_at,
        deployableCapital: optionalNonNegativeEnv("DEPLOYABLE_CAPITAL"),
        salesTaxRate: optionalNonNegativeEnv("SALES_TAX_RATE"),
      },
    );
    console.log(JSON.stringify({
      collection_id: state.collection_id,
      region_id: state.region_id,
      status: state.status,
      source_pages: state.source_pages,
      orders: state.orders.length,
      duplicate_order_count: state.duplicate_order_count,
      cache_consistency: state.cache_consistency,
      opportunity_pipeline: pipeline,
    }));
  }
} finally {
  await pool.end();
}
