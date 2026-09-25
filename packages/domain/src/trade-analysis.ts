import { createHash } from "node:crypto";
import type {
  CanonicalPlayerState,
  EsiAsset,
  EsiMarketOrder,
  MarketAnalysisSnapshot,
  MarketLocation,
  MarketOrderRange,
  SimulatedFill,
  TradeAnalysisReason,
  TradeAnalysisStatus,
  TradeAnalysisRequest,
  TradeAnalysisResult,
  TradeExecutionMode,
  TradeLegResult,
  TradeScenario,
  LogisticsContext,
  PlayerAnalysisContext,
} from "@eve-trade/contracts";
import { TRADE_ANALYSIS_CONTRACT_VERSION } from "@eve-trade/contracts";

export type RangeEvaluationStatus = "COMPATIBLE" | "INCOMPATIBLE" | "UNKNOWN";

export interface RangeEvaluation {
  status: RangeEvaluationStatus;
  reason: string | null;
}

export interface TakerSimulationInput {
  snapshot: MarketAnalysisSnapshot;
  type_id: number;
  execution_location: MarketLocation;
  quantity: number;
  limit_price: number;
  order_range: MarketOrderRange;
  orders?: EsiMarketOrder[];
  jump_count_by_order_id?: Record<string, number>;
  max_settlement_value?: number;
}

export interface TakerSimulationResult {
  execution_mode: TradeExecutionMode;
  status: TradeAnalysisStatus;
  reasons: TradeAnalysisReason[];
  requested_quantity: number;
  filled_quantity: number;
  remaining_quantity: number;
  simulated_fills: SimulatedFill[];
  book_value: number | null;
  settlement_value: number | null;
}

function reason(
  code: TradeAnalysisReason["code"],
  message: string,
  blocking: boolean,
): TradeAnalysisReason {
  return { code, message, blocking };
}

function invalidQuantity(quantity: number): boolean {
  return !Number.isInteger(quantity) || quantity <= 0;
}

function invalidPrice(price: number): boolean {
  return !Number.isFinite(price) || price <= 0;
}

function validNonNegativeNumber(value: number | null): boolean {
  return value !== null && Number.isFinite(value) && value >= 0;
}

export function parseMarketOrderRange(value: string): MarketOrderRange | null {
  if (
    value === "station" ||
    value === "solarsystem" ||
    value === "region" ||
    value === "1" ||
    value === "2" ||
    value === "3" ||
    value === "4" ||
    value === "5" ||
    value === "10" ||
    value === "20" ||
    value === "30" ||
    value === "40"
  ) {
    return value;
  }
  return null;
}

function snapshotUsable(snapshot: MarketAnalysisSnapshot): boolean {
  return (
    snapshot.snapshot.status === "COMPLETE" &&
    snapshot.snapshot.comparison_eligible &&
    snapshot.market.status === "COMPLETE" &&
    snapshot.market.collection_id === snapshot.snapshot.collection_id &&
    snapshot.market.region_id === snapshot.snapshot.region_id
  );
}

export function evaluateRange(
  orderRange: MarketOrderRange,
  orderLocation: MarketLocation,
  targetLocation: MarketLocation,
  targetRegionId: number,
  jumpCount?: number,
): RangeEvaluation {
  if (orderRange === "station") {
    return orderLocation.location_id === targetLocation.location_id
      ? { status: "COMPATIBLE", reason: null }
      : { status: "INCOMPATIBLE", reason: "station mismatch" };
  }

  if (orderRange === "solarsystem") {
    return orderLocation.system_id === targetLocation.system_id
      ? { status: "COMPATIBLE", reason: null }
      : { status: "INCOMPATIBLE", reason: "solar-system mismatch" };
  }

  if (orderRange === "region") {
    return orderLocation.region_id === targetRegionId
      ? { status: "COMPATIBLE", reason: null }
      : { status: "INCOMPATIBLE", reason: "region mismatch" };
  }

  if (
    orderLocation.location_id === targetLocation.location_id ||
    orderLocation.system_id === targetLocation.system_id
  ) {
    return { status: "COMPATIBLE", reason: null };
  }

  if (orderLocation.region_id !== targetRegionId) {
    return { status: "INCOMPATIBLE", reason: "region mismatch" };
  }

  if (jumpCount === undefined) {
    return {
      status: "UNKNOWN",
      reason: "jump count is required for numeric order range",
    };
  }

  const allowedJumps = Number(orderRange);
  return jumpCount <= allowedJumps
    ? { status: "COMPATIBLE", reason: null }
    : { status: "INCOMPATIBLE", reason: "jump range exceeded" };
}

function sortSellOrders(
  orders: EsiMarketOrder[],
  input: TakerSimulationInput,
): { compatible: EsiMarketOrder[]; unknownRangeCount: number } {
  const compatible: EsiMarketOrder[] = [];
  let unknownRangeCount = 0;

  for (const order of orders) {
    if (
      order.type_id !== input.type_id ||
      order.is_buy_order ||
      order.volume_remain <= 0 ||
      order.price > input.limit_price
    ) {
      continue;
    }

    const range = evaluateRange(
      input.order_range,
      {
        region_id: input.snapshot.market.region_id,
        system_id: order.system_id,
        location_id: order.location_id,
      },
      input.execution_location,
      input.snapshot.market.region_id,
      input.jump_count_by_order_id?.[String(order.order_id)],
    );

    if (range.status === "UNKNOWN") {
      unknownRangeCount += 1;
      continue;
    }
    if (range.status === "COMPATIBLE") compatible.push(order);
  }

  compatible.sort((a, b) =>
    a.price !== b.price ? a.price - b.price : a.order_id - b.order_id,
  );
  return { compatible, unknownRangeCount };
}

