import { createHash } from "node:crypto";
import type {
  EsiMarketOrder,
  MarketCollection,
  MarketDepthLevel,
  MarketHistoryObservationKind,
  MarketHistorySnapshot,
  MarketHistorySourceConsistency,
  MarketOrderComparableField,
  MarketOrderEvolution,
  MarketSnapshotTypeMetrics,
  MarketPageObservation,
} from "@eve-trade/contracts";
import { reconstructCanonicalMarket } from "./market-reducer.js";

export const MARKET_HISTORY_CONTRACT_VERSION = 1;

const COMPARABLE_FIELDS: MarketOrderComparableField[] = [
  "duration",
  "escrow",
  "is_buy_order",
  "issued",
  "location_id",
  "min_volume",
  "price",
  "range",
  "system_id",
  "type_id",
  "volume_remain",
  "volume_total",
];

function compareOrderId(a: EsiMarketOrder, b: EsiMarketOrder): number {
  return a.order_id === b.order_id ? 0 : a.order_id < b.order_id ? -1 : 1;
}

function stableOrderProjection(order: EsiMarketOrder): unknown[] {
  return COMPARABLE_FIELDS.map((field) => order[field]).concat(order.order_id);
}

export function fingerprintMarketState(orders: EsiMarketOrder[]): string {
  const canonical = [...orders].sort(compareOrderId).map(stableOrderProjection);
  return createHash("sha256")
    .update(JSON.stringify({ version: MARKET_HISTORY_CONTRACT_VERSION, orders: canonical }), "utf8")
    .digest("hex");
}

export function deriveSourceMetadata(pages: MarketPageObservation[]): {
  source_last_modified: string | null;
  source_compatibility_date: string | null;
  source_consistency: MarketHistorySourceConsistency;
} {
  const lastModifieds = new Set(
    pages
      .map((page) => page.headers.last_modified)
      .filter((value): value is string => value !== null),
  );
  const compatibilityDates = new Set(
    pages
      .map((page) => page.headers.compatibility_date)
      .filter((value): value is string => value !== null),
  );

  const hasConflict = lastModifieds.size > 1 || compatibilityDates.size > 1;
  const hasMissing = pages.some(
    (page) => page.headers.last_modified === null || page.headers.compatibility_date === null,
  );

  return {
    source_last_modified: lastModifieds.size === 1 ? [...lastModifieds][0] ?? null : null,
    source_compatibility_date:
      compatibilityDates.size === 1 ? [...compatibilityDates][0] ?? null : null,
    source_consistency: hasConflict ? "INCONSISTENT" : hasMissing ? "UNVERIFIED" : "CONSISTENT",
  };
}

export function deriveMarketDepth(
  snapshotId: string,
  orders: EsiMarketOrder[],
): MarketDepthLevel[] {
  const levels = new Map<string, MarketDepthLevel>();

  for (const order of orders) {
    const key = [
      order.type_id,
      order.is_buy_order ? "BUY" : "SELL",
      String(order.price),
    ].join(":");

    const current = levels.get(key);
    if (current) {
      current.volume_remain += order.volume_remain;
      current.order_count += 1;
      continue;
    }

    levels.set(key, {
      snapshot_id: snapshotId,
      type_id: order.type_id,
      is_buy_order: order.is_buy_order,
      price: order.price,
      volume_remain: order.volume_remain,
      order_count: 1,
    });
  }

  return [...levels.values()].sort((a, b) => {
    if (a.type_id !== b.type_id) return a.type_id - b.type_id;
    if (a.is_buy_order !== b.is_buy_order) return a.is_buy_order ? -1 : 1;
    if (a.price === b.price) return 0;
    return a.is_buy_order ? b.price - a.price : a.price - b.price;
  });
}

