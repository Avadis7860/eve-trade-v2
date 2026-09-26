import type {
  AvailabilityStatus,
  MarketSnapshotTypeMetrics,
  SourceProvenance,
  EsiMarketOrder,
} from "./market.js";

export const MARKET_INTELLIGENCE_CONTRACT_VERSION = "phase-08.3";

export interface MarketLiquiditySnapshot {
  contract_version: typeof MARKET_INTELLIGENCE_CONTRACT_VERSION;
  snapshot_id: string;
  type_id: number;
  visible_supply: number | null;
  visible_demand: number | null;
  best_sell_depth: number | null;
  best_buy_depth: number | null;
  requested_quantity: number | null;
  quantity_coverage: number | null;
  depth_levels_considered: number;
  status: AvailabilityStatus;
  provenance: SourceProvenance | null;
}

export interface TradeDayCoverage {
  visible_quantity: number | null;
  reference_daily_quantity: number | null;
  trade_days: number | null;
  status: "COMPLETE" | "PARTIAL" | "ERROR" | "UNKNOWN" | "ABSENT";
  method: "VISIBLE_QUANTITY_OVER_REFERENCE_DAILY_QUANTITY";
  provenance: SourceProvenance | null;
}

export type HistoricalPriceRegime =
  | "LOW_RANGE"
  | "NORMAL_RANGE"
  | "HIGH_RANGE"
  | "BREAKOUT"
  | "UNKNOWN";

export interface HistoricalPricePosition {
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
}

export type MarketBookAnomalyKind =
  | "LIQUIDITY_DRAIN"
  | "LARGE_BUY_SWEEP"
  | "LARGE_SELL_WALL"
  | "RAPID_RELIST"
  | "PRICE_GAP"
  | "SUPPLY_COLLAPSE"
  | "DEMAND_SURGE";

export interface MarketBookAnomaly {
  kind: MarketBookAnomalyKind;
  type_id: number;
  detected_at: string;
  baseline_snapshot_id: string;
  comparison_snapshot_id: string;
  comparison_basis: string;
  method: string;
  confidence: "NOT_ASSESSED";
  provenance: SourceProvenance[];
}

export interface CapitalVelocity {
  capital_committed: number | null;
  observed_turnover: number | null;
  observed_result: number | null;
  duration_seconds: number | null;
  turnover_per_day: number | null;
  return_per_day: number | null;
  status: "COMPLETE" | "PARTIAL" | "UNKNOWN" | "ERROR";
}

export interface MarketIntelligenceInput {
  metrics: MarketSnapshotTypeMetrics[];
  orders?: EsiMarketOrder[];
}
