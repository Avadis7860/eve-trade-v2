import type {
  OpportunityObservation,
  SourceProvenance,
  TradeAnalysisResult,
  TradeScenario,
} from "@eve-trade/contracts";

export const publicProvenance: SourceProvenance = {
  source_kind: "ESI",
  source_id: "esi:market:10000002",
  endpoint: "/markets/10000002/orders/",
  principal_scope: "PUBLIC",
};

export const scenario: TradeScenario = {
  type_id: 34,
  requested_quantity: 10,
  acquisition: {
    source: "MARKET",
    market: {
      execution_mode: "TAKER_AGAINST_SELL",
      execution_location: {
        region_id: 10000002,
        system_id: 30000142,
        location_id: 60003760,
      },
      quantity: 10,
      limit_price: 100,
      order_range: "region",
    },
  },
  disposition: {
    source: "MARKET",
    market: {
      execution_mode: "TAKER_AGAINST_BUY",
      execution_location: {
        region_id: 10000002,
        system_id: 30000142,
        location_id: 60003760,
      },
      quantity: 10,
      limit_price: 120,
      order_range: "region",
    },
  },
  origin: {
    region_id: 10000002,
    system_id: 30000142,
    location_id: 60003760,
  },
  destination: {
    region_id: 10000002,
    system_id: 30000142,
    location_id: 60003760,
  },
};

export function analysis(): TradeAnalysisResult {
  return {
    contract_version: "phase-04.2",
    status: "EXECUTABLE",
    status_reasons: [],
    scenario_fingerprint: "phase4-fixture-1",
    acquisition_leg: {
      execution_mode: "TAKER_AGAINST_SELL",
      requested_quantity: 10,
      filled_quantity: 10,
      remaining_quantity: 0,
      simulated_fills: [],
      status: "EXECUTABLE",
      reasons: [],
    },
    logistics_leg: {
      status: "COMPLETE",
      cost: 0,
      jump_count: 0,
      travel_time_seconds: 0,
      provenance: null,
    },
    disposition_leg: {
      execution_mode: "TAKER_AGAINST_BUY",
      requested_quantity: 10,
      filled_quantity: 10,
      remaining_quantity: 0,
      simulated_fills: [],
      status: "EXECUTABLE",
      reasons: [],
    },
    capital_context: {
      wallet_cash: 10000,
      committed_escrow: 0,
      inventory: null,
      deployable_capital: 10000,
      source: "EXPLICIT_DEPLOYABLE",
    },
    fee_context: {
      broker_fee_rate: 0,
      sales_tax_rate: 0.05,
      source: "EXPLICIT",
    },
    market_evidence: {
      acquisition_snapshot_id: "acq-1",
      disposition_snapshot_id: "disp-1",
      acquisition_order_ids: [1001],
      disposition_order_ids: [2001],
      acquisition_provenance: publicProvenance,
      disposition_provenance: publicProvenance,
    },
    economic_result: {
      acquisition_cash_outflow: 1000,
      disposition_proceeds: 1200,
      gross_result: 200,
      fees_total: 60,
      logistics_cost: 0,
      simulated_net_result: 140,
      capital_required: 1000,
      simulated_return: 0.14,
    },
  };
}

export function publicObservation(
  opportunityId = "opp-1",
  observationId = "obs-1",
  observedAt = "2026-09-25T19:00:00Z",
): OpportunityObservation {
  const phase4 = analysis();
  return {
    opportunity_id: opportunityId,
    observation_id: observationId,
    observed_at: observedAt,
    identity: {
      opportunity_id: opportunityId,
      contract_version: "phase-05.1",
      payload: {
        type_id: scenario.type_id,
        requested_quantity: scenario.requested_quantity,
        acquisition_source: "MARKET",
        acquisition_market: (() => {
          if (scenario.acquisition.source !== "MARKET") {
            throw new Error("fixture acquisition must use MARKET source");
          }
          return {
            execution_mode: scenario.acquisition.market.execution_mode,
            execution_location: scenario.acquisition.market.execution_location,
            limit_price: scenario.acquisition.market.limit_price,
            order_range: scenario.acquisition.market.order_range,
          };
        })(),
        disposition_market: {
          execution_mode: scenario.disposition.market.execution_mode,
          execution_location: scenario.disposition.market.execution_location,
          limit_price: scenario.disposition.market.limit_price,
          order_range: scenario.disposition.market.order_range,
        },
        origin: scenario.origin,
        destination: scenario.destination,
      },
    },
    scenario_snapshot: scenario,
    phase4_contract_version: "phase-04.2",
    phase4_scenario_fingerprint: phase4.scenario_fingerprint,
    presence: "PRESENT",
    freshness_state: "CURRENT",
    phase4_result: phase4,
    market_snapshot_ids: {
      acquisition: "acq-1",
      disposition: "disp-1",
    },
    order_ids: {
      acquisition: [1001],
      disposition: [2001],
    },
    provenance: [publicProvenance],
    scope: {
      principal_scope: "PUBLIC",
      principal_id: null,
      character_id: null,
      provenance: null,
    },
  };
}
