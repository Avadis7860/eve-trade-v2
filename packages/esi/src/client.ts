import { randomUUID } from "node:crypto";
import type { EsiMarketOrder, MarketPageObservation } from "@eve-trade/contracts";
import {
  EsiHttpClient,
  EsiHttpError,
  type EsiHttpClientOptions,
  type EsiTransport,
} from "./http-client.js";

export { EsiHttpClient, EsiHttpError, type EsiTransport } from "./http-client.js";

export interface EsiClientOptions extends EsiHttpClientOptions {}

function isOrder(value: unknown): value is EsiMarketOrder {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.duration === "number" &&
    typeof record.escrow === "number" &&
    typeof record.is_buy_order === "boolean" &&
    typeof record.issued === "string" &&
    typeof record.location_id === "number" &&
    typeof record.min_volume === "number" &&
    typeof record.order_id === "number" &&
    typeof record.price === "number" &&
    typeof record.range === "string" &&
    typeof record.system_id === "number" &&
    typeof record.type_id === "number" &&
    typeof record.volume_remain === "number" &&
    typeof record.volume_total === "number"
  );
}

function parseOrders(payload: unknown): EsiMarketOrder[] {
  if (!Array.isArray(payload) || !payload.every(isOrder)) {
    throw new Error("ESI market response is not a valid market-order array");
  }
  return payload;
}

function parsePages(xPages: string | null): number {
  if (xPages === null) return 1;
  const pages = Number(xPages);
  if (!Number.isInteger(pages) || pages < 1) {
    throw new Error(`Invalid X-Pages header: ${xPages}`);
  }
  return pages;
}

export class EsiMarketClient {
  private readonly http: EsiHttpClient;

  constructor(options: EsiClientOptions) {
    this.http = new EsiHttpClient(options);
  }

  async fetchMarketPage(regionId: number, page: number): Promise<MarketPageObservation> {
    if (!Number.isInteger(regionId) || regionId <= 0) throw new Error("regionId must be a positive integer");
    if (!Number.isInteger(page) || page <= 0) throw new Error("page must be a positive integer");

    const endpoint = `/markets/${regionId}/orders/`;
    const result = await this.http.getJson<unknown>(endpoint, {
      query: { order_type: "all", page },
    });
    const records = parseOrders(result.data);

    return {
      observation_id: randomUUID(),
      collection_id: "",
      region_id: regionId,
      page,
      total_pages: parsePages(result.headers.x_pages),
      observed_at: result.observed_at,
      status: "COMPLETE",
      provenance: {
        source_kind: "ESI",
        source_id: `esi:markets/${regionId}/orders`,
        endpoint,
        principal_scope: "PUBLIC",
      },
      http_status: result.status,
      retry_count: result.retry_count,
      records,
      raw_payload: result.data,
      headers: result.headers,
      error: null,
    };
  }
}
