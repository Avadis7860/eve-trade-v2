CREATE TABLE IF NOT EXISTS economic_operations (
  operation_id TEXT PRIMARY KEY,
  opportunity_id TEXT,
  type_id BIGINT NOT NULL,
  initial_quantity BIGINT NOT NULL,
  acquisition_mode TEXT NOT NULL,
  disposition_mode TEXT NOT NULL,
  scope JSONB NOT NULL,
  provenance JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_economic_operations_opportunity
  ON economic_operations(opportunity_id);

CREATE INDEX IF NOT EXISTS idx_economic_operations_scope
  ON economic_operations ((scope->>'principal_scope'), ((scope->>'principal_id')));

CREATE TABLE IF NOT EXISTS economic_operation_observations (
  observation_sequence BIGINT GENERATED ALWAYS AS IDENTITY,
  observation_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES economic_operations(operation_id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL,
  lifecycle_state TEXT NOT NULL,
  evaluation_state TEXT NOT NULL,
  acquired_quantity BIGINT NOT NULL,
  disposed_quantity BIGINT NOT NULL,
  remaining_quantity BIGINT NOT NULL,
  operation_state JSONB NOT NULL,
  evidence JSONB NOT NULL,
  provenance JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_economic_operation_history
  ON economic_operation_observations(operation_id, observed_at, observation_id);
