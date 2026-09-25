CREATE TABLE IF NOT EXISTS market_collections (
  collection_id UUID PRIMARY KEY,
  region_id BIGINT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  expected_pages INTEGER,
  status TEXT NOT NULL CHECK (status IN ('COMPLETE','PARTIAL','ERROR','UNKNOWN')),
  provenance JSONB NOT NULL,
  cache_last_modified TEXT,
  cache_consistency TEXT NOT NULL CHECK (cache_consistency IN ('CONSISTENT','UNVERIFIED','INCONSISTENT')),
  error JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS market_page_observations (
  observation_id UUID PRIMARY KEY,
  collection_id UUID NOT NULL REFERENCES market_collections(collection_id) ON DELETE CASCADE,
  region_id BIGINT NOT NULL,
  page INTEGER NOT NULL CHECK (page > 0),
  total_pages INTEGER NOT NULL CHECK (total_pages > 0),
  observed_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('COMPLETE','PARTIAL','ERROR','UNKNOWN')),
  provenance JSONB NOT NULL,
  http_status INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  records JSONB NOT NULL,
  raw_payload JSONB NOT NULL,
  headers JSONB NOT NULL,
  error JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_page_collection_page_created
  ON market_page_observations(collection_id, page, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_page_region_observed
  ON market_page_observations(region_id, observed_at);

CREATE TABLE IF NOT EXISTS canonical_market_states (
  collection_id UUID PRIMARY KEY REFERENCES market_collections(collection_id) ON DELETE CASCADE,
  region_id BIGINT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('COMPLETE','PARTIAL','ERROR')),
  provenance JSONB NOT NULL,
  source_pages INTEGER NOT NULL,
  duplicate_order_count INTEGER NOT NULL,
  cache_last_modified TEXT,
  cache_consistency TEXT NOT NULL CHECK (cache_consistency IN ('CONSISTENT','UNVERIFIED','INCONSISTENT'))
);

CREATE TABLE IF NOT EXISTS canonical_market_orders (
  collection_id UUID NOT NULL REFERENCES canonical_market_states(collection_id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL,
  region_id BIGINT NOT NULL,
  type_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  system_id BIGINT NOT NULL,
  is_buy_order BOOLEAN NOT NULL,
  price NUMERIC NOT NULL,
  volume_remain BIGINT NOT NULL,
  volume_total BIGINT NOT NULL,
  issued TIMESTAMPTZ NOT NULL,
  duration INTEGER NOT NULL,
  min_volume BIGINT NOT NULL,
  order_range TEXT NOT NULL,
  escrow NUMERIC NOT NULL,
  PRIMARY KEY (collection_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_market_region
  ON canonical_market_states(region_id, observed_at);
