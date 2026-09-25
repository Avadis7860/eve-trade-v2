import { randomUUID } from "node:crypto";
import type { MarketCollection, MarketPageObservation } from "@eve-trade/contracts";
import { reconstructCanonicalMarket } from "@eve-trade/domain";
import { EsiHttpError, EsiMarketClient } from "@eve-trade/esi";
import { MarketObservationRepository } from "@eve-trade/db";

export interface MarketIngestionOptions {
  regionId: number;
  collectionId?: string;
  observedAt?: string;
}

function failedPage(
  regionId: number,
  collectionId: string,
  page: number,
  observedAt: string,
  error: unknown,
): MarketPageObservation {
  const esiError = error instanceof EsiHttpError ? error : null;
  return {
    observation_id: randomUUID(),
    collection_id: collectionId,
    region_id: regionId,
    page,
    total_pages: 1,
    observed_at: observedAt,
    status: "ERROR",
    provenance: {
      source_kind: "ESI",
      source_id: `esi:markets/${regionId}/orders`,
      endpoint: `/markets/${regionId}/orders/`,
      principal_scope: "PUBLIC",
    },
    http_status: esiError?.status || null,
    retry_count: 0,
    records: [],
    raw_payload: null,
    headers: {
      x_pages: null,
      last_modified: null,
      etag: null,
      expires: null,
      ratelimit_group: null,
      ratelimit_limit: null,
      ratelimit_remaining: null,
      ratelimit_used: null,
      retry_after: esiError?.retryAfterSeconds === null ? null : String(esiError?.retryAfterSeconds ?? ""),
      error_limit_remain: null,
      error_limit_reset: null,
      compatibility_date: null,
    },
    error: {
      code: esiError ? `ESI_HTTP_${esiError.status}` : "ESI_NETWORK_ERROR",
      message: error instanceof Error ? error.message : "Unknown ESI failure",
      retryable: esiError?.retryable ?? true,
    },
  };
}

export async function ingestMarketRegion(
  client: EsiMarketClient,
  repository: MarketObservationRepository,
  options: MarketIngestionOptions,
) {
  const observedAt = options.observedAt ?? new Date().toISOString();
  const collectionId = options.collectionId ?? randomUUID();

  let collection = options.collectionId
    ? await repository.getCollection(collectionId)
    : null;

  if (!collection) {
    collection = {
      collection_id: collectionId,
      region_id: options.regionId,
      observed_at: observedAt,
      expected_pages: null,
      completed_pages: [],
      status: "UNKNOWN",
      provenance: {
        source_kind: "ESI",
        source_id: `esi:markets/${options.regionId}/orders`,
        endpoint: `/markets/${options.regionId}/orders/`,
        principal_scope: "PUBLIC",
      },
      cache_last_modified: null,
      cache_consistency: "UNVERIFIED",
      error: null,
    } satisfies MarketCollection;
    await repository.createCollection(collection);
  }

  let expectedPages = collection.expected_pages;
  if (expectedPages === null) {
    try {
      const first = await client.fetchMarketPage(options.regionId, 1);
      const observation = { ...first, collection_id: collectionId };
      expectedPages = first.total_pages;
      await repository.savePage(observation);
      await repository.markCollection(collectionId, {
        expected_pages: expectedPages,
        status: "PARTIAL",
        cache_last_modified: first.headers.last_modified,
        cache_consistency: "UNVERIFIED",
        error: null,
      });
    } catch (error) {
      const failure = failedPage(options.regionId, collectionId, 1, observedAt, error);
      await repository.savePage(failure);
      await repository.markCollection(collectionId, {
        expected_pages: null,
        status: "ERROR",
        cache_last_modified: null,
        cache_consistency: "UNVERIFIED",
        error: failure.error,
      });
      throw error;
    }
  }

  const refreshed = await repository.getCollection(collectionId);
  const completed = new Set(refreshed?.completed_pages ?? []);

  for (let page = 1; page <= expectedPages; page += 1) {
    if (completed.has(page)) continue;
    try {
      const result = await client.fetchMarketPage(options.regionId, page);
      if (result.total_pages !== expectedPages) {
        const mismatch = new Error(
          `X-Pages changed during collection: expected ${expectedPages}, received ${result.total_pages}`,
        );
        const failure = failedPage(options.regionId, collectionId, page, result.observed_at, mismatch);
        failure.error = { code: "ESI_PAGINATION_CHANGED", message: mismatch.message, retryable: true };
        await repository.savePage(failure);
        await repository.markCollection(collectionId, {
          expected_pages: expectedPages,
          status: "ERROR",
          cache_last_modified: result.headers.last_modified,
          cache_consistency: "INCONSISTENT",
          error: failure.error,
        });
        throw mismatch;
      }
      await repository.savePage({ ...result, collection_id: collectionId });
    } catch (error) {
      const failure = failedPage(options.regionId, collectionId, page, new Date().toISOString(), error);
      await repository.savePage(failure);
      await repository.markCollection(collectionId, {
        expected_pages: expectedPages,
        status: "ERROR",
        cache_last_modified: null,
        cache_consistency: "UNVERIFIED",
        error: failure.error,
      });
      throw error;
    }
  }

  const pages = await repository.loadPages(collectionId);
  const canonical = reconstructCanonicalMarket(collectionId, options.regionId, observedAt, pages);
  if (canonical.status !== "COMPLETE") {
    await repository.markCollection(collectionId, {
      expected_pages: expectedPages,
      status: canonical.status === "ERROR" ? "ERROR" : "PARTIAL",
      cache_last_modified: canonical.cache_last_modified,
      cache_consistency: canonical.cache_consistency,
      error: canonical.status === "ERROR"
        ? { code: "MARKET_COLLECTION_INCOMPLETE", message: "Canonical market state cannot be declared complete" }
        : null,
    });
    return canonical;
  }

  await repository.saveCanonical(canonical);
  await repository.markCollection(collectionId, {
    expected_pages: expectedPages,
    status: "COMPLETE",
    cache_last_modified: canonical.cache_last_modified,
    cache_consistency: canonical.cache_consistency,
    error: null,
  });
  return canonical;
}
