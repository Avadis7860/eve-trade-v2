import type {
  CanonicalMarketState,
  EsiMarketOrder,
  MarketPageObservation,
  SourceProvenance,
} from "@eve-trade/contracts";

function provenance(regionId: number): SourceProvenance {
  return {
    source_kind: "ESI",
    source_id: `esi:markets/${regionId}/orders`,
    endpoint: `/markets/${regionId}/orders/`,
    principal_scope: "PUBLIC",
  };
}

export function reconstructCanonicalMarket(
  collectionId: string,
  regionId: number,
  observedAt: string,
  pages: MarketPageObservation[],
): CanonicalMarketState {
  if (pages.length === 0) {
    throw new Error("Cannot reconstruct canonical market state without observations");
  }

  const firstPage = pages[0];
  if (!firstPage) throw new Error("Cannot reconstruct canonical market state without a first page");
  const expected = firstPage.total_pages;
  const completed = new Set(pages.filter((p) => p.status === "COMPLETE").map((p) => p.page));
  const hasAllPages = completed.size === expected && [...Array(expected)].every((_, i) => completed.has(i + 1));
  const hasError = pages.some((p) => p.status === "ERROR" || p.error !== null);
  const lastModifieds = new Set(
    pages.map((p) => p.headers.last_modified).filter((value): value is string => value !== null),
  );
  const cacheConsistency =
    lastModifieds.size === 0 ? "UNVERIFIED" : lastModifieds.size === 1 ? "CONSISTENT" : "INCONSISTENT";

  const orders = new Map<number, EsiMarketOrder>();
  let duplicateOrderCount = 0;

  for (const page of pages) {
    for (const order of page.records) {
      if (orders.has(order.order_id)) duplicateOrderCount += 1;
      orders.set(order.order_id, order);
    }
  }

  const complete = hasAllPages && !hasError && cacheConsistency !== "INCONSISTENT";
  const status = complete ? "COMPLETE" : hasError ? "ERROR" : "PARTIAL";

  return {
    collection_id: collectionId,
    region_id: regionId,
    observed_at: observedAt,
    status,
    provenance: provenance(regionId),
    orders: [...orders.values()],
    source_pages: expected,
    duplicate_order_count: duplicateOrderCount,
    cache_last_modified: lastModifieds.size === 1 ? [...lastModifieds][0] ?? null : null,
    cache_consistency: cacheConsistency,
  };
}
