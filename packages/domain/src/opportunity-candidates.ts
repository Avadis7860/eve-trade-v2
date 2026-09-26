import type {
  CanonicalMarketState,
  EsiMarketOrder,
  MarketOrderRange,
  TradeScenario,
} from "@eve-trade/contracts";

export type OpportunityCandidateStrategy =
  | "MARKET_TO_MARKET"
  | "BUY_AND_RELIST";

export interface OpportunityCandidatePolicy {
  execution_order_range: MarketOrderRange;
  max_depth_levels?: number;
  maker_sell_buffer_levels?: number;
  max_candidate_quantity?: number | null;
  strategy?: OpportunityCandidateStrategy;
}

export const DEFAULT_MAX_DEPTH_LEVELS = 5;

export const DEFAULT_OPPORTUNITY_CANDIDATE_POLICY: OpportunityCandidatePolicy = {
  execution_order_range: "region",
  max_depth_levels: DEFAULT_MAX_DEPTH_LEVELS,
  maker_sell_buffer_levels: 1,
  max_candidate_quantity: null,
  strategy: "MARKET_TO_MARKET",
};

function depthQuantity(
  orders: EsiMarketOrder[],
  isBuy: boolean,
  maxLevels: number,
): { quantity: number; limitPrice: number; first: EsiMarketOrder } | null {
  const sorted = orders
    .filter((order) => order.is_buy_order === isBuy && order.volume_remain > 0)
    .sort((a, b) =>
      isBuy
        ? b.price - a.price || a.order_id - b.order_id
        : a.price - b.price || a.order_id - b.order_id,
    )
    .slice(0, maxLevels);
  if (sorted.length === 0) return null;
  const quantity = sorted.reduce((sum, order) => sum + order.volume_remain, 0);
  return {
    quantity,
    limitPrice: sorted[sorted.length - 1]!.price,
    first: sorted[0]!,
  };
}

export function generateMarketTradeCandidates(
  market: CanonicalMarketState,
  policy: OpportunityCandidatePolicy = DEFAULT_OPPORTUNITY_CANDIDATE_POLICY,
): TradeScenario[] {
  if (
    market.status !== "COMPLETE" ||
    market.provenance.principal_scope !== "PUBLIC"
  ) {
    return [];
  }

  const requestedDepth = policy.max_depth_levels ?? DEFAULT_MAX_DEPTH_LEVELS;
  const maxDepth = Number.isSafeInteger(requestedDepth)
    ? Math.max(1, requestedDepth)
    : DEFAULT_MAX_DEPTH_LEVELS;
  const quantityCap =
    policy.max_candidate_quantity === undefined || policy.max_candidate_quantity === null
      ? Number.MAX_SAFE_INTEGER
      : Math.max(1, Math.floor(policy.max_candidate_quantity));
  const bufferLevels = policy.maker_sell_buffer_levels === undefined
    ? 1
    : Math.max(1, Math.floor(policy.maker_sell_buffer_levels));
  const strategy = policy.strategy ?? "MARKET_TO_MARKET";

  const byType = new Map<number, EsiMarketOrder[]>();
  for (const order of market.orders) {
    if (order.volume_remain <= 0) continue;
    const current = byType.get(order.type_id);
    if (current) current.push(order);
    else byType.set(order.type_id, [order]);
  }

  const scenarios: TradeScenario[] = [];
  for (const typeId of [...byType.keys()].sort((a, b) => a - b)) {
    const orders = byType.get(typeId)!;

    if (strategy === "BUY_AND_RELIST") {
      const sellOrders = orders.filter(
        (order) => !order.is_buy_order && order.volume_remain > 0,
      );
      const stationKeys = [
        ...new Set(
          sellOrders.map((order) => `${order.system_id}:${order.location_id}`),
        ),
      ].sort();

      const stationCandidates = stationKeys.flatMap((key) => {
        const [systemText, locationText] = key.split(":");
        const systemId = Number(systemText);
        const locationId = Number(locationText);
        const localOrders = sellOrders.filter(
          (order) =>
            order.system_id === systemId &&
            order.location_id === locationId,
        );
        const acquisitionDepth = depthQuantity(localOrders, false, maxDepth);
        const targetDepth = depthQuantity(
          localOrders,
          false,
          maxDepth + bufferLevels,
        );
        if (
          acquisitionDepth === null ||
          targetDepth === null ||
          targetDepth.limitPrice <= acquisitionDepth.limitPrice
        ) {
          return [];
        }

        const localBestBuy = depthQuantity(
          orders.filter(
            (order) =>
              order.is_buy_order &&
              order.volume_remain > 0 &&
              order.system_id === systemId &&
              order.location_id === locationId,
          ),
          true,
          1,
        );
        if (
          localBestBuy !== null &&
          localBestBuy.first.price >= targetDepth.limitPrice
        ) {
          return [];
        }

        const quantity = Math.min(acquisitionDepth.quantity, quantityCap);
        if (!Number.isSafeInteger(quantity) || quantity <= 0) return [];

        return [{
          acquisitionDepth,
          targetDepth,
          quantity,
          origin: {
            region_id: market.region_id,
            system_id: systemId,
            location_id: locationId,
          },
        }];
      });

      const chosen = stationCandidates.sort(
        (a, b) =>
          a.acquisitionDepth.limitPrice - b.acquisitionDepth.limitPrice ||
          a.targetDepth.limitPrice - b.targetDepth.limitPrice ||
          a.origin.system_id - b.origin.system_id ||
          a.origin.location_id - b.origin.location_id,
      )[0];

      if (!chosen) continue;

      scenarios.push({
        type_id: typeId,
        requested_quantity: chosen.quantity,
        acquisition: {
          source: "MARKET",
          market: {
            execution_mode: "TAKER_AGAINST_SELL",
            execution_location: chosen.origin,
            quantity: chosen.quantity,
            limit_price: chosen.acquisitionDepth.limitPrice,
            order_range: policy.execution_order_range,
          },
        },
        disposition: {
          source: "MARKET",
          market: {
            execution_mode: "MAKER_SELL",
            execution_location: chosen.origin,
            quantity: chosen.quantity,
            limit_price: chosen.targetDepth.limitPrice,
            order_range: "station",
          },
        },
        origin: chosen.origin,
        destination: chosen.origin,
      });
      continue;
    }

    const sell = depthQuantity(orders, false, maxDepth);
    const buy = depthQuantity(orders, true, maxDepth);
    if (sell === null || buy === null) continue;
    if (buy.first.price <= sell.first.price) continue;

    const quantity = Math.min(sell.quantity, buy.quantity, quantityCap);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) continue;

    const origin = {
      region_id: market.region_id,
      system_id: sell.first.system_id,
      location_id: sell.first.location_id,
    };
    const destination = {
      region_id: market.region_id,
      system_id: buy.first.system_id,
      location_id: buy.first.location_id,
    };

    scenarios.push({
      type_id: typeId,
      requested_quantity: quantity,
      acquisition: {
        source: "MARKET",
        market: {
          execution_mode: "TAKER_AGAINST_SELL",
          execution_location: origin,
          quantity,
          limit_price: sell.limitPrice,
          order_range: policy.execution_order_range,
        },
      },
      disposition: {
        source: "MARKET",
        market: {
          execution_mode: "TAKER_AGAINST_BUY",
          execution_location: destination,
          quantity,
          limit_price: buy.limitPrice,
          order_range: policy.execution_order_range,
        },
      },
      origin,
      destination,
    });
  }

  return scenarios;
}
