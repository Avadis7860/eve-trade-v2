import type { EsiMarketOrder, MarketPageObservation } from "@eve-trade/contracts";

export interface EsiTransport {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface EsiClientOptions {
  baseUrl?: string;
  userAgent: string;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  transport?: EsiTransport;
}

export class EsiHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryable: boolean,
    public readonly retryAfterSeconds: number | null,
  ) {
    super(message);
    this.name = "EsiHttpError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function header(response: Response, name: string): string | null {
  return response.headers.get(name);
}

function retryAfterSeconds(response: Response): number | null {
  const value = header(response, "Retry-After");
  if (value === null) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function parsePages(response: Response): number {
  const raw = header(response, "X-Pages");
  if (raw === null) return 1;
  const pages = Number(raw);
  if (!Number.isInteger(pages) || pages < 1) {
    throw new Error(`Invalid X-Pages header: ${raw}`);
  }
  return pages;
}

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

function errorCode(status: number): string {
  if (status === 420) return "ESI_ERROR_LIMIT";
  if (status === 429) return "ESI_RATE_LIMIT";
  if (status >= 500) return "ESI_SERVER_ERROR";
  if (status === 401 || status === 403) return "ESI_AUTHORIZATION";
  if (status === 404) return "ESI_NOT_FOUND";
  return `ESI_HTTP_${status}`;
}

export class EsiMarketClient {
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly transport: EsiTransport;

  constructor(private readonly options: EsiClientOptions) {
    this.baseUrl = options.baseUrl ?? "https://esi.evetech.net/latest";
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => new Date());
    this.transport = options.transport ?? { fetch: globalThis.fetch.bind(globalThis) };
  }

  async fetchMarketPage(regionId: number, page: number): Promise<MarketPageObservation> {
    if (!Number.isInteger(regionId) || regionId <= 0) throw new Error("regionId must be a positive integer");
    if (!Number.isInteger(page) || page <= 0) throw new Error("page must be a positive integer");

    const endpoint = `/markets/${regionId}/orders/`;
    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.set("order_type", "all");
    url.searchParams.set("page", String(page));

    let retryCount = 0;
    while (true) {
      const observedAt = this.now().toISOString();
      try {
        const response = await this.transport.fetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": this.options.userAgent,
          },
        });

        if (response.ok) {
          const rawPayload: unknown = await response.json();
          const records = parseOrders(rawPayload);
          const totalPages = parsePages(response);
          return {
            collection_id: "",
            region_id: regionId,
            page,
            total_pages: totalPages,
            observed_at: observedAt,
            status: "COMPLETE",
            provenance: {
              source_kind: "ESI",
              source_id: `esi:markets/${regionId}/orders`,
              endpoint,
              principal_scope: "PUBLIC",
            },
            http_status: response.status,
            retry_count: retryCount,
            records,
            raw_payload: rawPayload,
            headers: {
              x_pages: header(response, "X-Pages"),
              last_modified: header(response, "Last-Modified"),
              etag: header(response, "ETag"),
              expires: header(response, "Expires"),
              ratelimit_group: header(response, "X-Ratelimit-Group"),
              ratelimit_limit: header(response, "X-Ratelimit-Limit"),
              ratelimit_remaining: header(response, "X-Ratelimit-Remaining"),
              ratelimit_used: header(response, "X-Ratelimit-Used"),
              retry_after: header(response, "Retry-After"),
              error_limit_remain: header(response, "X-ESI-Error-Limit-Remain"),
              error_limit_reset: header(response, "X-ESI-Error-Limit-Reset"),
            },
            error: null,
          };
        }

        const retryAfter = retryAfterSeconds(response);
        const error = new EsiHttpError(
          response.status,
          `ESI returned HTTP ${response.status}`,
          response.status === 420 || response.status === 429 || response.status >= 500,
          retryAfter,
        );

        if (!error.retryable || retryCount >= this.maxRetries) throw error;

        const reset = Number(header(response, "X-ESI-Error-Limit-Reset") ?? "NaN");
        const delay = retryAfter !== null ? retryAfter * 1000 : Number.isFinite(reset) ? reset * 1000 : this.retryBaseDelayMs * 2 ** retryCount;
        await this.sleep(delay);
        retryCount += 1;
      } catch (error) {
        if (error instanceof EsiHttpError) throw error;
        if (retryCount >= this.maxRetries) {
          throw new EsiHttpError(0, error instanceof Error ? error.message : "ESI network error", true, null);
        }
        await this.sleep(this.retryBaseDelayMs * 2 ** retryCount);
        retryCount += 1;
      }
    }
  }
}
