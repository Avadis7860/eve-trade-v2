import type {
  CanonicalMarketState,
  CanonicalPlayerState,
  EsiAsset,
  EsiMarketOrder,
  MarketHistorySnapshot,
  MarketOrderRange,
  SourceProvenance,
} from "./index.js";

export const TRADE_ANALYSIS_CONTRACT_VERSION = "phase-04.2";

export type TradeExecutionMode =
  | "TAKER_AGAINST_SELL"
  | "TAKER_AGAINST_BUY"
  | "MAKER_BUY"
  | "MAKER_SELL";

export type TradeAnalysisStatus =
  | "EXECUTABLE"
  | "PROJECTED"
  | "NOT_EXECUTABLE"
  | "STALE"
  | "PARTIAL"
  | "DATA_UNAVAILABLE";

export type TradeAnalysisReasonCode =
  | "MARKET_UNAVAILABLE"
  | "MARKET_NOT_COMPARABLE"
  | "MARKET_SCOPE_INVALID"
  | "DEPTH_EXHAUSTED"
  | "RANGE_UNKNOWN"
  | "RANGE_INCOMPATIBLE"
  | "QUANTITY_INVALID"
  | "PRICE_INVALID"
  | "MAKER_MODE_UNSUPPORTED"
  | "SCENARIO_INVALID"
  | "CONSTRAINT_VIOLATION"
  | "CAPITAL_UNAVAILABLE"
  | "CAPITAL_INSUFFICIENT"
  | "WALLET_UNAVAILABLE"
  | "INVENTORY_UNAVAILABLE"
  | "INVENTORY_INSUFFICIENT"
  | "INVENTORY_COST_BASIS_UNKNOWN"
  | "FEE_RATE_UNKNOWN"
  | "LOGISTICS_INCOMPLETE"
  | "FRESHNESS_EXCEEDED"
  | "FRESHNESS_METADATA_MISSING"
  | "FUTURE_DATA"
  | "ECONOMIC_RESULT_UNAVAILABLE";

export interface TradeAnalysisReason {
  code: TradeAnalysisReasonCode;
  message: string;
  blocking: boolean;
}

export interface MarketLocation {
  region_id: number;
  system_id: number;
  location_id: number;
}

export interface MarketLegScenario {
  execution_mode: TradeExecutionMode;
  execution_location: MarketLocation;
  quantity: number;
  limit_price: number;
  order_range: MarketOrderRange;
}

export interface ExistingInventoryScenario {
  source: "EXISTING_INVENTORY";
  type_id: number;
  quantity: number;
  asset_ids?: number[];
  /**
   * Total historical acquisition cost basis for this scenario quantity.
   * Null/absent means the historical basis is unknown.
   */
  cost_basis?: number | null;
}

export type AcquisitionScenario =
  | {
      source: "MARKET";
      market: MarketLegScenario;
      inventory?: never;
    }
  | {
      source: "EXISTING_INVENTORY";
      inventory: ExistingInventoryScenario;
      market?: never;
    };

export interface DispositionScenario {
  source: "MARKET";
  market: MarketLegScenario;
}

export interface TradeScenario {
  type_id: number;
  requested_quantity: number;
  acquisition: AcquisitionScenario;
  disposition: DispositionScenario;
  origin: MarketLocation;
  destination: MarketLocation;
}

export interface AnalysisFreshnessPolicy {
  max_market_age_seconds: number | null;
  max_player_age_seconds: number | null;
}

export interface AnalysisContext {
  as_of: string;
  freshness_policy: AnalysisFreshnessPolicy;
}

export interface MarketAnalysisSnapshot {
  snapshot: MarketHistorySnapshot;
  market: CanonicalMarketState;
}

export interface PlayerAnalysisContext {
  state: CanonicalPlayerState;
}

export interface CapitalPolicy {
  source: "EXPLICIT_DEPLOYABLE" | "WALLET_BALANCE";
  deployable_capital: number | null;
  escrow: number | null;
  escrow_is_separate: true;
}

export interface FeeContext {
  broker_fee_rate: number | null;
  sales_tax_rate: number | null;
  source: "EXPLICIT" | "UNKNOWN";
}

export interface LogisticsContext {
  status: "COMPLETE" | "PARTIAL" | "ERROR" | "UNKNOWN";
  cost: number | null;
  jump_count: number | null;
  travel_time_seconds: number | null;
  provenance: SourceProvenance | null;
}

export interface TradeAnalysisConstraints {
  max_quantity: number | null;
  max_capital: number | null;
  min_quantity: number | null;
  execution_modes: TradeExecutionMode[];
}

export interface TradeAnalysisRequest {
  scenario: TradeScenario;
  analysis_context: AnalysisContext;
  acquisition_market: MarketAnalysisSnapshot | null;
  disposition_market: MarketAnalysisSnapshot | null;
  player_context: PlayerAnalysisContext | null;
  capital_policy: CapitalPolicy;
  fee_context: FeeContext;
  logistics_context: LogisticsContext;
  constraints: TradeAnalysisConstraints;
}

export interface SimulatedFill {
  snapshot_id: string;
  order_id: number;
  price: number;
  quantity: number;
  book_price: number;
  settlement_price: number;
}

export interface TradeLegResult {
  execution_mode: TradeExecutionMode | null;
  requested_quantity: number;
  filled_quantity: number;
  remaining_quantity: number;
  simulated_fills: SimulatedFill[];
  status: TradeAnalysisStatus;
  reasons: TradeAnalysisReason[];
}

export interface MarketEvidence {
  acquisition_snapshot_id: string | null;
  disposition_snapshot_id: string | null;
  acquisition_order_ids: number[];
  disposition_order_ids: number[];
  acquisition_provenance: SourceProvenance | null;
  disposition_provenance: SourceProvenance | null;
}

export interface CapitalContext {
  wallet_cash: number | null;
  committed_escrow: number | null;
  inventory: EsiAsset[] | null;
  deployable_capital: number | null;
  source: CapitalPolicy["source"];
}

export interface EconomicResult {
  acquisition_cash_outflow: number | null;
  disposition_proceeds: number | null;
  gross_result: number | null;
  fees_total: number | null;
  logistics_cost: number | null;
  simulated_net_result: number | null;
  capital_required: number | null;
  simulated_return: number | null;
  projected_disposition_proceeds?: number | null;
  projected_fees_total?: number | null;
  projected_logistics_cost?: number | null;
  projected_net_result?: number | null;
  projected_return?: number | null;
}

export interface TradeAnalysisResult {
  contract_version: typeof TRADE_ANALYSIS_CONTRACT_VERSION;
  status: TradeAnalysisStatus;
  status_reasons: TradeAnalysisReason[];
  scenario_fingerprint: string;
  acquisition_leg: TradeLegResult;
  logistics_leg: LogisticsContext;
  disposition_leg: TradeLegResult;
  capital_context: CapitalContext;
  fee_context: FeeContext;
  market_evidence: MarketEvidence;
  market_intelligence?: {
    acquisition: import("./market-intelligence.js").MarketLiquiditySnapshot | null;
    disposition: import("./market-intelligence.js").MarketLiquiditySnapshot | null;
  };
  economic_result: EconomicResult;
}
