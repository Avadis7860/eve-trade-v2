ALTER TABLE opportunity_pipeline_runs
  ADD COLUMN IF NOT EXISTS economic_operations_created INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS economic_operation_observations_persisted INTEGER NOT NULL DEFAULT 0;
