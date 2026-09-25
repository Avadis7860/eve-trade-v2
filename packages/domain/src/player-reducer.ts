import type {
  CanonicalPlayerState,
  CharacterPrincipal,
  EsiAsset,
  EsiCharacterOrder,
  EsiCharacterPublicInfo,
  EsiWalletJournalEntry,
  EsiWalletTransaction,
  PlayerComponent,
  PlayerDataKind,
  PlayerDataQuality,
  PlayerObservation,
  PlayerSync,
} from "@eve-trade/contracts";

export interface PlayerReconstructionInput {
  collection_id: string;
  character_id: number;
  observed_at: string;
  observations: PlayerObservation[];
}

function quality(observations: PlayerObservation[]): PlayerDataQuality {
  if (observations.length === 0) {
    return {
      availability: "UNKNOWN",
      coverage: "UNKNOWN",
      health: "UNKNOWN",
      observed_at: null,
      fresh_until: null,
      observation_ids: [],
      error: null,
    };
  }

  const status =
    observations.some((x) => x.status === "ERROR")
      ? "ERROR"
      : observations.some((x) => x.status === "PARTIAL")
        ? "PARTIAL"
        : observations.some((x) => x.status === "UNKNOWN")
          ? "UNKNOWN"
          : "COMPLETE";

  const availability = status;
  const coverage =
    status === "COMPLETE"
      ? "COMPLETE"
      : status === "UNKNOWN"
        ? "UNKNOWN"
        : "PARTIAL";

  const health =
    status === "COMPLETE"
      ? "HEALTHY"
      : status === "UNKNOWN"
        ? "UNKNOWN"
        : status === "PARTIAL"
          ? "DEGRADED"
          : "FAILED";

  const observed = observations
    .map((x) => x.observed_at)
    .sort()
    .at(-1) ?? null;

  const expiries = observations
    .map((x) => x.headers.expires)
    .filter((x): x is string => x !== null)
    .map((x) => {
      const timestamp = Date.parse(x);
      return Number.isFinite(timestamp) ? timestamp : null;
    })
    .filter((x): x is number => x !== null)
    .sort((a, c) => a - c);

  return {
    availability,
    coverage,
    health,
    observed_at: observed,
    fresh_until: expiries.length > 0 ? new Date(expiries[0]!).toISOString() : null,
    observation_ids: observations.map((x) => x.observation_id),
    error: observations.find((x) => x.error !== null)?.error ?? null,
  };
}

function byKind(observations: PlayerObservation[], kind: PlayerDataKind): PlayerObservation[] {
  return observations
    .filter((x) => x.data_kind === kind)
    .sort((a, b) => {
      if (a.page_identity !== b.page_identity) return a.page_identity < b.page_identity ? -1 : 1;
      return a.observation_id < b.observation_id ? -1 : 1;
    });
}

function component<T>(observations: PlayerObservation[], records: T[]): PlayerComponent<T> {
  const q = quality(observations);
  return {
    quality: q,
    records: q.availability === "COMPLETE" ? records : null,
  };
}

function uniqueBy<T>(records: T[], key: (record: T) => number): T[] {
  const map = new Map<number, T>();
  for (const record of records) map.set(key(record), record);
  return [...map.entries()].sort(([a], [c]) => a - c).map(([, value]) => value);
}

function identityComponent(observations: PlayerObservation[]): PlayerComponent<EsiCharacterPublicInfo> | null {
  if (observations.length === 0) return null;
  const complete = observations.find((x) => x.status === "COMPLETE" && x.records.length > 0);
  const records = complete?.records.filter(
    (record): record is EsiCharacterPublicInfo =>
      typeof record === "object" && record !== null &&
      typeof (record as Record<string, unknown>).name === "string" &&
      typeof (record as Record<string, unknown>).corporation_id === "number",
  ) ?? [];
  return component(observations, records);
}

export function reconstructPlayerState(input: PlayerReconstructionInput): CanonicalPlayerState {
  const identityObservations = byKind(input.observations, "IDENTITY");
  const walletObservations = byKind(input.observations, "WALLET_BALANCE");
  const journalObservations = byKind(input.observations, "WALLET_JOURNAL");
  const transactionObservations = byKind(input.observations, "WALLET_TRANSACTION");
  const assetObservations = byKind(input.observations, "ASSET");
  const orderObservations = byKind(input.observations, "ACTIVE_ORDER");

  const walletRecords = walletObservations.flatMap((x) =>
    x.records.filter((record): record is number => typeof record === "number" && Number.isFinite(record)),
  );
  const journalRecords = journalObservations.flatMap((x) =>
    x.records.filter((record): record is EsiWalletJournalEntry =>
      typeof record === "object" && record !== null && typeof (record as Record<string, unknown>).id === "number",
    ),
  );
  const transactionRecords = transactionObservations.flatMap((x) =>
    x.records.filter((record): record is EsiWalletTransaction =>
      typeof record === "object" && record !== null && typeof (record as Record<string, unknown>).transaction_id === "number",
    ),
  );
  const assetRecords = assetObservations.flatMap((x) =>
    x.records.filter((record): record is EsiAsset =>
      typeof record === "object" && record !== null && typeof (record as Record<string, unknown>).item_id === "number",
    ),
  );
  const orderRecords = orderObservations.flatMap((x) =>
    x.records.filter((record): record is EsiCharacterOrder =>
      typeof record === "object" && record !== null && typeof (record as Record<string, unknown>).order_id === "number",
    ),
  );

  const identity = identityComponent(identityObservations);
  const identityRecord = identity?.records?.[0] ?? null;
  const principal: CharacterPrincipal = {
    character_id: input.character_id,
    name: identityRecord?.name ?? null,
    corporation_id: identityRecord?.corporation_id ?? null,
    identity_observation_id: identityObservations.find((x) => x.status === "COMPLETE")?.observation_id ?? null,
    observed_at: identity?.quality.observed_at ?? null,
    provenance: identityObservations.find((x) => x.status === "COMPLETE")?.provenance ?? null,
  };

  return {
    character_id: input.character_id,
    principal,
    identity,
    wallet: component(walletObservations, walletRecords.slice(-1)),
    journal: component(journalObservations, uniqueBy(journalRecords, (x) => x.id)),
    transactions: component(transactionObservations, uniqueBy(transactionRecords, (x) => x.transaction_id)),
    assets: component(assetObservations, uniqueBy(assetRecords, (x) => x.item_id)),
    active_orders: component(orderObservations, uniqueBy(orderRecords, (x) => x.order_id)),
  };
}

export function buildPlayerSync(input: PlayerReconstructionInput): PlayerSync {
  const state = reconstructPlayerState(input);
  const statuses = input.observations.map((x) => x.status);
  const hasComplete = statuses.some((x) => x === "COMPLETE");
  const status =
    statuses.some((x) => x === "ERROR")
      ? "ERROR"
      : statuses.some((x) => x === "PARTIAL")
        ? "PARTIAL"
        : statuses.some((x) => x === "UNKNOWN")
          ? hasComplete
            ? "PARTIAL"
            : "UNKNOWN"
          : "COMPLETE";
  return {
    collection_id: input.collection_id,
    character_id: input.character_id,
    observed_at: input.observed_at,
    status,
    observations: input.observations,
    state,
  };
}
