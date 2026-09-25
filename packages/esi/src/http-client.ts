import { randomUUID } from "node:crypto";
import type { EsiResponseMetadata } from "@eve-trade/contracts";

export interface EsiTransport {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface EsiHttpClientOptions {
  baseUrl?: string;
  userAgent: string;
  compatibilityDate?: string;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  transport?: EsiTransport;
}

export interface EsiRequestOptions {
  query?: Record<string, string | number | undefined>;
  accessToken?: string;
  ifNoneMatch?: string;
}

export interface EsiHttpResult<T> {
  request_id: string;
  endpoint: string;
  status: number;
  observed_at: string;
  retry_count: number;
  data: T;
  headers: EsiResponseMetadata;
}

const DEFAULT_COMPATIBILITY_DATE = "2026-09-25";

export interface EsiHttpErrorContext {
  request_id: string;
  endpoint: string;
  observed_at: string;
  retry_count: number;
  headers: EsiResponseMetadata;
}

function emptyHeaders(compatibilityDate: string): EsiResponseMetadata {
  return {
    x_pages: null,
    last_modified: null,
    etag: null,
    expires: null,
    ratelimit_group: null,
    ratelimit_limit: null,
    ratelimit_remaining: null,
    ratelimit_used: null,
    retry_after: null,
    error_limit_remain: null,
    error_limit_reset: null,
    compatibility_date: compatibilityDate,
  };
}

export class EsiHttpError extends Error {
  public readonly request_id: string | null;
  public readonly endpoint: string | null;
  public readonly observed_at: string | null;
  public readonly retry_count: number;
  public readonly headers: EsiResponseMetadata;

  constructor(
    public readonly status: number,
    message: string,
    public readonly retryable: boolean,
    public readonly retryAfterSeconds: number | null,
    context: Partial<EsiHttpErrorContext> = {},
  ) {
    super(message);
    this.name = "EsiHttpError";
    this.request_id = context.request_id ?? null;
    this.endpoint = context.endpoint ?? null;
    this.observed_at = context.observed_at ?? null;
    this.retry_count = context.retry_count ?? 0;
    this.headers = context.headers ?? emptyHeaders(DEFAULT_COMPATIBILITY_DATE);
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

function errorCode(status: number): string {
  if (status === 420) return "ESI_ERROR_LIMIT";
  if (status === 429) return "ESI_RATE_LIMIT";
  if (status >= 500) return "ESI_SERVER_ERROR";
  if (status === 401 || status === 403) return "ESI_AUTHORIZATION";
  if (status === 404) return "ESI_NOT_FOUND";
  return `ESI_HTTP_${status}`;
}

function headersOf(response: Response, compatibilityDate: string): EsiResponseMetadata {
  return {
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
    compatibility_date: header(response, "X-Compatibility-Date") ?? compatibilityDate,
  };
}

function compatibilityDateOf(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + "T00:00:00Z"))) {
    throw new Error("compatibilityDate must be YYYY-MM-DD");
  }
  return value;
}

export class EsiHttpClient {
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly transport: EsiTransport;

  constructor(private readonly options: EsiHttpClientOptions) {
    this.baseUrl = options.baseUrl ?? "https://esi.evetech.net";
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => new Date());
    this.transport = options.transport ?? { fetch: globalThis.fetch.bind(globalThis) };
  }

  async getJson<T>(endpoint: string, options: EsiRequestOptions = {}): Promise<EsiHttpResult<T>> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let retryCount = 0;
    const compatibilityDate = compatibilityDateOf(this.options.compatibilityDate ?? DEFAULT_COMPATIBILITY_DATE);

    while (true) {
      const observedAt = this.now().toISOString();
      const requestId = randomUUID();
      try {
        const headers: Record<string, string> = {
          Accept: "application/json",
          "User-Agent": this.options.userAgent,
          "X-Compatibility-Date": compatibilityDate,
        };
        if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;
        if (options.ifNoneMatch) headers["If-None-Match"] = options.ifNoneMatch;

        const response = await this.transport.fetch(url, { headers });

        if (response.ok) {
          const data = (await response.json()) as T;
          return {
            request_id: requestId,
            endpoint,
            status: response.status,
            observed_at: observedAt,
            retry_count: retryCount,
            data,
            headers: headersOf(response, compatibilityDate),
          };
        }

        const retryAfter = retryAfterSeconds(response);
        const retryable = response.status === 420 || response.status === 429 || response.status >= 500;
        const error = new EsiHttpError(
          response.status,
          `HTTP ${response.status}: ${errorCode(response.status)}`,
          retryable,
          retryAfter,
          {
            request_id: requestId,
            endpoint,
            observed_at: observedAt,
            retry_count: retryCount,
            headers: headersOf(response, compatibilityDate),
          },
        );

        if (!retryable || retryCount >= this.maxRetries) throw error;

        const reset = Number(header(response, "X-ESI-Error-Limit-Reset") ?? "NaN");
        const delay =
          retryAfter !== null
            ? retryAfter * 1000
            : Number.isFinite(reset)
              ? reset * 1000
              : this.retryBaseDelayMs * 2 ** retryCount;
        await this.sleep(delay);
        retryCount += 1;
      } catch (error) {
        if (error instanceof EsiHttpError) throw error;
        if (retryCount >= this.maxRetries) {
          throw new EsiHttpError(
            0,
            "ESI_NETWORK_ERROR",
            true,
            null,
            {
              request_id: requestId,
              endpoint,
              observed_at: observedAt,
              retry_count: retryCount,
              headers: emptyHeaders(compatibilityDate),
            },
          );
        }
        await this.sleep(this.retryBaseDelayMs * 2 ** retryCount);
        retryCount += 1;
      }
    }
  }
}
