import { randomUUID } from "node:crypto";
import type {
  CanonicalMarketState,
  EconomicOperation,
  LogisticsContext,
  MarketHistorySnapshot,
  MarketOrderRange,
  OpportunityPipelineRun,
  RecordAcquisitionInput,
  RecordDispositionInput,
  TradeAnalysisRequest,
} from "@eve-trade/contracts";
import {
  analyzeTradeRequest,
  createEconomicOperation,
  createOpportunityObservation,
  economicOperationId,
  economicOperationObservationId,
  generateMarketTradeCandidates,
  DEFAULT_MAX_DEPTH_LEVELS,
  planAcquisition,
} from "@eve-trade/domain";
import type {
  EconomicOperationRepository,
  OpportunityTrackingRepository,
} from "@eve-trade/db";

export interface OpportunityPipelineOptions {
  regionId: number;
  observedAt: string;
  deployableCapital: number | null;
  salesTaxRate: number | null;
  brokerFeeRate?: number | null;
  executionOrderRange?: MarketOrderRange;
  maxDepthLevels?: number;
  candidateStrategy?: "MARKET_TO_MARKET" | "BUY_AND_RELIST";
  evidenceResolver?: EconomicOperationEvidenceResolver;
}

type OpportunityTrackingSink = Pick<
  OpportunityTrackingRepository,
  "saveObservation" | "savePipelineRun"
>;
type EconomicOperationSink = Pick<EconomicOperationRepository, "save">;

export interface EconomicOperationEvidenceResolution {
  acquisition: RecordAcquisitionInput | null;
  disposition: RecordDispositionInput | null;
}

export interface EconomicOperationEvidenceResolver {
  resolve(
    operation: EconomicOperation,
    scenario: TradeAnalysisRequest["scenario"],
  ): Promise<EconomicOperationEvidenceResolution>;
}

function errorValue(error: unknown): { code: string; message: string } {
  return {
    code: "PIPELINE_EXECUTION_ERROR",
    message: error instanceof Error ? error.message : "unknown pipeline error",
  };
}

function historySnapshotUsable(
  market: CanonicalMarketState,
  snapshot: MarketHistorySnapshot | null,
): snapshot is MarketHistorySnapshot {
  return (
    snapshot !== null &&
    snapshot.status === "COMPLETE" &&
    snapshot.comparison_eligible &&
    snapshot.collection_id === market.collection_id &&
    snapshot.region_id === market.region_id &&
    market.status === "COMPLETE"
  );
}

function logisticsFor(
  origin: TradeAnalysisRequest["scenario"]["origin"],
  destination: TradeAnalysisRequest["scenario"]["destination"],
): LogisticsContext {
  if (origin.location_id === destination.location_id) {
    return {
      status: "COMPLETE",
      cost: 0,
      jump_count: 0,
      travel_time_seconds: 0,
      provenance: null,
    };
  }
  return {
    status: "UNKNOWN",
    cost: null,
    jump_count: null,
    travel_time_seconds: null,
    provenance: null,
  };
}

function requestFor(
  scenario: TradeAnalysisRequest["scenario"],
  snapshot: MarketHistorySnapshot,
  market: CanonicalMarketState,
  options: OpportunityPipelineOptions,
): TradeAnalysisRequest {
  const makerSell = scenario.disposition.market.execution_mode === "MAKER_SELL";
  return {
    scenario,
    analysis_context: {
      as_of: options.observedAt,
      freshness_policy: {
        max_market_age_seconds: 900,
        max_player_age_seconds: null,
      },
    },
    acquisition_market:
      scenario.acquisition.source === "MARKET"
        ? { snapshot, market }
        : null,
    disposition_market: { snapshot, market },
    player_context: null,
    capital_policy: {
      source: "EXPLICIT_DEPLOYABLE",
      deployable_capital: options.deployableCapital,
      escrow: null,
      escrow_is_separate: true,
    },
    fee_context: {
      broker_fee_rate: options.brokerFeeRate ?? null,
      sales_tax_rate: options.salesTaxRate,
      source:
        options.salesTaxRate === null || (makerSell && options.brokerFeeRate === null)
          ? "UNKNOWN"
          : "EXPLICIT",
    },
    logistics_context: logisticsFor(scenario.origin, scenario.destination),
    constraints: {
      max_quantity: null,
      max_capital: null,
      min_quantity: null,
      execution_modes: makerSell
        ? ["TAKER_AGAINST_SELL", "MAKER_SELL"]
        : ["TAKER_AGAINST_SELL", "TAKER_AGAINST_BUY"],
    },
  };
}

