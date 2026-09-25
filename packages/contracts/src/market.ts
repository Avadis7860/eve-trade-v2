export type AvailabilityStatus = "COMPLETE" | "PARTIAL" | "ERROR" | "UNKNOWN";

export type PrincipalScope = "PUBLIC" | "CHARACTER" | "CORPORATION";

export type MarketOrderRange =
  | "station"
  | "solarsystem"
  | "region"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "10"
  | "20"
  | "30"
  | "40";

export interface SourceProvenance {
  source_kind: "ESI";
  source_id: string;
  endpoint: string;
  principal_scope: PrincipalScope;
  principal_id?: number | null;
}

export interface CharacterSourceProvenance extends SourceProvenance {
  principal_scope: "CHARACTER";
  principal_id: number;
}

export interface EsiMarketOrder {
  duration: number;
  escrow: number;
  is_buy_order: boolean;
  issued: string;
  location_id: number;
  min_volume: number;
  order_id: number;
  price: number;
  range: MarketOrderRange;
  system_id: number;
  type_id: number;
  volume_remain: number;
  volume_total: number;
}

export interface MarketPageObservation {
  observation_id: string;
  collection_id: string;
  region_id: number;
  page: number;
  total_pages: number;
  observed_at: string;
  status: AvailabilityStatus;
  provenance: SourceProvenance;
  http_status: number | null;
  retry_count: number;
  records: EsiMarketOrder[];
  raw_payload: unknown;
  headers: {
    x_pages: string | null;
    last_modified: string | null;
    etag: string | null;
    expires: string | null;
    ratelimit_group: string | null;
    ratelimit_limit: string | null;
    ratelimit_remaining: string | null;
    ratelimit_used: string | null;
    retry_after: string | null;
    error_limit_remain: string | null;
    error_limit_reset: string | null;
    compatibility_date: string | null;
  };
  error: {
    code: string;
    message: string;
    retryable: boolean;
  } | null;
}

export interface MarketCollection {
  collection_id: string;
  region_id: number;
  observed_at: string;
  expected_pages: number | null;
  completed_pages: number[];
  status: AvailabilityStatus;
  provenance: SourceProvenance;
  cache_last_modified: string | null;
  cache_consistency: "CONSISTENT" | "UNVERIFIED" | "INCONSISTENT";
  error: {
    code: string;
    message: string;
  } | null;
}

export interface CanonicalMarketState {
  collection_id: string;
  region_id: number;
  observed_at: string;
  status: "COMPLETE" | "PARTIAL" | "ERROR";
  provenance: SourceProvenance;
  orders: EsiMarketOrder[];
  source_pages: number;
  duplicate_order_count: number;
  cache_last_modified: string | null;
  cache_consistency: "CONSISTENT" | "UNVERIFIED" | "INCONSISTENT";
}

export type MarketHistorySourceConsistency = "CONSISTENT" | "UNVERIFIED" | "INCONSISTENT";
export type MarketHistoryObservationKind = "INITIAL" | "REPEAT" | "NEW_STATE" | "NOT_COMPARABLE";
export type MarketOrderChangeKind = "APPEARED" | "UNCHANGED" | "MODIFIED" | "DISAPPEARED";
export type MarketOrderComparableField = Exclude<keyof EsiMarketOrder, "order_id">;

export interface MarketHistorySnapshot {
  snapshot_id: string;
  collection_id: string;
  region_id: number;
  observed_at: string;
  status: AvailabilityStatus;
  comparison_eligible: boolean;
  state_fingerprint: string | null;
  source_last_modified: string | null;
  source_compatibility_date: string | null;
  source_consistency: MarketHistorySourceConsistency;
  observation_kind: MarketHistoryObservationKind;
  previous_snapshot_id: string | null;
  source_pages: number | null;
}

export interface MarketSnapshotTypeMetrics {
  snapshot_id: string;
  type_id: number;
  best_buy_price: number | null;
  best_buy_volume: number | null;
  best_sell_price: number | null;
  best_sell_volume: number | null;
  spread_absolute: number | null;
  spread_relative: number | null;
  buy_visible_volume: number;
  sell_visible_volume: number;
}

export interface MarketDepthLevel {
  snapshot_id: string;
  type_id: number;
  is_buy_order: boolean;
  price: number;
  volume_remain: number;
  order_count: number;
}

export interface MarketOrderEvolution {
  previous_snapshot_id: string;
  snapshot_id: string;
  order_id: number;
  kind: MarketOrderChangeKind;
  changed_fields: MarketOrderComparableField[];
  previous_order: EsiMarketOrder | null;
  current_order: EsiMarketOrder | null;
}

export interface MarketHistoryBuildResult {
  snapshots: MarketHistorySnapshot[];
  metrics: MarketSnapshotTypeMetrics[];
  depth_levels: MarketDepthLevel[];
  order_evolution: MarketOrderEvolution[];
}
