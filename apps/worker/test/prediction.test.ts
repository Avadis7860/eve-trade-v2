import assert from "node:assert/strict";
import test from "node:test";
import { materializePredictionDataset, runPredictionTrainingPipeline } from "../src/prediction.js";

const source = {
  async listAllObservations() {
    return [];
  },
  async listAllOutcomes() {
    return [];
  },
};

const config = {
  dataset_version: "phase-06-empty",
  prediction_horizon_seconds: 300,
  max_label_lag_seconds: 60,
  evaluation_start: "2026-09-25T10:00:00Z",
  target_kind: "PRESENCE_AT_HORIZON" as const,
  minimum_training_samples: 10,
};

test("worker materialization stays empty on cold start", async () => {
  const dataset = await materializePredictionDataset(source, config);
  assert.equal(dataset.metadata.sample_count, 0);
  assert.equal(dataset.metadata.labeled_sample_count, 0);
  assert.equal(dataset.metadata.input_observation_count, 0);
});

test("worker training pipeline returns insufficient data without inventing a model", async () => {
  const result = await runPredictionTrainingPipeline(source, config);
  assert.equal(result.training.status, "INSUFFICIENT_DATA");
  assert.equal(result.training.model, null);
  assert.equal(result.evaluation, null);
  assert.equal(result.model, null);
});
