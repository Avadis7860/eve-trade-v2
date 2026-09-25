import { createHash } from "node:crypto";
import type {
  EsiMarketOrder,
  MarketAnalysisSnapshot,
  MarketLocation,
  MarketOrderRange,
  SimulatedFill,
  TradeAnalysisReason,
  TradeAnalysisStatus,
  TradeExecutionMode,
} from "@eve-trade/contracts";
import { TRADE_ANALYSIS_CONTRACT_VERSION } from "@eve-trade/contracts";

export type RangeEvaluationStatus = "COMPATIBLE" | "INCOMPATIBLE" | "UNKNOWN";

export interface RangeEvaluation {
  status: RangeEvaluationStatus;
  reason: string | null;
}

export interface TakerSimulationInput {
  snapshot: MarketAnalysisSnapshot;
  type_id: number;
  execution_location: MarketLocation;
  quantity: number;
  limit_price: number;
  order_range: MarketOrderRange;
  orders?: EsiMarketOrder[];
  jump_count_by_order_id?: Record<string, number>;
}

export interface TakerSimulationResult {
  execution_mode: TradeExecutionMode;
  status: TradeAnalysisStatus;
  reasons: TradeAnalysisReason[];
  requested_quantity: number;
  filled_quantity: number;
  remaining_quantity: number;
  simulated_fills: SimulatedFill[];
  book_value: number | null;
  settlement_value: number | null;
}

function reason(code: TradeAnalysisReason["code"], message: string, blocking: boolean): TradeAnalysisReason {
  return { code, message, blocking };
}

function invalidQuantity(quantity: number): boolean {
  return !Number.isInteger(quantity) || quantity <= 0;
}

function invalidPrice(price: number): boolean {
  return !Number.isFinite(price) || price <= 0;
}

function snapshotUsable(snapshot: MarketAnalysisSnapshot): boolean {
  return (
    snapshot.snapshot.status === "COMPLETE" &&
    snapshot.snapshot.comparison_eligible &&
    snapshot.market.status === "COMPLETE" &&
    snapshot.market.collection_id === snapshot.snapshot.collection_id &&
    snapshot.market.region_id === snapshot.snapshot.region_id
  );
}

export function evaluateRange(
  orderRange: MarketOrderRange,
  orderLocation: MarketLocation,
  targetLocation: MarketLocation,
  targetRegionId: number,
  jumpCount?: number,
): RangeEvaluation {
  if (orderRange === "station") {
    return orderLocation.location_id === targetLocation.location_id
      ? { status: "COMPATIBLE", reason: null }
      : { status: "INCOMPATIBLE", reason: "station mismatch" };
  }

  if (orderRange === "solarsystem") {
    return orderLocation.system_id === targetLocation.system_id
      ? { status: "COMPATIBLE", reason: null }
      : { status: "INCOMPATIBLE", reason: "solar-system mismatch" };
  }

  if (orderRange === "region") {
    return orderLocation.region_id === targetRegionId
      ? { status: "COMPATIBLE", reason: null }
      : { status: "INCOMPATIBLE", reason: "region mismatch" };
  }

  if (orderLocation.location_id === targetLocation.location_id || orderLocation.system_id === targetLocation.system_id) {
    return { status: "COMPATIBLE", reason: null };
  }

  if (orderLocation.region_id !== targetRegionId) {
    return { status: "INCOMPATIBLE", reason: "region mismatch" };
  }

  if (jumpCount === undefined) {
    return { status: "UNKNOWN", reason: "jump count is required for numeric order range" };
  }

  const allowedJumps = Number(orderRange);
  return jumpCount <= allowedJumps
    ? { status: "COMPATIBLE", reason: null }
    : { status: "INCOMPATIBLE", reason: "jump range exceeded" };
}

function sortSellOrders(
  orders: EsiMarketOrder[],
  input: TakerSimulationInput,
): { compatible: EsiMarketOrder[]; unknownRangeCount: number } {
  const compatible: EsiMarketOrder[] = [];
  let unknownRangeCount = 0;

  for (const order of orders) {
    if (order.type_id !== input.type_id || order.is_buy_order || order.volume_remain <= 0 || order.price > input.limit_price) continue;

    const range = evaluateRange(
      input.order_range,
      {
        region_id: input.snapshot.market.region_id,
        system_id: order.system_id,
        location_id: order.location_id,
      },
      input.execution_location,
      input.snapshot.market.region_id,
      input.jump_count_by_order_id?.[String(order.order_id)],
    );

    if (range.status === "UNKNOWN") {
      unknownRangeCount += 1;
      continue;
    }
    if (range.status === "COMPATIBLE") compatible.push(order);
  }

  compatible.sort((a, b) => (a.price !== b.price ? a.price - b.price : a.order_id - b.order_id));
  return { compatible, unknownRangeCount };
}