function sortBuyOrders(
  orders: EsiMarketOrder[],
  input: TakerSimulationInput,
): { compatible: EsiMarketOrder[]; unknownRangeCount: number } {
  const compatible: EsiMarketOrder[] = [];
  let unknownRangeCount = 0;

  for (const order of orders) {
    if (
      order.type_id !== input.type_id ||
      !order.is_buy_order ||
      order.volume_remain <= 0 ||
      order.price < input.limit_price
    ) {
      continue;
    }

    const parsedRange = parseMarketOrderRange(order.range);
    if (parsedRange === null) {
      unknownRangeCount += 1;
      continue;
    }

    const range = evaluateRange(
      parsedRange,
      {
        region_id: input.snapshot.market.region_id,
        system_id: order.system_id,
        location_id: order.location_id,
      },
      input.execution_location,
      input.snapshot.market.region_id,
      input.jump_count_by_order_id?.[String(order.order_id)],
    );

    if (range.status === "UNKNOWN") {
      unknownRangeCount += 1;
      continue;
    }
    if (range.status === "COMPATIBLE") compatible.push(order);
  }

  compatible.sort((a, b) =>
    a.price !== b.price ? b.price - a.price : a.order_id - b.order_id,
  );
  return { compatible, unknownRangeCount };
}

function finalize(
  mode: TradeExecutionMode,
  input: TakerSimulationInput,
  candidates: EsiMarketOrder[],
  unknownRangeCount: number,
): TakerSimulationResult {
  let remaining = input.quantity;
  let settlementSpent = 0;
  let capitalExhausted = false;
  const fills: SimulatedFill[] = [];
  let bookValue = 0;

  for (const order of candidates) {
    if (remaining <= 0) break;

    const availableByCapital =
      input.max_settlement_value === undefined
        ? Number.MAX_SAFE_INTEGER
        : Math.floor(
            Math.max(0, input.max_settlement_value - settlementSpent) /
              input.limit_price,
          );

    if (availableByCapital <= 0) {
      capitalExhausted = true;
      break;
    }

    const quantity = Math.min(
      remaining,
      order.volume_remain,
      availableByCapital,
    );
    if (quantity <= 0) continue;

    fills.push({
      snapshot_id: input.snapshot.snapshot.snapshot_id,
      order_id: order.order_id,
      price: order.price,
      quantity,
      book_price: order.price,
      settlement_price: input.limit_price,
    });
    bookValue += quantity * order.price;
    settlementSpent += quantity * input.limit_price;
    remaining -= quantity;
  }

  if (remaining > 0 && input.max_settlement_value !== undefined) {
    const affordable = Math.floor(
      Math.max(0, input.max_settlement_value) / input.limit_price,
    );
    capitalExhausted = capitalExhausted || affordable < input.quantity;
  }

  const filled = input.quantity - remaining;
  const settlementValue = filled > 0 ? filled * input.limit_price : null;
  const reasons: TradeAnalysisReason[] = [];

  if (unknownRangeCount > 0 && remaining > 0) {
    reasons.push(
      reason(
        "RANGE_UNKNOWN",
        "some candidate orders cannot be classified without their jump distance",
        true,
      ),
    );
  }
  if (capitalExhausted && remaining > 0) {
    reasons.push(
      reason(
        "CAPITAL_INSUFFICIENT",
        "available deployable capital cannot satisfy the requested quantity",
        true,
      ),
    );
  }
  if (remaining > 0 && !capitalExhausted) {
    reasons.push(
      reason(
        "DEPTH_EXHAUSTED",
        "visible compatible liquidity cannot fully satisfy the requested quantity",
        true,
      ),
    );
  }

  let status: TradeAnalysisStatus;
  if (filled === 0 && unknownRangeCount > 0) status = "DATA_UNAVAILABLE";
  else if (filled === 0 && capitalExhausted) status = "NOT_EXECUTABLE";
  else if (remaining > 0) status = "PARTIAL";
  else status = "EXECUTABLE";

  return {
    execution_mode: mode,
    status,
    reasons,
    requested_quantity: input.quantity,
    filled_quantity: filled,
    remaining_quantity: remaining,
    simulated_fills: fills,
    book_value: filled > 0 ? bookValue : null,
    settlement_value: settlementValue,
  };
}

function invalidInputResult(
  mode: TradeExecutionMode,
  input: TakerSimulationInput,
  reasons: TradeAnalysisReason[],
): TakerSimulationResult {
  return {
    execution_mode: mode,
    status: "NOT_EXECUTABLE",
    reasons,
    requested_quantity: input.quantity,
    filled_quantity: 0,
    remaining_quantity: Math.max(0, input.quantity),
    simulated_fills: [],
    book_value: null,
    settlement_value: null,
  };
}

export function simulateTakerAgainstSell(
  input: TakerSimulationInput,
): TakerSimulationResult {
  const reasons: TradeAnalysisReason[] = [];
  if (invalidQuantity(input.quantity)) {
    reasons.push(
      reason(
        "QUANTITY_INVALID",
        "quantity must be a positive integer",
        true,
      ),
    );
  }
  if (invalidPrice(input.limit_price)) {
    reasons.push(
      reason(
        "PRICE_INVALID",
        "limit price must be a finite positive number",
        true,
      ),
    );
  }
  if (!snapshotUsable(input.snapshot)) {
    reasons.push(
      reason(
        "MARKET_NOT_COMPARABLE",
        "market snapshot is not a complete comparable canonical state",
        true,
      ),
    );
  }
  if (reasons.length > 0) {
    return invalidInputResult("TAKER_AGAINST_SELL", input, reasons);
  }

  const candidates = sortSellOrders(
    input.orders ?? input.snapshot.market.orders,
    input,
  );
  return finalize(
    "TAKER_AGAINST_SELL",
    input,
    candidates.compatible,
    candidates.unknownRangeCount,
  );
}

