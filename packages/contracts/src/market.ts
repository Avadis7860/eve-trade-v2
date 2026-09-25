export type AvailabilityStatus = "COMPLETE" | "PARTIAL" | "ERROR" | "UNKNOWN";

export interface SourceProvenance {
  source_kind: "ESI";
  source_id: string;
  endpoint: string;
  principal_scope: "PUBLIC";
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
  range: string;
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
