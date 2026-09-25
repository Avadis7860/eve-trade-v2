import type {
  PredictionDatasetConfig,
  PredictionEvaluation,
  PredictionModel,
  PredictionSourceData,
  PredictionTargetKind,
  PredictionTrainingResult,
} from "@eve-trade/contracts";
import {
  buildPredictionDataset,
  evaluateEmpiricalRateModel,
  splitPredictionDataset,
  trainEmpiricalRateModel,
} from "@eve-trade/domain";
import type { OpportunityTrackingRepository } from "@eve-trade/db";

export interface PredictionPipelineConfig extends PredictionDatasetConfig {
  evaluation_start: string;
  target_kind: PredictionTargetKind;
  minimum_training_samples: number;
  model_version?: string;
}

export interface PredictionPipelineResult {
  dataset: ReturnType<typeof buildPredictionDataset>;
  training: PredictionTrainingResult;
  evaluation: PredictionEvaluation | null;
  model: PredictionModel | null;
}

export async function materializePredictionDataset(
  source: Pick<
    OpportunityTrackingRepository,
    "listAllObservations" | "listAllOutcomes"
  >,
  config: PredictionDatasetConfig,
) {
  const [observations, outcomes] = await Promise.all([
    source.listAllObservations(),
    source.listAllOutcomes(),
  ]);

  const input: PredictionSourceData = { observations, outcomes };
  return buildPredictionDataset(input, config);
}

export async function runPredictionTrainingPipeline(
  source: Pick<
    OpportunityTrackingRepository,
    "listAllObservations" | "listAllOutcomes"
  >,
  config: PredictionPipelineConfig,
): Promise<PredictionPipelineResult> {
  const dataset = await materializePredictionDataset(source, config);
  const split = splitPredictionDataset(
    dataset,
    config.evaluation_start,
    config.target_kind,
  );
  const training = trainEmpiricalRateModel(
    dataset,
    split.training_samples,
    config.target_kind,
    config.minimum_training_samples,
    config.model_version,
  );

  const evaluation =
    training.status === "READY" && training.model !== null
      ? evaluateEmpiricalRateModel(
          training.model,
          split.evaluation_samples,
          config.evaluation_start,
        )
      : null;

  return {
    dataset,
    training,
    evaluation,
    model: training.model,
  };
}