export function simulateTakerAgainstBuy(
  input: TakerSimulationInput,
): TakerSimulationResult {
  const reasons: TradeAnalysisReason[] = [];
  if (invalidQuantity(input.quantity)) {
    reasons.push(
      reason(
        "QUANTITY_INVALID",
        "quantity must be a positive integer",
        true,
      ),
    );
  }
  if (invalidPrice(input.limit_price)) {
    reasons.push(
      reason(
        "PRICE_INVALID",
        "limit price must be a finite positive number",
        true,
      ),
    );
  }
  if (!snapshotUsable(input.snapshot)) {
    reasons.push(
      reason(
        "MARKET_NOT_COMPARABLE",
        "market snapshot is not a complete comparable canonical state",
        true,
      ),
    );
  }
  if (reasons.length > 0) {
    return invalidInputResult("TAKER_AGAINST_BUY", input, reasons);
  }

  const candidates = sortBuyOrders(
    input.orders ?? input.snapshot.market.orders,
    input,
  );
  return finalize(
    "TAKER_AGAINST_BUY",
    input,
    candidates.compatible,
    candidates.unknownRangeCount,
  );
}

export interface TradeScenarioFingerprintInput {
  scenario: unknown;
  configuration: unknown;
  as_of: string;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export function fingerprintTradeScenario(
  input: TradeScenarioFingerprintInput,
): string {
  const payload = {
    contract_version: TRADE_ANALYSIS_CONTRACT_VERSION,
    scenario: stableValue(input.scenario),
    configuration: stableValue(input.configuration),
    as_of: input.as_of,
  };
  return createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

function validLocation(location: MarketLocation): boolean {
  return (
    Number.isInteger(location.region_id) &&
    location.region_id > 0 &&
    Number.isInteger(location.system_id) &&
    location.system_id > 0 &&
    Number.isInteger(location.location_id) &&
    location.location_id > 0
  );
}

function validFreshnessPolicy(policy: TradeAnalysisRequest["analysis_context"]["freshness_policy"]): boolean {
  return (
    (policy.max_market_age_seconds === null ||
      (Number.isFinite(policy.max_market_age_seconds) &&
        Number.isInteger(policy.max_market_age_seconds) &&
        policy.max_market_age_seconds >= 0)) &&
    (policy.max_player_age_seconds === null ||
      (Number.isFinite(policy.max_player_age_seconds) &&
        Number.isInteger(policy.max_player_age_seconds) &&
        policy.max_player_age_seconds >= 0))
  );
}

function timeMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function freshnessReasons(
  label: string,
  observedAt: string | null | undefined,
  freshUntil: string | null | undefined,
  maxAgeSeconds: number | null,
  asOfMs: number,
): TradeAnalysisReason[] {
  const reasons: TradeAnalysisReason[] = [];
  if (observedAt === null || observedAt === undefined) {
    reasons.push(
      reason(
        "FRESHNESS_METADATA_MISSING",
        `${label} observation timestamp is missing`,
        true,
      ),
    );
    return reasons;
  }

  const observedMs = timeMs(observedAt);
  if (observedMs === null) {
    reasons.push(
      reason(
        "FRESHNESS_METADATA_MISSING",
        `${label} observation timestamp is invalid`,
        true,
      ),
    );
    return reasons;
  }

  if (observedMs > asOfMs) {
    reasons.push(
      reason(
        "FUTURE_DATA",
        `${label} observation occurs after analysis as_of`,
        true,
      ),
    );
  }

  if (freshUntil !== null && freshUntil !== undefined) {
    const freshUntilMs = timeMs(freshUntil);
    if (freshUntilMs === null) {
      reasons.push(
        reason(
          "FRESHNESS_METADATA_MISSING",
          `${label} freshness expiry metadata is invalid`,
          true,
        ),
      );
    } else if (freshUntilMs < asOfMs) {
      reasons.push(
        reason(
          "FRESHNESS_EXCEEDED",
          `${label} source freshness has expired at analysis as_of`,
          true,
        ),
      );
    }
  }

  if (
    maxAgeSeconds !== null &&
    asOfMs - observedMs > maxAgeSeconds * 1000
  ) {
    reasons.push(
      reason(
        "FRESHNESS_EXCEEDED",
        `${label} age exceeds the declared freshness policy`,
        true,
      ),
    );
  }

  return reasons;
}

function validateMarketContext(
  snapshot: MarketAnalysisSnapshot | null,
  expectedLocation: MarketLocation,
  label: string,
): TradeAnalysisReason[] {
  if (snapshot === null) {
    return [
      reason(
        "MARKET_UNAVAILABLE",
        `${label} market snapshot is absent`,
        true,
      ),
    ];
  }

  const reasons: TradeAnalysisReason[] = [];
  if (!snapshotUsable(snapshot)) {
    reasons.push(
      reason(
        snapshot.snapshot.status === "ERROR" || snapshot.market.status !== "COMPLETE"
          ? "MARKET_UNAVAILABLE"
          : "MARKET_NOT_COMPARABLE",
        `${label} market snapshot is not usable for deterministic analysis`,
        true,
      ),
    );
  }

  if (snapshot.market.provenance.principal_scope !== "PUBLIC") {
    reasons.push(
      reason(
        "MARKET_SCOPE_INVALID",
        `${label} market liquidity must remain PUBLIC-scope market evidence`,
        true,
      ),
    );
  }

  if (snapshot.market.region_id !== expectedLocation.region_id) {
    reasons.push(
      reason(
        "MARKET_NOT_COMPARABLE",
        `${label} market region does not match the scenario execution location`,
        true,
      ),
    );
  }

  return reasons;
}

function validateMarketLeg(
  leg: TradeScenario["acquisition"]["market"] | TradeScenario["disposition"]["market"],
  expectedMode: TradeExecutionMode,
  expectedLocation: MarketLocation,
  expectedQuantity: number,
  executionModes: TradeExecutionMode[],
  label: string,
): TradeAnalysisReason[] {
  if (leg === undefined) {
    return [
      reason(
        "SCENARIO_INVALID",
        `${label} market leg is missing`,
        true,
      ),
    ];
  }

  const reasons: TradeAnalysisReason[] = [];
  if (leg.execution_mode !== expectedMode) {
    reasons.push(
      reason(
        leg.execution_mode === "MAKER_BUY" || leg.execution_mode === "MAKER_SELL"
          ? "MAKER_MODE_UNSUPPORTED"
          : "SCENARIO_INVALID",
        leg.execution_mode === "MAKER_BUY" || leg.execution_mode === "MAKER_SELL"
          ? "maker execution is reserved for a later Phase 4 extension"
          : `${label} execution mode is incompatible with this leg`,
        true,
      ),
    );
  }

  if (!executionModes.includes(leg.execution_mode)) {
    reasons.push(
      reason(
        "CONSTRAINT_VIOLATION",
        `${label} execution mode is not enabled by the request constraints`,
        true,
      ),
    );
  }

  if (
    leg.execution_location.region_id !== expectedLocation.region_id ||
    leg.execution_location.system_id !== expectedLocation.system_id ||
    leg.execution_location.location_id !== expectedLocation.location_id
  ) {
    reasons.push(
      reason(
        "SCENARIO_INVALID",
        `${label} execution location must match the scenario location`,
        true,
      ),
    );
  }

  if (!Number.isInteger(leg.quantity) || leg.quantity !== expectedQuantity) {
    reasons.push(
      reason(
        "QUANTITY_INVALID",
        `${label} quantity must equal the scenario requested quantity`,
        true,
      ),
    );
  }

  if (invalidPrice(leg.limit_price)) {
    reasons.push(
      reason(
        "PRICE_INVALID",
        `${label} limit price must be a finite positive number`,
        true,
      ),
    );
  }

  return reasons;
}

function walletComponentComplete(
  component: CanonicalPlayerState["wallet"],
): component is CanonicalPlayerState["wallet"] & { records: number[] } {
  return (
    component.quality.availability === "COMPLETE" &&
    component.quality.coverage === "COMPLETE" &&
    component.quality.health === "HEALTHY" &&
    component.records !== null
  );
}

function assetComponentComplete(
  component: CanonicalPlayerState["assets"],
): component is CanonicalPlayerState["assets"] & { records: EsiAsset[] } {
  return (
    component.quality.availability === "COMPLETE" &&
    component.quality.coverage === "COMPLETE" &&
    component.quality.health === "HEALTHY" &&
    component.records !== null
  );
}

function playerFreshness(
  player: PlayerAnalysisContext | null,
  asOfMs: number,
  maxAgeSeconds: number | null,
  required: "wallet" | "assets",
): TradeAnalysisReason[] {
  if (player === null) {
    return [
      reason(
        "WALLET_UNAVAILABLE",
        required === "wallet"
          ? "player context is required to resolve wallet capital"
          : "player context is required to validate requested inventory evidence",
        true,
      ),
    ];
  }

  if (required === "wallet") {
    const component = player.state.wallet;
    if (!walletComponentComplete(component)) {
      return [
        reason(
          "WALLET_UNAVAILABLE",
          "wallet component is not complete and healthy",
          true,
        ),
        ...freshnessReasons(
          "wallet",
          component.quality.observed_at,
          component.quality.fresh_until,
          maxAgeSeconds,
          asOfMs,
        ),
      ];
    }

    return freshnessReasons(
      "wallet",
      component.quality.observed_at,
      component.quality.fresh_until,
      maxAgeSeconds,
      asOfMs,
    );
  }

  const component = player.state.assets;
  if (!assetComponentComplete(component)) {
    return [
      reason(
        "INVENTORY_UNAVAILABLE",
        "asset component is not complete and healthy",
        true,
      ),
      ...freshnessReasons(
        "inventory",
        component.quality.observed_at,
        component.quality.fresh_until,
        maxAgeSeconds,
        asOfMs,
      ),
    ];
  }

  return freshnessReasons(
    "inventory",
    component.quality.observed_at,
    component.quality.fresh_until,
    maxAgeSeconds,
    asOfMs,
  );
}

function resolveInventoryEvidence(
  player: PlayerAnalysisContext | null,
  scenario: Extract<TradeScenario["acquisition"], { source: "EXISTING_INVENTORY" }>,
): { reasons: TradeAnalysisReason[]; records: EsiAsset[] | null } {
  const inventory = scenario.inventory;
  if (inventory === undefined) {
    return {
      reasons: [
        reason(
          "SCENARIO_INVALID",
          "existing inventory source is missing its inventory descriptor",
          true,
        ),
      ],
      records: null,
    };
  }

  if (inventory.type_id <= 0 || !Number.isInteger(inventory.type_id)) {
    return {
      reasons: [
        reason(
          "SCENARIO_INVALID",
          "inventory type_id must be a positive integer",
          true,
        ),
      ],
      records: null,
    };
  }

  if (!Number.isInteger(inventory.quantity) || inventory.quantity <= 0) {
    return {
      reasons: [
        reason(
          "QUANTITY_INVALID",
          "inventory quantity must be a positive integer",
          true,
        ),
      ],
      records: null,
    };
  }

  if (
    inventory.cost_basis !== undefined &&
    inventory.cost_basis !== null &&
    !validNonNegativeNumber(inventory.cost_basis)
  ) {
    return {
      reasons: [
        reason(
          "SCENARIO_INVALID",
          "inventory cost basis must be a finite non-negative number when supplied",
          true,
        ),
      ],
      records: null,
    };
  }

  if (inventory.asset_ids === undefined) {
    return { reasons: [], records: null };
  }

  if (player === null) {
    return {
      reasons: [
        reason(
          "INVENTORY_UNAVAILABLE",
          "explicit asset_ids require complete and healthy player asset evidence",
          true,
        ),
      ],
      records: null,
    };
  }

  const assets = player.state.assets;
  if (!assetComponentComplete(assets)) {
    return {
      reasons: [
        reason(
          "INVENTORY_UNAVAILABLE",
          "explicit asset_ids require complete and healthy player asset evidence",
          true,
        ),
      ],
      records: null,
    };
  }

  const selected = inventory.asset_ids
    .map((id) => assets.records.find((asset) => asset.item_id === id) ?? null);

  if (selected.some((asset) => asset === null)) {
    return {
      reasons: [
        reason(
          "INVENTORY_UNAVAILABLE",
          "one or more requested asset_ids are absent from the canonical inventory",
          true,
        ),
      ],
      records: null,
    };
  }

  const records = selected.filter((asset): asset is EsiAsset => asset !== null);
  if (records.some((asset) => asset.type_id !== inventory.type_id)) {
    return {
      reasons: [
        reason(
          "SCENARIO_INVALID",
          "all explicit asset_ids must refer to the requested type_id",
          true,
        ),
      ],
      records: null,
    };
  }

  const available = records.reduce((sum, asset) => sum + asset.quantity, 0);
  if (available < inventory.quantity) {
    return {
      reasons: [
        reason(
          "INVENTORY_INSUFFICIENT",
          "canonical inventory evidence does not cover the requested quantity",
          true,
        ),
      ],
      records,
    };
  }

  return { reasons: [], records };
}

function capitalContext(
  request: TradeAnalysisRequest,
  inventoryRecords: EsiAsset[] | null,
): { context: TradeAnalysisResult["capital_context"]; reasons: TradeAnalysisReason[] } {
  const player = request.player_context;
  const reasons: TradeAnalysisReason[] = [];
  let walletCash: number | null = null;

  if (player !== null && walletComponentComplete(player.state.wallet)) {
    walletCash = player.state.wallet.records.at(-1) ?? null;
  }

  if (request.capital_policy.source === "WALLET_BALANCE") {
    if (!validNonNegativeNumber(walletCash)) {
      reasons.push(
        reason(
          "WALLET_UNAVAILABLE",
          "wallet balance is required by the declared capital policy",
          true,
        ),
      );
    }
  }

  if (
    request.capital_policy.source === "EXPLICIT_DEPLOYABLE" &&
    !validNonNegativeNumber(request.capital_policy.deployable_capital)
  ) {
    reasons.push(
      reason(
        "CAPITAL_UNAVAILABLE",
        "explicit deployable capital is missing or invalid",
        true,
      ),
    );
  }

  const deployable =
    request.capital_policy.source === "WALLET_BALANCE"
      ? walletCash
      : request.capital_policy.deployable_capital;

  return {
    context: {
      wallet_cash: walletCash,
      committed_escrow: request.capital_policy.escrow,
      inventory: inventoryRecords,
      deployable_capital: deployable,
      source: request.capital_policy.source,
    },
    reasons,
  };
}

function validateConstraints(
  request: TradeAnalysisRequest,
): TradeAnalysisReason[] {
  const constraints = request.constraints;
  const reasons: TradeAnalysisReason[] = [];

  if (
    constraints.max_quantity !== null &&
    (!Number.isInteger(constraints.max_quantity) ||
      constraints.max_quantity <= 0)
  ) {
    reasons.push(
      reason(
        "CONSTRAINT_VIOLATION",
        "max_quantity must be null or a positive integer",
        true,
      ),
    );
  }

  if (
    constraints.min_quantity !== null &&
    (!Number.isInteger(constraints.min_quantity) ||
      constraints.min_quantity <= 0)
  ) {
    reasons.push(
      reason(
        "CONSTRAINT_VIOLATION",
        "min_quantity must be null or a positive integer",
        true,
      ),
    );
  }

  if (
    constraints.max_capital !== null &&
    !validNonNegativeNumber(constraints.max_capital)
  ) {
    reasons.push(
      reason(
        "CONSTRAINT_VIOLATION",
        "max_capital must be null or a finite non-negative number",
        true,
      ),
    );
  }

  if (
    constraints.min_quantity !== null &&
    constraints.max_quantity !== null &&
    constraints.min_quantity > constraints.max_quantity
  ) {
    reasons.push(
      reason(
        "CONSTRAINT_VIOLATION",
        "min_quantity cannot exceed max_quantity",
        true,
      ),
    );
  }

  if (
    constraints.min_quantity !== null &&
    request.scenario.requested_quantity < constraints.min_quantity
  ) {
    reasons.push(
      reason(
        "CONSTRAINT_VIOLATION",
        "requested quantity is below min_quantity",
        true,
      ),
    );
  }

  if (
    constraints.max_quantity !== null &&
    request.scenario.requested_quantity > constraints.max_quantity
  ) {
    reasons.push(
      reason(
        "CONSTRAINT_VIOLATION",
        "requested quantity exceeds max_quantity",
        true,
      ),
    );
  }

  return reasons;
}

function dedupeReasons(reasons: TradeAnalysisReason[]): TradeAnalysisReason[] {
  const seen = new Set<string>();
  return reasons.filter((item) => {
    const key = item.code + ":" + item.message;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function statusFor(
  reasons: TradeAnalysisReason[],
  acquisition: TakerSimulationResult | TradeLegResult,
  disposition: TakerSimulationResult | TradeLegResult,
  economicComplete: boolean,
): TradeAnalysisStatus {
  if (reasons.some((item) => item.code === "FUTURE_DATA" || item.code === "FRESHNESS_EXCEEDED")) {
    return "STALE";
  }

  if (
    reasons.some((item) =>
      [
        "MARKET_UNAVAILABLE",
        "WALLET_UNAVAILABLE",
        "INVENTORY_UNAVAILABLE",
        "CAPITAL_UNAVAILABLE",
        "FRESHNESS_METADATA_MISSING",
      ].includes(item.code),
    )
  ) {
    return "DATA_UNAVAILABLE";
  }

  if (
    reasons.some((item) =>
      [
        "SCENARIO_INVALID",
        "CONSTRAINT_VIOLATION",
        "MAKER_MODE_UNSUPPORTED",
        "MARKET_SCOPE_INVALID",
        "QUANTITY_INVALID",
        "PRICE_INVALID",
        "INVENTORY_INSUFFICIENT",
        "CAPITAL_INSUFFICIENT",
      ].includes(item.code),
    )
  ) {
    if (
      "filled_quantity" in acquisition &&
      acquisition.filled_quantity > 0 &&
      acquisition.remaining_quantity > 0
    ) {
      return "PARTIAL";
    }
    return "NOT_EXECUTABLE";
  }

  if (!economicComplete) return "PARTIAL";
  if (acquisition.status === "PARTIAL" || disposition.status === "PARTIAL") return "PARTIAL";
  if (acquisition.status !== "EXECUTABLE" || disposition.status !== "EXECUTABLE") {
    return acquisition.status === "DATA_UNAVAILABLE" || disposition.status === "DATA_UNAVAILABLE"
      ? "DATA_UNAVAILABLE"
      : "NOT_EXECUTABLE";
  }

  return "EXECUTABLE";
}

export function analyzeTradeRequest(
  request: TradeAnalysisRequest,
): TradeAnalysisResult {
  const { scenario, analysis_context: analysisContext } = request;
  const asOfMs = timeMs(analysisContext.as_of);

  const fingerprint = fingerprintTradeScenario({
    scenario,
    as_of: analysisContext.as_of,
    configuration: {
      freshness_policy: analysisContext.freshness_policy,
      acquisition_market_snapshot_id: request.acquisition_market?.snapshot.snapshot_id ?? null,
      acquisition_market_state_fingerprint:
        request.acquisition_market?.snapshot.state_fingerprint ?? null,
      disposition_market_snapshot_id: request.disposition_market?.snapshot.snapshot_id ?? null,
      disposition_market_state_fingerprint:
        request.disposition_market?.snapshot.state_fingerprint ?? null,
      player_character_id: request.player_context?.state.character_id ?? null,
      player_wallet_observed_at:
        request.player_context?.state.wallet.quality.observed_at ?? null,
      player_assets_observed_at:
        request.player_context?.state.assets.quality.observed_at ?? null,
      capital_policy: request.capital_policy,
      fee_context: request.fee_context,
      logistics_context: request.logistics_context,
      constraints: request.constraints,
    },
  });

  const emptyMarketEvidence: TradeAnalysisResult["market_evidence"] = {
    acquisition_snapshot_id: null,
    disposition_snapshot_id: null,
    acquisition_order_ids: [],
    disposition_order_ids: [],
    acquisition_provenance: null,
    disposition_provenance: null,
  };

  const fallbackCapital: TradeAnalysisResult["capital_context"] = {
    wallet_cash: null,
    committed_escrow: request.capital_policy.escrow,
    inventory: null,
    deployable_capital:
      request.capital_policy.source === "EXPLICIT_DEPLOYABLE"
        ? request.capital_policy.deployable_capital
        : null,
    source: request.capital_policy.source,
  };

  const fallbackLeg = (
    mode: TradeExecutionMode | null,
    quantity: number,
    reasons: TradeAnalysisReason[],
  ): TradeLegResult => ({
    execution_mode: mode,
    requested_quantity: Math.max(0, quantity),
    filled_quantity: 0,
    remaining_quantity: Math.max(0, quantity),
    simulated_fills: [],
    status: "NOT_EXECUTABLE",
    reasons,
  });

  const validationReasons: TradeAnalysisReason[] = [];

  if (asOfMs === null) {
    validationReasons.push(
      reason(
        "SCENARIO_INVALID",
        "analysis as_of must be a valid timestamp",
        true,
      ),
    );
  }

  if (!validFreshnessPolicy(analysisContext.freshness_policy)) {
    validationReasons.push(
      reason(
        "SCENARIO_INVALID",
        "freshness policy values must be null or finite non-negative integer seconds",
        true,
      ),
    );
  }

  if (
    !Number.isInteger(scenario.type_id) ||
    scenario.type_id <= 0 ||
    !Number.isInteger(scenario.requested_quantity) ||
    scenario.requested_quantity <= 0 ||
    !validLocation(scenario.origin) ||
    !validLocation(scenario.destination)
  ) {
    validationReasons.push(
      reason(
        "SCENARIO_INVALID",
        "type_id, requested_quantity and locations must be valid positive identifiers",
        true,
      ),
    );
  }

  validationReasons.push(...validateConstraints(request));

  if (scenario.acquisition.source === "MARKET") {
    validationReasons.push(
      ...validateMarketLeg(
        scenario.acquisition.market,
        "TAKER_AGAINST_SELL",
        scenario.origin,
        scenario.requested_quantity,
        request.constraints.execution_modes,
        "acquisition",
      ),
    );
  } else if (scenario.acquisition.source !== "EXISTING_INVENTORY") {
    validationReasons.push(
      reason("SCENARIO_INVALID", "acquisition source is unsupported", true),
    );
  }

  validationReasons.push(
    ...validateMarketLeg(
      scenario.disposition.market,
      "TAKER_AGAINST_BUY",
      scenario.destination,
      scenario.requested_quantity,
      request.constraints.execution_modes,
      "disposition",
    ),
  );

  if (scenario.acquisition.source === "EXISTING_INVENTORY") {
    const inventoryCheck = resolveInventoryEvidence(
      request.player_context,
      scenario.acquisition,
    );
    validationReasons.push(...inventoryCheck.reasons);
  }

  if (request.fee_context.sales_tax_rate === null ||
      !Number.isFinite(request.fee_context.sales_tax_rate) ||
      request.fee_context.sales_tax_rate < 0) {
    validationReasons.push(
      reason(
        "FEE_RATE_UNKNOWN",
        "sales tax rate is required to calculate disposition fees for taker sale",
        true,
      ),
    );
  }

  const usableAsOf = asOfMs ?? Number.NaN;
  if (asOfMs !== null && validFreshnessPolicy(analysisContext.freshness_policy)) {
    if (scenario.acquisition.source === "MARKET") {
      validationReasons.push(
        ...freshnessReasons(
          "acquisition market",
          request.acquisition_market?.snapshot.observed_at ?? null,
          null,
          analysisContext.freshness_policy.max_market_age_seconds,
          usableAsOf,
        ),
      );
    }
    validationReasons.push(
      ...freshnessReasons(
        "disposition market",
        request.disposition_market?.snapshot.observed_at ?? null,
        null,
        analysisContext.freshness_policy.max_market_age_seconds,
        usableAsOf,
      ),
    );

    if (
      request.capital_policy.source === "WALLET_BALANCE" &&
      request.player_context !== null
    ) {
      validationReasons.push(
        ...playerFreshness(
          request.player_context,
          usableAsOf,
          analysisContext.freshness_policy.max_player_age_seconds,
          "wallet",
        ),
      );
    }

    if (
      scenario.acquisition.source === "EXISTING_INVENTORY" &&
      request.player_context !== null
    ) {
      validationReasons.push(
        ...playerFreshness(
          request.player_context,
          usableAsOf,
          analysisContext.freshness_policy.max_player_age_seconds,
          "assets",
        ),
      );
    }
  }

  if (scenario.acquisition.source === "MARKET") {
    validationReasons.push(
      ...validateMarketContext(
        request.acquisition_market,
        scenario.origin,
        "acquisition",
      ),
    );
  }
  validationReasons.push(
    ...validateMarketContext(
      request.disposition_market,
      scenario.destination,
      "disposition",
    ),
  );

  const inventoryCheck =
    scenario.acquisition.source === "EXISTING_INVENTORY"
      ? resolveInventoryEvidence(request.player_context, scenario.acquisition)
      : { reasons: [], records: null };

  const capital = capitalContext(request, inventoryCheck.records);
  validationReasons.push(...capital.reasons);

  const acquisitionMode =
    scenario.acquisition.source === "MARKET"
      ? "TAKER_AGAINST_SELL"
      : null;

  let acquisitionLeg: TradeLegResult;
  let acquisitionSettlement: number | null = null;
  let dispositionLeg: TradeLegResult;
  let dispositionSettlement: number | null = null;

  if (
    validationReasons.some((item) =>
      [
        "SCENARIO_INVALID",
        "MARKET_UNAVAILABLE",
        "MARKET_NOT_COMPARABLE",
        "MARKET_SCOPE_INVALID",
        "MAKER_MODE_UNSUPPORTED",
        "CONSTRAINT_VIOLATION",
      ].includes(item.code),
    )
  ) {
    acquisitionLeg = fallbackLeg(
      acquisitionMode,
      scenario.requested_quantity,
      validationReasons.filter((item) =>
        ["SCENARIO_INVALID", "MARKET_UNAVAILABLE", "MARKET_NOT_COMPARABLE", "MARKET_SCOPE_INVALID", "QUANTITY_INVALID", "PRICE_INVALID"].includes(item.code),
      ),
    );
  } else if (scenario.acquisition.source === "MARKET") {
    const capitalLimit =
      capital.context.deployable_capital === null
        ? undefined
        : Math.min(
            capital.context.deployable_capital,
            request.constraints.max_capital ?? Number.POSITIVE_INFINITY,
          );

    const simulationInput: TakerSimulationInput = {
      snapshot: request.acquisition_market!,
      type_id: scenario.type_id,
      execution_location: scenario.origin,
      quantity: scenario.requested_quantity,
      limit_price: scenario.acquisition.market.limit_price,
      order_range: scenario.acquisition.market.order_range,
    };
    if (capitalLimit !== undefined) {
      simulationInput.max_settlement_value = capitalLimit;
    }

    const result = simulateTakerAgainstSell(simulationInput);

    acquisitionLeg = {
      execution_mode: result.execution_mode,
      requested_quantity: result.requested_quantity,
      filled_quantity: result.filled_quantity,
      remaining_quantity: result.remaining_quantity,
      simulated_fills: result.simulated_fills,
      status: result.status,
      reasons: result.reasons,
    };
    acquisitionSettlement = result.settlement_value;
  } else {
    const inventory = scenario.acquisition.inventory!;
    acquisitionLeg = {
      execution_mode: null,
      requested_quantity: inventory.quantity,
      filled_quantity: inventory.quantity,
      remaining_quantity: 0,
      simulated_fills: [],
      status: "EXECUTABLE",
      reasons:
        inventory.cost_basis === null || inventory.cost_basis === undefined
          ? [
              reason(
                "INVENTORY_COST_BASIS_UNKNOWN",
                "historical inventory cost basis is unknown; only disposition economics can be computed",
                true,
              ),
            ]
          : [],
    };
  }

  if (
    !request.disposition_market ||
    validationReasons.some((item) =>
      [
        "SCENARIO_INVALID",
        "MARKET_UNAVAILABLE",
        "MARKET_NOT_COMPARABLE",
        "MARKET_SCOPE_INVALID",
        "MAKER_MODE_UNSUPPORTED",
        "CONSTRAINT_VIOLATION",
      ].includes(item.code),
    )
  ) {
    dispositionLeg = fallbackLeg(
      "TAKER_AGAINST_BUY",
      scenario.requested_quantity,
      validationReasons.filter((item) =>
        ["SCENARIO_INVALID", "MARKET_UNAVAILABLE", "MARKET_NOT_COMPARABLE", "MARKET_SCOPE_INVALID", "QUANTITY_INVALID", "PRICE_INVALID"].includes(item.code),
      ),
    );
  } else {
    const result = simulateTakerAgainstBuy({
      snapshot: request.disposition_market,
      type_id: scenario.type_id,
      execution_location: scenario.destination,
      quantity: scenario.requested_quantity,
      limit_price: scenario.disposition.market!.limit_price,
      order_range: scenario.disposition.market!.order_range,
    });
    dispositionLeg = {
      execution_mode: result.execution_mode,
      requested_quantity: result.requested_quantity,
      filled_quantity: result.filled_quantity,
      remaining_quantity: result.remaining_quantity,
      simulated_fills: result.simulated_fills,
      status: result.status,
      reasons: result.reasons,
    };
    dispositionSettlement = result.settlement_value;
  }

  const allReasons = dedupeReasons([
    ...validationReasons,
    ...acquisitionLeg.reasons,
    ...dispositionLeg.reasons,
  ]);

  const fullRoundTrip =
    acquisitionLeg.filled_quantity === scenario.requested_quantity &&
    acquisitionLeg.remaining_quantity === 0 &&
    dispositionLeg.filled_quantity === scenario.requested_quantity &&
    dispositionLeg.remaining_quantity === 0;

  const dispositionProceeds = dispositionSettlement;
  const acquisitionCashOutflow =
    scenario.acquisition.source === "MARKET"
      ? acquisitionSettlement
      : scenario.acquisition.inventory?.cost_basis ?? null;

  const feesTotal =
    dispositionProceeds !== null &&
    request.fee_context.sales_tax_rate !== null &&
    Number.isFinite(request.fee_context.sales_tax_rate) &&
    request.fee_context.sales_tax_rate >= 0
      ? dispositionProceeds * request.fee_context.sales_tax_rate
      : null;

  const logisticsCost = (() => {
    if (scenario.origin.location_id === scenario.destination.location_id) return 0;
    return request.logistics_context.status === "COMPLETE" &&
      validNonNegativeNumber(request.logistics_context.cost)
      ? request.logistics_context.cost
      : null;
  })();

  if (!fullRoundTrip && scenario.acquisition.source === "EXISTING_INVENTORY") {
    if (
      scenario.acquisition.inventory?.cost_basis === null ||
      scenario.acquisition.inventory?.cost_basis === undefined
    ) {
      allReasons.push(
        reason(
          "ECONOMIC_RESULT_UNAVAILABLE",
          "complete historical operation economics cannot be computed without inventory cost basis",
          true,
        ),
      );
    }
  }

  if (request.fee_context.sales_tax_rate !== null &&
      Number.isFinite(request.fee_context.sales_tax_rate) &&
      request.fee_context.sales_tax_rate >= 0 &&
      fullRoundTrip &&
      logisticsCost === null) {
    allReasons.push(
      reason(
        "LOGISTICS_INCOMPLETE",
        scenario.origin.location_id === scenario.destination.location_id
          ? "logistics context is incomplete"
          : "logistics cost is required when origin and destination differ",
        true,
      ),
    );
  }

  if (request.fee_context.sales_tax_rate === null ||
      !Number.isFinite(request.fee_context.sales_tax_rate) ||
      request.fee_context.sales_tax_rate < 0) {
    allReasons.push(
      reason(
        "FEE_RATE_UNKNOWN",
        "sales tax rate is required to calculate disposition fees",
        true,
      ),
    );
  }

  const grossResult =
    fullRoundTrip &&
    acquisitionCashOutflow !== null &&
    dispositionProceeds !== null
      ? dispositionProceeds - acquisitionCashOutflow
      : null;

  const economicFees = fullRoundTrip ? feesTotal : null;
  const economicLogistics = fullRoundTrip ? logisticsCost : null;
  const simulatedNetResult =
    grossResult !== null &&
    economicFees !== null &&
    economicLogistics !== null
      ? grossResult - economicFees - economicLogistics
      : null;

  const capitalRequired = acquisitionCashOutflow;
  const simulatedReturn =
    simulatedNetResult !== null &&
    capitalRequired !== null &&
    capitalRequired > 0
      ? simulatedNetResult / capitalRequired
      : null;

  if (fullRoundTrip && (feesTotal === null || logisticsCost === null)) {
    allReasons.push(
      reason(
        "ECONOMIC_RESULT_UNAVAILABLE",
        "full-round-trip economics remain incomplete because fees or logistics are unknown",
        true,
      ),
    );
  }

  const economicComplete =
    fullRoundTrip &&
    grossResult !== null &&
    feesTotal !== null &&
    logisticsCost !== null &&
    simulatedNetResult !== null &&
    (capitalRequired === null || capitalRequired >= 0);

  const marketEvidence: TradeAnalysisResult["market_evidence"] = {
    acquisition_snapshot_id:
      request.acquisition_market?.snapshot.snapshot_id ?? null,
    disposition_snapshot_id:
      request.disposition_market?.snapshot.snapshot_id ?? null,
    acquisition_order_ids: acquisitionLeg.simulated_fills.map(
      (fill) => fill.order_id,
    ),
    disposition_order_ids: dispositionLeg.simulated_fills.map(
      (fill) => fill.order_id,
    ),
    acquisition_provenance:
      request.acquisition_market?.market.provenance ?? null,
    disposition_provenance:
      request.disposition_market?.market.provenance ?? null,
  };

  const status = statusFor(
    dedupeReasons(allReasons),
    acquisitionLeg,
    dispositionLeg,
    economicComplete,
  );

  return {
    contract_version: TRADE_ANALYSIS_CONTRACT_VERSION,
    status,
    status_reasons: dedupeReasons(allReasons),
    scenario_fingerprint: fingerprint,
    acquisition_leg: acquisitionLeg,
    logistics_leg: request.logistics_context,
    disposition_leg: dispositionLeg,
    capital_context:
      capital.context ?? fallbackCapital,
    fee_context: request.fee_context,
    market_evidence: marketEvidence,
    economic_result: {
      acquisition_cash_outflow: acquisitionCashOutflow,
      disposition_proceeds: dispositionProceeds,
      gross_result: grossResult,
      fees_total: economicFees,
      logistics_cost: economicLogistics,
      simulated_net_result: simulatedNetResult,
      capital_required: capitalRequired,
      simulated_return: simulatedReturn,
    },
  };
}

export const analyzeTrade = analyzeTradeRequest;
