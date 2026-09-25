import type { AvailabilityStatus, SourceProvenance } from "./market.js";

export type PlayerDataKind =
  | "IDENTITY"
  | "WALLET_BALANCE"
  | "WALLET_JOURNAL"
  | "WALLET_TRANSACTION"
  | "ASSET"
  | "ACTIVE_ORDER";

export type PlayerCoverage = "COMPLETE" | "PARTIAL" | "UNAVAILABLE" | "UNKNOWN";
export type PlayerHealth = "HEALTHY" | "DEGRADED" | "FAILED" | "UNKNOWN";

export interface CharacterPrincipal {
  character_id: number;
  name: string | null;
  corporation_id: number | null;
  identity_observation_id: string | null;
  observed_at: string | null;
  provenance: SourceProvenance | null;
}

export interface EsiResponseMetadata {
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
}

export interface PlayerObservationError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface PlayerObservation {
  observation_id: string;
  collection_id: string;
  character_id: number;
  data_kind: PlayerDataKind;
  page_identity: string;
  observed_at: string;
  status: AvailabilityStatus;
  provenance: SourceProvenance;
  http_status: number | null;
  retry_count: number;
  records: unknown[];
  raw_payload: unknown;
  headers: EsiResponseMetadata;
  error: PlayerObservationError | null;
}

export interface PlayerDataQuality {
  availability: AvailabilityStatus;
  coverage: PlayerCoverage;
  health: PlayerHealth;
  observed_at: string | null;
  fresh_until: string | null;
  observation_ids: string[];
  error: PlayerObservationError | null;
}

export interface PlayerComponent<T> {
  quality: PlayerDataQuality;
  records: T[] | null;
}

export interface EsiCharacterPublicInfo {
  name: string;
  corporation_id: number;
  alliance_id?: number;
  faction_id?: number;
  description?: string;
  security_status?: number;
}

export interface EsiWalletJournalEntry {
  id: number;
  date: string;
  amount: number;
  balance: number;
  description: string;
  first_party_id: number;
  ref_type: string;
  second_party_id: number;
  context_id?: number;
  context_id_type?: string;
  reason?: string;
  tax?: number;
  tax_receiver_id?: number;
}

export interface EsiWalletTransaction {
  client_id: number;
  date: string;
  is_buy: boolean;
  is_personal: boolean;
  journal_ref_id: number;
  location_id: number;
  quantity: number;
  transaction_id: number;
  type_id: number;
  unit_price: number;
}

export interface EsiAsset {
  item_id: number;
  location_flag: string;
  location_id: number;
  location_type: string;
  quantity: number;
  is_singleton: boolean;
  type_id: number;
}

export interface EsiCharacterOrder {
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

export interface CanonicalPlayerState {
  character_id: number;
  principal: CharacterPrincipal | null;
  identity: PlayerComponent<EsiCharacterPublicInfo> | null;
  wallet: PlayerComponent<number>;
  journal: PlayerComponent<EsiWalletJournalEntry>;
  transactions: PlayerComponent<EsiWalletTransaction>;
  assets: PlayerComponent<EsiAsset>;
  active_orders: PlayerComponent<EsiCharacterOrder>;
}

export interface PlayerSync {
  collection_id: string;
  character_id: number;
  observed_at: string;
  status: AvailabilityStatus;
  observations: PlayerObservation[];
  state: CanonicalPlayerState;
}
