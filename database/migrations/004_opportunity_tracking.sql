CREATE TABLE IF NOT EXISTS opportunities (
  opportunity_id TEXT PRIMARY KEY,
  identity_contract_version TEXT NOT NULL,
  identity_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS opportunity_observations (
  observation_sequence BIGINT GENERATED ALWAYS AS IDENTITY,
  observation_id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(opportunity_id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL,
  phase4_contract_version TEXT NOT NULL,
  phase4_scenario_fingerprint TEXT NOT NULL,
  presence TEXT NOT NULL CHECK (presence IN ('PRESENT','ABSENT','UNAVAILABLE')),
  freshness_state TEXT NOT NULL CHECK (freshness_state IN ('CURRENT','STALE','UNKNOWN')),
  type_id BIGINT NOT NULL,
  requested_quantity BIGINT NOT NULL,
  acquisition_source TEXT NOT NULL CHECK (acquisition_source IN ('MARKET','EXISTING_INVENTORY')),
  origin_region_id BIGINT NOT NULL,
  origin_system_id BIGINT NOT NULL,
  origin_location_id BIGINT NOT NULL,
  destination_region_id BIGINT NOT NULL,
  destination_system_id BIGINT NOT NULL,
  destination_location_id BIGINT NOT NULL,
  acquisition_snapshot_id TEXT,
  disposition_snapshot_id TEXT,
  acquisition_order_ids BIGINT[] NOT NULL DEFAULT '{}',
  disposition_order_ids BIGINT[] NOT NULL DEFAULT '{}',
  provenance JSONB NOT NULL,
  observer JSONB,
  scenario_snapshot JSONB NOT NULL,
  analysis_result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opportunity_observation_history
  ON opportunity_observations(opportunity_id, observed_at, observation_id);

CREATE INDEX IF NOT EXISTS idx_opportunity_observation_type
  ON opportunity_observations(type_id, observed_at);

CREATE TABLE IF NOT EXISTS opportunity_outcomes (
  outcome_id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(opportunity_id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'NOT_OBSERVED','NO_EVIDENCE','PARTIALLY_OBSERVED','COMPLETELY_OBSERVED','UNKNOWN'
  )),
  evidence_coverage TEXT NOT NULL CHECK (evidence_coverage IN ('NONE','PARTIAL','COMPLETE','UNKNOWN')),
  expected_quantity BIGINT,
  observed_quantity BIGINT,
  evidence JSONB NOT NULL,
  observed_subresult JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opportunity_outcome_history
  ON opportunity_outcomes(opportunity_id, observed_at, outcome_id);