export function deriveMarketTypeMetrics(
  snapshotId: string,
  orders: EsiMarketOrder[],
): MarketSnapshotTypeMetrics[] {
  const byType = new Map<number, EsiMarketOrder[]>();
  for (const order of orders) {
    const list = byType.get(order.type_id) ?? [];
    list.push(order);
    byType.set(order.type_id, list);
  }

  return [...byType.entries()]
    .sort(([a], [b]) => a - b)
    .map(([typeId, typeOrders]) => {
      const buys = typeOrders.filter((order) => order.is_buy_order);
      const sells = typeOrders.filter((order) => !order.is_buy_order);
      let bestBuyPrice: number | null = null;
      let bestSellPrice: number | null = null;
      for (const order of buys) {
        if (bestBuyPrice === null || order.price > bestBuyPrice) bestBuyPrice = order.price;
      }
      for (const order of sells) {
        if (bestSellPrice === null || order.price < bestSellPrice) bestSellPrice = order.price;
      }
      const bestBuyVolume =
        bestBuyPrice === null
          ? null
          : buys
              .filter((order) => order.price === bestBuyPrice)
              .reduce((sum, order) => sum + order.volume_remain, 0);
      const bestSellVolume =
        bestSellPrice === null
          ? null
          : sells
              .filter((order) => order.price === bestSellPrice)
              .reduce((sum, order) => sum + order.volume_remain, 0);
      const spreadAbsolute =
        bestBuyPrice === null || bestSellPrice === null ? null : bestSellPrice - bestBuyPrice;
      const spreadRelative =
        spreadAbsolute === null || bestSellPrice === null || bestSellPrice === 0
          ? null
          : spreadAbsolute / bestSellPrice;

      return {
        snapshot_id: snapshotId,
        type_id: typeId,
        best_buy_price: bestBuyPrice,
        best_buy_volume: bestBuyVolume,
        best_sell_price: bestSellPrice,
        best_sell_volume: bestSellVolume,
        spread_absolute: spreadAbsolute,
        spread_relative: spreadRelative,
        buy_visible_volume: buys.reduce((sum, order) => sum + order.volume_remain, 0),
        sell_visible_volume: sells.reduce((sum, order) => sum + order.volume_remain, 0),
      };
    });
}

export function compareMarketOrders(
  previousSnapshotId: string,
  snapshotId: string,
  previousOrders: EsiMarketOrder[],
  currentOrders: EsiMarketOrder[],
): MarketOrderEvolution[] {
  const previous = new Map(previousOrders.map((order) => [order.order_id, order]));
  const current = new Map(currentOrders.map((order) => [order.order_id, order]));
  const ids = [...new Set([...previous.keys(), ...current.keys()])].sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));

  return ids.map((orderId) => {
    const previousOrder = previous.get(orderId) ?? null;
    const currentOrder = current.get(orderId) ?? null;

    if (previousOrder === null) {
      return {
        previous_snapshot_id: previousSnapshotId,
        snapshot_id: snapshotId,
        order_id: orderId,
        kind: "APPEARED",
        changed_fields: [],
        previous_order: null,
        current_order: currentOrder,
      };
    }

    if (currentOrder === null) {
      return {
        previous_snapshot_id: previousSnapshotId,
        snapshot_id: snapshotId,
        order_id: orderId,
        kind: "DISAPPEARED",
        changed_fields: [],
        previous_order: previousOrder,
        current_order: null,
      };
    }

    const changedFields = COMPARABLE_FIELDS.filter(
      (field) => previousOrder[field] !== currentOrder[field],
    );

    return {
      previous_snapshot_id: previousSnapshotId,
      snapshot_id: snapshotId,
      order_id: orderId,
      kind: changedFields.length === 0 ? "UNCHANGED" : "MODIFIED",
      changed_fields: changedFields,
      previous_order: previousOrder,
      current_order: currentOrder,
    };
  });
}

export interface MarketHistoryInput {
  collection: MarketCollection;
  pages: MarketPageObservation[];
}

export interface MarketHistoryBuildResult {
  snapshots: MarketHistorySnapshot[];
  metrics: MarketSnapshotTypeMetrics[];
  depth_levels: MarketDepthLevel[];
  order_evolution: MarketOrderEvolution[];
}