function sortBuyOrders(
  orders: EsiMarketOrder[],
  input: TakerSimulationInput,
): { compatible: EsiMarketOrder[]; unknownRangeCount: number } {
  const compatible: EsiMarketOrder[] = [];
  let unknownRangeCount = 0;

  for (const order of orders) {
    if (order.type_id !== input.type_id || !order.is_buy_order || order.volume_remain <= 0 || order.price < input.limit_price) continue;

    const range = evaluateRange(
      order.range,
      {
        region_id: input.snapshot.market.region_id,
        system_id: order.system_id,
        location_id: order.location_id,
      },
      input.execution_location,
      input.snapshot.market.region_id,
      input.jump_count_by_order_id?.[String(order.order_id)],
    );

    if (range.status === "UNKNOWN") {
      unknownRangeCount += 1;
      continue;
    }
    if (range.status === "COMPATIBLE") compatible.push(order);
  }

  compatible.sort((a, b) => (a.price !== b.price ? b.price - a.price : a.order_id - b.order_id));
  return { compatible, unknownRangeCount };
}

function finalize(
  mode: TradeExecutionMode,
  input: TakerSimulationInput,
  candidates: EsiMarketOrder[],
  unknownRangeCount: number,
): TakerSimulationResult {
  let remaining = input.quantity;
  const fills: SimulatedFill[] = [];
  let bookValue = 0;

  for (const order of candidates) {
    if (remaining <= 0) break;
    const quantity = Math.min(remaining, order.volume_remain);
    if (quantity <= 0) continue;

    fills.push({
      snapshot_id: input.snapshot.snapshot_id,
      order_id: order.order_id,
      price: order.price,
      quantity,
      book_price: order.price,
      settlement_price: input.limit_price,
    });
    bookValue += quantity * order.price;
    remaining -= quantity;
  }

  const filled = input.quantity - remaining;
  const settlementValue = filled > 0 ? filled * input.limit_price : null;
  const reasons: TradeAnalysisReason[] = [];
  if (remaining > 0) reasons.push(reason("DEPTH_EXHAUSTED", "visible compatible liquidity cannot fully satisfy the requested quantity", true));
  if (unknownRangeCount > 0 && remaining > 0) {
    reasons.push(reason("RANGE_UNKNOWN", "some candidate orders cannot be classified without their jump distance", true));
  }

  let status: TradeAnalysisStatus;
  if (filled === 0 && unknownRangeCount > 0) status = "DATA_UNAVAILABLE";
  else if (remaining > 0) status = "PARTIAL";
  else status = "EXECUTABLE";

  return {
    execution_mode: mode,
    status,
    reasons,
    requested_quantity: input.quantity,
    filled_quantity: filled,
    remaining_quantity: remaining,
    simulated_fills: fills,
    book_value: filled > 0 ? bookValue : null,
    settlement_value: settlementValue,
  };
}

function invalidInputResult(
  mode: TradeExecutionMode,
  input: TakerSimulationInput,
  reasons: TradeAnalysisReason[],
): TakerSimulationResult {
  return {
    execution_mode: mode,
    status: "NOT_EXECUTABLE",
    reasons,
    requested_quantity: input.quantity,
    filled_quantity: 0,
    remaining_quantity: Math.max(0, input.quantity),
    simulated_fills: [],
    book_value: null,
    settlement_value: null,
  };
}

export function simulateTakerAgainstSell(input: TakerSimulationInput): TakerSimulationResult {
  const reasons: TradeAnalysisReason[] = [];
  if (invalidQuantity(input.quantity)) reasons.push(reason("QUANTITY_INVALID", "quantity must be a positive integer", true));
  if (invalidPrice(input.limit_price)) reasons.push(reason("PRICE_INVALID", "limit price must be a finite positive number", true));
  if (!snapshotUsable(input.snapshot)) reasons.push(reason("MARKET_NOT_COMPARABLE", "market snapshot is not a complete comparable canonical state", true));
  if (reasons.length > 0) return invalidInputResult("TAKER_AGAINST_SELL", input, reasons);

  const candidates = sortSellOrders(input.orders ?? input.snapshot.market.orders, input);
  return finalize("TAKER_AGAINST_SELL", input, candidates.compatible, candidates.unknownRangeCount);
}

export function simulateTakerAgainstBuy(input: TakerSimulationInput): TakerSimulationResult {
  const reasons: TradeAnalysisReason[] = [];
  if (invalidQuantity(input.quantity)) reasons.push(reason("QUANTITY_INVALID", "quantity must be a positive integer", true));
  if (invalidPrice(input.limit_price)) reasons.push(reason("PRICE_INVALID", "limit price must be a finite positive number", true));
  if (!snapshotUsable(input.snapshot)) reasons.push(reason("MARKET_NOT_COMPARABLE", "market snapshot is not a complete comparable canonical state", true));
  if (reasons.length > 0) return invalidInputResult("TAKER_AGAINST_BUY", input, reasons);

  const candidates = sortBuyOrders(input.orders ?? input.snapshot.market.orders, input);
  return finalize("TAKER_AGAINST_BUY", input, candidates.compatible, candidates.unknownRangeCount);
}

export interface TradeScenarioFingerprintInput {
  scenario: unknown;
  configuration: unknown;
  as_of: string;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export function fingerprintTradeScenario(input: TradeScenarioFingerprintInput): string {
  const payload = {
    contract_version: TRADE_ANALYSIS_CONTRACT_VERSION,
    scenario: stableValue(input.scenario),
    configuration: stableValue(input.configuration),
    as_of: input.as_of,
  };
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}
