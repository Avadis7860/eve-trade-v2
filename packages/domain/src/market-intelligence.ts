import type {
  EsiMarketOrder,
  HistoricalPriceRegime,
  MarketBookAnomaly,
  MarketLiquiditySnapshot,
  MarketSnapshotTypeMetrics,
  TradeDayCoverage,
} from "@eve-trade/contracts";

type LiquidityInput = {
  snapshot_id: string;
  type_id: number;
  orders: EsiMarketOrder[];
  requested_quantity?: number | null;
  depth_levels?: number;
  provenance: MarketLiquiditySnapshot["provenance"];
};

export function deriveMarketLiquidity(input: LiquidityInput): MarketLiquiditySnapshot {
  const depthLimit = Math.max(1, Math.floor(input.depth_levels ?? 5));
  const orders = input.orders.filter(
    (order) => order.type_id === input.type_id && order.volume_remain > 0,
  );
  const sells = orders.filter((order) => !order.is_buy_order).sort(
    (a, b) => a.price - b.price || a.order_id - b.order_id,
  );
  const buys = orders.filter((order) => order.is_buy_order).sort(
    (a, b) => b.price - a.price || a.order_id - b.order_id,
  );
  const topSells = sells.slice(0, depthLimit);
  const topBuys = buys.slice(0, depthLimit);
  const visibleSupply = sells.reduce((sum, order) => sum + order.volume_remain, 0);
  const visibleDemand = buys.reduce((sum, order) => sum + order.volume_remain, 0);
  const sellDepth = topSells.reduce((sum, order) => sum + order.volume_remain, 0);
  const buyDepth = topBuys.reduce((sum, order) => sum + order.volume_remain, 0);
  const requested = input.requested_quantity ?? null;
  return {
    contract_version: "phase-08.3",
    snapshot_id: input.snapshot_id,
    type_id: input.type_id,
    visible_supply: visibleSupply,
    visible_demand: visibleDemand,
    best_sell_depth: sellDepth,
    best_buy_depth: buyDepth,
    requested_quantity: requested,
    sell_quantity_coverage:
      requested === null || requested <= 0
        ? null
        : Math.min(1, sellDepth / requested),
    buy_quantity_coverage:
      requested === null || requested <= 0
        ? null
        : Math.min(1, buyDepth / requested),
    depth_levels_considered: depthLimit,
    status: "COMPLETE",
    provenance: input.provenance,
  };
}

export function deriveTradeDayCoverage(
  visibleQuantity: number | null,
  referenceDailyQuantity: number | null,
  status: TradeDayCoverage["status"] = "COMPLETE",
  provenance: TradeDayCoverage["provenance"] = null,
): TradeDayCoverage {
  if (status === "ERROR") {
    return {
      visible_quantity: visibleQuantity,
      reference_daily_quantity: referenceDailyQuantity,
      trade_days: null,
      status,
      method: "VISIBLE_QUANTITY_OVER_REFERENCE_DAILY_QUANTITY",
      provenance,
    };
  }
  if (visibleQuantity === null || !Number.isFinite(visibleQuantity) || visibleQuantity < 0) {
    return {
      visible_quantity: visibleQuantity,
      reference_daily_quantity: referenceDailyQuantity,
      trade_days: null,
      status: "UNKNOWN",
      method: "VISIBLE_QUANTITY_OVER_REFERENCE_DAILY_QUANTITY",
      provenance,
    };
  }
  if (referenceDailyQuantity === null) {
    return {
      visible_quantity: visibleQuantity,
      reference_daily_quantity: null,
      trade_days: null,
      status: "UNKNOWN",
      method: "VISIBLE_QUANTITY_OVER_REFERENCE_DAILY_QUANTITY",
      provenance,
    };
  }
  if (!Number.isFinite(referenceDailyQuantity) || referenceDailyQuantity <= 0) {
    return {
      visible_quantity: visibleQuantity,
      reference_daily_quantity: referenceDailyQuantity,
      trade_days: null,
      status: "ERROR",
      method: "VISIBLE_QUANTITY_OVER_REFERENCE_DAILY_QUANTITY",
      provenance,
    };
  }
  return {
    visible_quantity: visibleQuantity,
    reference_daily_quantity: referenceDailyQuantity,
    trade_days: visibleQuantity / referenceDailyQuantity,
    status: status === "PARTIAL" ? "PARTIAL" : "COMPLETE",
    method: "VISIBLE_QUANTITY_OVER_REFERENCE_DAILY_QUANTITY",
    provenance,
  };
}

