CREATE TABLE IF NOT EXISTS player_syncs (
  collection_id UUID PRIMARY KEY,
  character_id BIGINT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('COMPLETE','PARTIAL','ERROR','UNKNOWN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_sync_character_observed
  ON player_syncs(character_id, observed_at, collection_id);

CREATE TABLE IF NOT EXISTS player_observations (
  observation_sequence BIGINT GENERATED ALWAYS AS IDENTITY,
  observation_id UUID PRIMARY KEY,
  collection_id UUID NOT NULL REFERENCES player_syncs(collection_id) ON DELETE CASCADE,
  character_id BIGINT NOT NULL,
  data_kind TEXT NOT NULL CHECK (data_kind IN (
    'IDENTITY','WALLET_BALANCE','WALLET_JOURNAL','WALLET_TRANSACTION','ASSET','ACTIVE_ORDER'
  )),
  page_identity TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_player_observation_sync_kind
  ON player_observations(collection_id, data_kind, page_identity, observation_sequence);

CREATE INDEX IF NOT EXISTS idx_player_observation_character_observed
  ON player_observations(character_id, observed_at, data_kind);

CREATE TABLE IF NOT EXISTS player_principals (
  character_id BIGINT PRIMARY KEY,
  name TEXT,
  corporation_id BIGINT,
  identity_observation_id UUID REFERENCES player_observations(observation_id),
  observed_at TIMESTAMPTZ,
  provenance JSONB
);

CREATE TABLE IF NOT EXISTS player_component_states (
  character_id BIGINT NOT NULL,
  data_kind TEXT NOT NULL CHECK (data_kind IN (
    'WALLET_BALANCE','WALLET_JOURNAL','WALLET_TRANSACTION','ASSET','ACTIVE_ORDER'
  )),
  availability TEXT NOT NULL CHECK (availability IN ('COMPLETE','PARTIAL','ERROR','UNKNOWN')),
  coverage TEXT NOT NULL CHECK (coverage IN ('COMPLETE','PARTIAL','UNAVAILABLE','UNKNOWN')),
  health TEXT NOT NULL CHECK (health IN ('HEALTHY','DEGRADED','FAILED','UNKNOWN')),
  observed_at TIMESTAMPTZ,
  fresh_until TIMESTAMPTZ,
  observation_ids JSONB NOT NULL,
  error JSONB,
  PRIMARY KEY (character_id, data_kind)
);

CREATE TABLE IF NOT EXISTS player_wallet_current (
  character_id BIGINT PRIMARY KEY,
  observation_id UUID NOT NULL REFERENCES player_observations(observation_id),
  observed_at TIMESTAMPTZ NOT NULL,
  balance NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS player_wallet_journal_current (
  character_id BIGINT NOT NULL,
  entry_id BIGINT NOT NULL,
  observation_id UUID NOT NULL REFERENCES player_observations(observation_id),
  observed_at TIMESTAMPTZ NOT NULL,
  entry_date TIMESTAMPTZ NOT NULL,
  amount NUMERIC NOT NULL,
  balance NUMERIC NOT NULL,
  description TEXT NOT NULL,
  first_party_id BIGINT NOT NULL,
  ref_type TEXT NOT NULL,
  second_party_id BIGINT NOT NULL,
  context_id BIGINT,
  context_id_type TEXT,
  reason TEXT,
  tax NUMERIC,
  tax_receiver_id BIGINT,
  PRIMARY KEY (character_id, entry_id)
);

CREATE TABLE IF NOT EXISTS player_wallet_transactions_current (
  character_id BIGINT NOT NULL,
  transaction_id BIGINT NOT NULL,
  observation_id UUID NOT NULL REFERENCES player_observations(observation_id),
  observed_at TIMESTAMPTZ NOT NULL,
  transaction_date TIMESTAMPTZ NOT NULL,
  client_id BIGINT NOT NULL,
  is_buy BOOLEAN NOT NULL,
  is_personal BOOLEAN NOT NULL,
  journal_ref_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  quantity BIGINT NOT NULL,
  type_id BIGINT NOT NULL,
  unit_price NUMERIC NOT NULL,
  PRIMARY KEY (character_id, transaction_id)
);

CREATE TABLE IF NOT EXISTS player_assets_current (
  character_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  observation_id UUID NOT NULL REFERENCES player_observations(observation_id),
  observed_at TIMESTAMPTZ NOT NULL,
  location_flag TEXT NOT NULL,
  location_id BIGINT NOT NULL,
  location_type TEXT NOT NULL,
  quantity BIGINT NOT NULL,
  is_singleton BOOLEAN NOT NULL,
  type_id BIGINT NOT NULL,
  PRIMARY KEY (character_id, item_id)
);

CREATE TABLE IF NOT EXISTS player_active_orders_current (
  character_id BIGINT NOT NULL,
  order_id BIGINT NOT NULL,
  observation_id UUID NOT NULL REFERENCES player_observations(observation_id),
  observed_at TIMESTAMPTZ NOT NULL,
  duration INTEGER NOT NULL,
  escrow NUMERIC NOT NULL,
  is_buy_order BOOLEAN NOT NULL,
  issued TEXT NOT NULL,
  location_id BIGINT NOT NULL,
  min_volume BIGINT NOT NULL,
  price NUMERIC NOT NULL,
  order_range TEXT NOT NULL,
  system_id BIGINT NOT NULL,
  type_id BIGINT NOT NULL,
  volume_remain BIGINT NOT NULL,
  volume_total BIGINT NOT NULL,
  PRIMARY KEY (character_id, order_id)
);
