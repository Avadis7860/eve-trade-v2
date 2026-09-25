CREATE TABLE IF NOT EXISTS opportunity_pipeline_runs (
  run_id UUID PRIMARY KEY,
  region_id BIGINT NOT NULL,
  market_collection_id UUID REFERENCES market_collections(collection_id) ON DELETE SET NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('SUCCESS','NO_CANDIDATES','INPUT_UNAVAILABLE','ERROR')),
  candidates_generated INTEGER NOT NULL,
  analyses_produced INTEGER NOT NULL,
  observations_persisted INTEGER NOT NULL,
  error JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opportunity_pipeline_runs_region_observed
  ON opportunity_pipeline_runs(region_id, observed_at, run_id);
