CREATE TABLE IF NOT EXISTS market_history_snapshots (
  snapshot_id UUID PRIMARY KEY REFERENCES market_collections(collection_id) ON DELETE CASCADE,
  collection_id UUID NOT NULL UNIQUE REFERENCES market_collections(collection_id) ON DELETE CASCADE,
  region_id BIGINT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('COMPLETE','PARTIAL','ERROR','UNKNOWN')),
  comparison_eligible BOOLEAN NOT NULL,
  state_fingerprint TEXT,
  source_last_modified TEXT,
  source_compatibility_date TEXT,
  source_consistency TEXT NOT NULL CHECK (source_consistency IN ('CONSISTENT','UNVERIFIED','INCONSISTENT')),
  observation_kind TEXT NOT NULL CHECK (observation_kind IN ('INITIAL','REPEAT','NEW_STATE','NOT_COMPARABLE')),
  previous_snapshot_id UUID REFERENCES market_history_snapshots(snapshot_id),
  source_pages INTEGER,
  history_contract_version INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_history_region_observed
  ON market_history_snapshots(region_id, observed_at);

CREATE INDEX IF NOT EXISTS idx_market_history_region_fingerprint
  ON market_history_snapshots(region_id, state_fingerprint);

CREATE TABLE IF NOT EXISTS market_snapshot_type_metrics (
  snapshot_id UUID NOT NULL REFERENCES market_history_snapshots(snapshot_id) ON DELETE CASCADE,
  type_id BIGINT NOT NULL,
  best_buy_price DOUBLE PRECISION,
  best_buy_volume BIGINT,
  best_sell_price DOUBLE PRECISION,
  best_sell_volume BIGINT,
  spread_absolute DOUBLE PRECISION,
  spread_relative DOUBLE PRECISION,
  buy_visible_volume BIGINT NOT NULL,
  sell_visible_volume BIGINT NOT NULL,
  PRIMARY KEY (snapshot_id, type_id)
);

CREATE TABLE IF NOT EXISTS market_snapshot_depth_levels (
  snapshot_id UUID NOT NULL REFERENCES market_history_snapshots(snapshot_id) ON DELETE CASCADE,
  type_id BIGINT NOT NULL,
  is_buy_order BOOLEAN NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  volume_remain BIGINT NOT NULL,
  order_count INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, type_id, is_buy_order, price)
);

CREATE INDEX IF NOT EXISTS idx_market_depth_snapshot_type
  ON market_snapshot_depth_levels(snapshot_id, type_id, is_buy_order, price);