export type HistoricalPricePoint = MarketSnapshotTypeMetrics & { observed_at: string };

export function deriveHistoricalPricePosition(
  typeId: number,
  referencePrice: number | null,
  history: HistoricalPricePoint[],
): {
  type_id: number;
  reference_price: number | null;
  historical_min: number | null;
  historical_max: number | null;
  historical_percentile: number | null;
  range_position: number | null;
  recent_change: number | null;
  volatility: number | null;
  regime: HistoricalPriceRegime;
  status: "COMPLETE" | "PARTIAL" | "UNKNOWN";
} {
  const validPoints = history.filter(
    (item) =>
      item.type_id === typeId &&
      item.best_sell_price !== null &&
      Number.isFinite(item.best_sell_price) &&
      item.best_sell_price > 0,
  );
  const points = validPoints.map((item) => item.best_sell_price!);
  const recent = validPoints
    .filter((item) => Number.isFinite(Date.parse(item.observed_at)))
    .sort(
      (a, b) =>
        Date.parse(a.observed_at) - Date.parse(b.observed_at) ||
        a.snapshot_id.localeCompare(b.snapshot_id),
    );
  const hasInvalidTimestamp = validPoints.some(
    (item) => !Number.isFinite(Date.parse(item.observed_at)),
  );

  if (
    referencePrice === null ||
    !Number.isFinite(referencePrice) ||
    referencePrice <= 0 ||
    points.length === 0
  ) {
    return {
      type_id: typeId,
      reference_price: referencePrice,
      historical_min: points.length ? Math.min(...points) : null,
      historical_max: points.length ? Math.max(...points) : null,
      historical_percentile: null,
      range_position: null,
      recent_change: null,
      volatility: null,
      regime: "UNKNOWN",
      status: points.length === 0 ? "UNKNOWN" : "PARTIAL",
    };
  }

  const sorted = [...points].sort((a, b) => a - b);
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const lessOrEqual = sorted.filter((value) => value <= referencePrice).length;
  const percentile = lessOrEqual / sorted.length;
  const rangePosition =
    max === min
      ? 0.5
      : Math.min(1, Math.max(0, (referencePrice - min) / (max - min)));
  const previous =
    recent.length >= 2 ? recent[recent.length - 2]!.best_sell_price : null;
  const recentChange =
    previous !== null && previous > 0
      ? (referencePrice - previous) / previous
      : null;
  const returns = recent
    .slice(1)
    .map((item, index) => {
      const prev = recent[index]!.best_sell_price!;
      return prev > 0 ? (item.best_sell_price! - prev) / prev : null;
    })
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const volatility =
    returns.length > 1
      ? Math.sqrt(
          returns.reduce((sum, value) => sum + value * value, 0) /
            returns.length,
        )
      : null;
  const regime: HistoricalPriceRegime =
    referencePrice < min || referencePrice > max
      ? "BREAKOUT"
      : rangePosition < 0.2
        ? "LOW_RANGE"
        : rangePosition > 0.8
          ? "HIGH_RANGE"
          : "NORMAL_RANGE";

  return {
    type_id: typeId,
    reference_price: referencePrice,
    historical_min: min,
    historical_max: max,
    historical_percentile: percentile,
    range_position: rangePosition,
    recent_change: recentChange,
    volatility,
    regime,
    status: hasInvalidTimestamp ? "PARTIAL" : "COMPLETE",
  };
}

export interface BookAnomalyInput {
  previous: MarketSnapshotTypeMetrics;
  current: MarketSnapshotTypeMetrics;
  detected_at: string;
  provenance: MarketBookAnomaly["provenance"];
  relative_volume_threshold?: number;
  relative_price_threshold?: number;
}