function createPlannedOperation(
  scenario: TradeAnalysisRequest["scenario"],
  opportunityId: string,
  result: ReturnType<typeof analyzeTradeRequest>,
  observedAt: string,
) {
  const acquisitionProvenance = result.market_evidence.acquisition_provenance;
  const dispositionProvenance = result.market_evidence.disposition_provenance;
  const provenance = [
    ...(acquisitionProvenance ? [acquisitionProvenance] : []),
    ...(dispositionProvenance &&
    JSON.stringify(dispositionProvenance) !== JSON.stringify(acquisitionProvenance)
      ? [dispositionProvenance]
      : []),
  ];

  const dispositionMode = scenario.disposition.market.execution_mode;
  if (dispositionMode !== "MAKER_SELL" && dispositionMode !== "TAKER_AGAINST_BUY") {
    throw new Error("projected economic operation requires a supported disposition mode");
  }

  const operation = createEconomicOperation({
    operation_id: economicOperationId({
      type_id: scenario.type_id,
      initial_quantity: scenario.requested_quantity,
      acquisition_mode: "TAKER_AGAINST_SELL",
      disposition_mode: dispositionMode,
      origin: scenario.origin,
      destination: scenario.destination,
      created_at: observedAt,
    }),
    opportunity_id: opportunityId,
    type_id: scenario.type_id,
    initial_quantity: scenario.requested_quantity,
    acquisition_mode: "TAKER_AGAINST_SELL",
    disposition_mode: dispositionMode,
    scope: {
      principal_scope: "PUBLIC",
      principal_id: null,
      character_id: null,
      provenance: acquisitionProvenance,
    },
    provenance,
    created_at: observedAt,
  });

  const planned = planAcquisition(operation, observedAt);
  return {
    operation: planned,
    observationId: economicOperationObservationId(planned),
  };
}

export async function runOpportunityPipeline(
  market: CanonicalMarketState,
  historySnapshot: MarketHistorySnapshot | null,
  repository: OpportunityTrackingSink,
  options: OpportunityPipelineOptions,
  operationRepository: EconomicOperationSink | null = null,
): Promise<OpportunityPipelineRun> {
  const run: OpportunityPipelineRun = {
    run_id: randomUUID(),
    region_id: options.regionId,
    market_collection_id: market.collection_id,
    observed_at: options.observedAt,
    completed_at: null,
    status: "ERROR",
    candidates_generated: 0,
    analyses_produced: 0,
    observations_persisted: 0,
    economic_operations_created: 0,
    economic_operation_observations_persisted: 0,
    error: null,
  };

  try {
    if (!historySnapshotUsable(market, historySnapshot)) {
      run.status = "INPUT_UNAVAILABLE";
      run.completed_at = new Date().toISOString();
      await repository.savePipelineRun(run);
      return run;
    }

    const candidates = generateMarketTradeCandidates(market, {
      execution_order_range: options.executionOrderRange ?? "region",
      max_depth_levels: options.maxDepthLevels ?? DEFAULT_MAX_DEPTH_LEVELS,
      maker_sell_buffer_levels: 1,
      strategy: options.candidateStrategy ?? "BUY_AND_RELIST",
    });
    run.candidates_generated = candidates.length;

    if (candidates.length === 0) {
      run.status = "NO_CANDIDATES";
      run.completed_at = new Date().toISOString();
      await repository.savePipelineRun(run);
      return run;
    }

    for (const scenario of candidates) {
      const result = analyzeTradeRequest(
        requestFor(scenario, historySnapshot, market, options),
      );
      run.analyses_produced += 1;

      const observation = createOpportunityObservation({
        observed_at: options.observedAt,
        scenario,
        phase4_result: result,
        presence: "PRESENT",
      });
      await repository.saveObservation(observation);
      run.observations_persisted += 1;

      if (
        operationRepository !== null &&
        result.status === "PROJECTED" &&
        result.acquisition_leg.filled_quantity === scenario.requested_quantity
      ) {
        const planned = createPlannedOperation(
          scenario,
          observation.opportunity_id,
          result,
          options.observedAt,
        );
        await operationRepository.save(
          planned.operation,
          planned.observationId,
        );
        run.economic_operations_created = (run.economic_operations_created ?? 0) + 1;
        run.economic_operation_observations_persisted =
          (run.economic_operation_observations_persisted ?? 0) + 1;

        if (options.evidenceResolver) {
          let reconciled = planned.operation;
          const evidence = await options.evidenceResolver.resolve(
            reconciled,
            scenario,
          );

          if (evidence.acquisition !== null) {
            reconciled = recordObservedAcquisition(
              reconciled,
              evidence.acquisition,
            );
            await operationRepository.save(
              reconciled,
              economicOperationObservationId(reconciled),
            );
            run.economic_operation_observations_persisted =
              (run.economic_operation_observations_persisted ?? 0) + 1;
          }

          if (evidence.disposition !== null) {
            reconciled = recordObservedDisposition(
              reconciled,
              evidence.disposition,
            );
            await operationRepository.save(
              reconciled,
              economicOperationObservationId(reconciled),
            );
            run.economic_operation_observations_persisted =
              (run.economic_operation_observations_persisted ?? 0) + 1;
          }
        }
      }
    }

    run.status = "SUCCESS";
    run.completed_at = new Date().toISOString();
    await repository.savePipelineRun(run);
    return run;
  } catch (error) {
    run.status = "ERROR";
    run.completed_at = new Date().toISOString();
    run.error = errorValue(error);
    await repository.savePipelineRun(run);
    throw error;
  }
}
