import { Pool } from "pg";
import { MarketObservationRepository } from "@eve-trade/db";
import { EsiMarketClient } from "@eve-trade/esi";
import { ingestMarketRegion } from "./market-ingestion.js";

const databaseUrl = process.env.DATABASE_URL;
const userAgent = process.env.ESI_USER_AGENT;
const regionId = Number(process.env.REGION_ID);

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!userAgent) throw new Error("ESI_USER_AGENT is required");
if (!Number.isInteger(regionId) || regionId <= 0) throw new Error("REGION_ID must be a positive integer");

const pool = new Pool({ connectionString: databaseUrl });
try {
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
} finally {
  await pool.end();
}