export function detectBookAnomalies(input: BookAnomalyInput): MarketBookAnomaly[] {
  const volumeThreshold = Math.max(0.01, input.relative_volume_threshold ?? 0.5);
  const priceThreshold = Math.max(0.001, input.relative_price_threshold ?? 0.1);
  if (input.previous.type_id !== input.current.type_id) return [];
  const results: MarketBookAnomaly[] = [];
  const change = (before: number | null, after: number | null): number | null =>
    before !== null && after !== null && before > 0 ? (after - before) / before : null;
  const buyChange = change(input.previous.buy_visible_volume, input.current.buy_visible_volume);
  const sellChange = change(input.previous.sell_visible_volume, input.current.sell_visible_volume);
  const sellPriceChange = change(input.previous.best_sell_price, input.current.best_sell_price);
  const buyPriceChange = change(input.previous.best_buy_price, input.current.best_buy_price);
  const base = {
    type_id: input.current.type_id,
    detected_at: input.detected_at,
    baseline_snapshot_id: input.previous.snapshot_id,
    comparison_snapshot_id: input.current.snapshot_id,
    confidence: "NOT_ASSESSED" as const,
    provenance: input.provenance,
  };
  if (sellChange !== null && sellChange <= -volumeThreshold) {
    results.push({ ...base, kind: "SELL_LIQUIDITY_DROP", comparison_basis: "visible sell volume", method: "relative change against previous complete snapshot" });
  }
  if (buyChange !== null && buyChange <= -volumeThreshold) {
    results.push({ ...base, kind: "BUY_LIQUIDITY_DROP", comparison_basis: "visible buy volume", method: "relative change against previous complete snapshot" });
  }
  if (sellChange !== null && sellChange >= volumeThreshold) {
    results.push({ ...base, kind: "SELL_LIQUIDITY_INCREASE", comparison_basis: "visible sell volume", method: "relative change against previous complete snapshot" });
  }
  if (buyChange !== null && buyChange >= volumeThreshold) {
    results.push({ ...base, kind: "BUY_LIQUIDITY_INCREASE", comparison_basis: "visible buy volume", method: "relative change against previous complete snapshot" });
  }
  if (sellPriceChange !== null && Math.abs(sellPriceChange) >= priceThreshold) {
    results.push({ ...base, kind: "PRICE_GAP", comparison_basis: "best sell price", method: "relative price change against previous complete snapshot" });
  } else if (buyPriceChange !== null && Math.abs(buyPriceChange) >= priceThreshold) {
    results.push({ ...base, kind: "PRICE_GAP", comparison_basis: "best buy price", method: "relative price change against previous complete snapshot" });
  }
  return results;
}


import type { CapitalVelocity } from "@eve-trade/contracts";

export function deriveCapitalVelocity(
  capitalCommitted: number | null,
  observedTurnover: number | null,
  observedResult: number | null,
  durationSeconds: number | null,
): CapitalVelocity {
  if (
    capitalCommitted === null ||
    observedTurnover === null ||
    observedResult === null ||
    durationSeconds === null
  ) {
    return {
      capital_committed: capitalCommitted,
      observed_turnover: observedTurnover,
      observed_result: observedResult,
      duration_seconds: durationSeconds,
      turnover_per_day: null,
      return_per_day: null,
      status: "UNKNOWN",
    };
  }
  if (
    !Number.isFinite(capitalCommitted) ||
    capitalCommitted <= 0 ||
    !Number.isFinite(observedTurnover) ||
    observedTurnover < 0 ||
    !Number.isFinite(observedResult) ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return {
      capital_committed: capitalCommitted,
      observed_turnover: observedTurnover,
      observed_result: observedResult,
      duration_seconds: durationSeconds,
      turnover_per_day: null,
      return_per_day: null,
      status: "ERROR",
    };
  }
  const days = durationSeconds / 86_400;
  return {
    capital_committed: capitalCommitted,
    observed_turnover: observedTurnover,
    observed_result: observedResult,
    duration_seconds: durationSeconds,
    turnover_per_day: observedTurnover / days,
    return_per_day: observedResult / capitalCommitted / days,
    status: "COMPLETE",
  };
}
