import type {
  CanonicalMarketState,
  EsiMarketOrder,
  MarketOrderRange,
  TradeScenario,
} from "@eve-trade/contracts";

export interface OpportunityCandidatePolicy {
  execution_order_range: MarketOrderRange;
}

export const DEFAULT_OPPORTUNITY_CANDIDATE_POLICY: OpportunityCandidatePolicy = {
  execution_order_range: "region",
};

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
    const sellOrders = orders.filter((order) => !order.is_buy_order);
    const buyOrders = orders.filter((order) => order.is_buy_order);
    if (sellOrders.length === 0 || buyOrders.length === 0) continue;

    const bestSell = [...sellOrders].sort(
      (a, b) => a.price - b.price || a.order_id - b.order_id,
    )[0]!;
    const bestBuy = [...buyOrders].sort(
      (a, b) => b.price - a.price || a.order_id - b.order_id,
    )[0]!;

    if (bestBuy.price <= bestSell.price) continue;

    const quantity = Math.min(bestSell.volume_remain, bestBuy.volume_remain);
    if (!Number.isInteger(quantity) || quantity <= 0) continue;

    const origin = {
      region_id: market.region_id,
      system_id: bestSell.system_id,
      location_id: bestSell.location_id,
    };
    const destination = {
      region_id: market.region_id,
      system_id: bestBuy.system_id,
      location_id: bestBuy.location_id,
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
          limit_price: bestSell.price,
          order_range: policy.execution_order_range,
        },
      },
      disposition: {
        source: "MARKET",
        market: {
          execution_mode: "TAKER_AGAINST_BUY",
          execution_location: destination,
          quantity,
          limit_price: bestBuy.price,
          order_range: policy.execution_order_range,
        },
      },
      origin,
      destination,
    });
  }

  return scenarios;
}