function unavailableSnapshot(
  collection: MarketCollection,
  source: ReturnType<typeof deriveSourceMetadata>,
  status: MarketHistorySnapshot["status"],
  sourcePages: number | null,
): MarketHistorySnapshot {
  return {
    snapshot_id: collection.collection_id,
    collection_id: collection.collection_id,
    region_id: collection.region_id,
    observed_at: collection.observed_at,
    status,
    comparison_eligible: false,
    state_fingerprint: null,
    source_last_modified: source.source_last_modified,
    source_compatibility_date: source.source_compatibility_date,
    source_consistency: source.source_consistency,
    observation_kind: "NOT_COMPARABLE",
    previous_snapshot_id: null,
    source_pages: sourcePages,
  };
}

export function buildMarketHistory(inputs: MarketHistoryInput[]): MarketHistoryBuildResult {
  const ordered = [...inputs].sort((a, b) => {
    if (a.collection.observed_at !== b.collection.observed_at) {
      return a.collection.observed_at < b.collection.observed_at ? -1 : 1;
    }
    return a.collection.collection_id < b.collection.collection_id ? -1 : 1;
  });

  const snapshots: MarketHistorySnapshot[] = [];
  const metrics: MarketSnapshotTypeMetrics[] = [];
  const depth_levels: MarketDepthLevel[] = [];
  const order_evolution: MarketOrderEvolution[] = [];
  const previousComparableByRegion = new Map<number, { snapshot: MarketHistorySnapshot; orders: EsiMarketOrder[] }>();

  for (const input of ordered) {
    const source = deriveSourceMetadata(input.pages);
    const sourcePages = input.collection.expected_pages ?? (input.pages.length > 0 ? input.pages[0]?.total_pages ?? null : null);

    if (input.collection.status !== "COMPLETE" || input.pages.length === 0) {
      snapshots.push(unavailableSnapshot(input.collection, source, input.collection.status, sourcePages));
      continue;
    }

    let canonical;
    try {
      canonical = reconstructCanonicalMarket(
        input.collection.collection_id,
        input.collection.region_id,
        input.collection.observed_at,
        input.pages,
      );
    } catch {
      snapshots.push(unavailableSnapshot(input.collection, source, "ERROR", sourcePages));
      continue;
    }

    const eligible =
      canonical.status === "COMPLETE" &&
      input.collection.status === "COMPLETE" &&
      input.collection.cache_consistency !== "INCONSISTENT" &&
      source.source_consistency !== "INCONSISTENT";

    if (!eligible) {
      snapshots.push(
        unavailableSnapshot(input.collection, source, canonical.status, canonical.source_pages),
      );
      continue;
    }

    const fingerprint = fingerprintMarketState(canonical.orders);
    const previousComparable = previousComparableByRegion.get(input.collection.region_id);
    const observationKind: MarketHistoryObservationKind =
      previousComparable === undefined
        ? "INITIAL"
        : previousComparable.snapshot.state_fingerprint === fingerprint
          ? "REPEAT"
          : "NEW_STATE";

    const snapshot: MarketHistorySnapshot = {
      snapshot_id: input.collection.collection_id,
      collection_id: input.collection.collection_id,
      region_id: input.collection.region_id,
      observed_at: input.collection.observed_at,
      status: "COMPLETE",
      comparison_eligible: true,
      state_fingerprint: fingerprint,
      source_last_modified: source.source_last_modified,
      source_compatibility_date: source.source_compatibility_date,
      source_consistency: source.source_consistency,
      observation_kind: observationKind,
      previous_snapshot_id: previousComparable?.snapshot.snapshot_id ?? null,
      source_pages: canonical.source_pages,
    };

    snapshots.push(snapshot);
    metrics.push(...deriveMarketTypeMetrics(snapshot.snapshot_id, canonical.orders));
    depth_levels.push(...deriveMarketDepth(snapshot.snapshot_id, canonical.orders));

    if (previousComparable !== null) {
      order_evolution.push(
        ...compareMarketOrders(
          previousComparable.snapshot.snapshot_id,
          snapshot.snapshot_id,
          previousComparable.orders,
          canonical.orders,
        ),
      );
    }

    previousComparableByRegion.set(input.collection.region_id, { snapshot, orders: canonical.orders });
  }

  return { snapshots, metrics, depth_levels, order_evolution };
}
