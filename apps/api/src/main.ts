import { createServer } from "node:http";
import { Pool } from "pg";
import {
  EconomicOperationRepository,
  OpportunityTrackingRepository,
} from "@eve-trade/db";
import { createApiHandler } from "./server.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to start the API");
}

const port = Number(process.env.PORT ?? "3000");
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error("PORT must be a valid TCP port");
}

const host = process.env.HOST ?? "0.0.0.0";
const pool = new Pool({ connectionString: databaseUrl });
const repository = new OpportunityTrackingRepository(pool);
const operationRepository = new EconomicOperationRepository(pool);
const server = createServer(
  createApiHandler({
    reader: repository,
    operationReader: operationRepository,
  }),
);

server.listen(port, host, () => {
  process.stdout.write(`EVE Trade v2 API listening on http://${host}:${port}\n`);
});

const shutdown = async (): Promise<void> => {
  server.close();
  await pool.end();
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
