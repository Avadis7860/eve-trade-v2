import { randomUUID } from "node:crypto";
import type {
  CharacterSourceProvenance,
  PlayerDataKind,
  PlayerObservation,
  PlayerSync,
  SourceProvenance,
} from "@eve-trade/contracts";
import { EsiHttpError, EsiPlayerClient } from "@eve-trade/esi";
import { PlayerDataRepository } from "@eve-trade/db";
import { buildPlayerSync } from "@eve-trade/domain";

export interface EsiCredentialProvider {
  getAccessToken(characterId: number): Promise<string | null>;
}

export interface PlayerSyncOptions {
  characterId: number;
  collectionId?: string;
  observedAt?: string;
}

function publicProvenance(endpoint: string): SourceProvenance {
  return { source_kind: "ESI", source_id: "esi:character", endpoint, principal_scope: "PUBLIC" };
}

function characterProvenance(characterId: number, endpoint: string): CharacterSourceProvenance {
  return {
    source_kind: "ESI",
    source_id: `esi:character/${characterId}`,
    endpoint,
    principal_scope: "CHARACTER",
    principal_id: characterId,
  };
}

function emptyHeaders(): PlayerObservation["headers"] {
  return {
    x_pages: null,
    last_modified: null,
    etag: null,
    expires: null,
    ratelimit_group: null,
    ratelimit_limit: null,
    ratelimit_remaining: null,
    ratelimit_used: null,
    retry_after: null,
    error_limit_remain: null,
    error_limit_reset: null,
    compatibility_date: null,
  };
}

function makeObservation(
  collectionId: string,
  characterId: number,
  dataKind: PlayerDataKind,
  pageIdentity: string,
  status: PlayerObservation["status"],
  provenance: SourceProvenance,
  observedAt: string,
  records: unknown[],
  rawPayload: unknown,
  meta: {
    http_status?: number | null;
    retry_count?: number;
    headers?: PlayerObservation["headers"];
    error?: PlayerObservation["error"] | null;
  } = {},
): PlayerObservation {
  return {
    observation_id: randomUUID(),
    collection_id: collectionId,
    character_id: characterId,
    data_kind: dataKind,
    page_identity: pageIdentity,
    observed_at: observedAt,
    status,
    provenance,
    http_status: meta.http_status ?? null,
    retry_count: meta.retry_count ?? 0,
    records,
    raw_payload: rawPayload,
    headers: meta.headers ?? emptyHeaders(),
    error: meta.error ?? null,
  };
}

function failedObservation(
  collectionId: string,
  characterId: number,
  kind: PlayerDataKind,
  pageIdentity: string,
  provenance: SourceProvenance,
  error: unknown,
): PlayerObservation {
  const esiError = error instanceof EsiHttpError ? error : null;
  return makeObservation(
    collectionId,
    characterId,
    kind,
    pageIdentity,
    "ERROR",
    provenance,
    new Date().toISOString(),
    [],
    null,
    {
      http_status: esiError?.status ?? null,
      error: {
        code: esiError ? `ESI_HTTP_${esiError.status}` : "ESI_PLAYER_REQUEST_FAILED",
        message: error instanceof Error ? error.message : "ESI player request failed",
        retryable: esiError?.retryable ?? false,
      },
    },
  );
}

function unknownObservation(
  collectionId: string,
  characterId: number,
  kind: Exclude<PlayerDataKind, "IDENTITY">,
  observedAt: string,
): PlayerObservation {
  return makeObservation(
    collectionId,
    characterId,
    kind,
    "unavailable",
    "UNKNOWN",
    characterProvenance(characterId, endpointFor(kind)),
    observedAt,
    [],
    null,
    {
      error: {
        code: "CREDENTIALS_UNAVAILABLE",
        message: "No access token available for character sync",
        retryable: false,
      },
    },
  );
}

function endpointFor(kind: Exclude<PlayerDataKind, "IDENTITY">): string {
  switch (kind) {
    case "WALLET_BALANCE": return "/v1/characters/{character_id}/wallet/";
    case "WALLET_JOURNAL": return "/v6/characters/{character_id}/wallet/journal/";
    case "WALLET_TRANSACTION": return "/v1/characters/{character_id}/wallet/transactions/";
    case "ASSET": return "/v5/characters/{character_id}/assets/";
    case "ACTIVE_ORDER": return "/v2/characters/{character_id}/orders/";
  }
}

function pageCount(headers: PlayerObservation["headers"]): number {
  if (headers.x_pages === null) return 1;
  const count = Number(headers.x_pages);
  if (!Number.isInteger(count) || count < 1) throw new Error("Invalid X-Pages header");
  return count;
}

function aggregateStatus(observations: PlayerObservation[]): PlayerSync["status"] {
  if (observations.some((x) => x.status === "ERROR")) return "ERROR";
  if (observations.some((x) => x.status === "PARTIAL")) return "PARTIAL";
  if (observations.some((x) => x.status === "UNKNOWN")) {
    return observations.some((x) => x.status === "COMPLETE") ? "PARTIAL" : "UNKNOWN";
  }
  return "COMPLETE";
}

export async function syncPlayerData(
  client: EsiPlayerClient,
  repository: PlayerDataRepository,
  credentials: EsiCredentialProvider,
  options: PlayerSyncOptions,
): Promise<PlayerSync> {
  if (!Number.isInteger(options.characterId) || options.characterId <= 0) {
    throw new Error("characterId must be a positive integer");
  }

  const collectionId = options.collectionId ?? randomUUID();
  const observedAt = options.observedAt ?? new Date().toISOString();
  const observations: PlayerObservation[] = [];
  await repository.createSync({
    collection_id: collectionId,
    character_id: options.characterId,
    observed_at: observedAt,
    status: "UNKNOWN",
  });

  try {
    try {
      const result = await client.fetchCharacter(options.characterId);
      observations.push(makeObservation(
        collectionId,
        options.characterId,
        "IDENTITY",
        "public",
        "COMPLETE",
        publicProvenance("/characters/{character_id}/"),
        result.observed_at,
        [result.data],
        result.data,
        { http_status: result.status, retry_count: result.retry_count, headers: result.headers },
      ));
    } catch (error) {
      observations.push(failedObservation(
        collectionId,
        options.characterId,
        "IDENTITY",
        "public",
        publicProvenance("/characters/{character_id}/"),
        error,
      ));
    }

    const token = await credentials.getAccessToken(options.characterId);
    const kinds: Exclude<PlayerDataKind, "IDENTITY">[] = [
      "WALLET_BALANCE",
      "WALLET_JOURNAL",
      "WALLET_TRANSACTION",
      "ASSET",
      "ACTIVE_ORDER",
    ];

    if (token === null) {
      observations.push(...kinds.map((kind) => unknownObservation(collectionId, options.characterId, kind, observedAt)));
    } else {
      const walletEndpoint = characterProvenance(options.characterId, endpointFor("WALLET_BALANCE"));
      try {
        const result = await client.fetchWallet(options.characterId, token);
        observations.push(makeObservation(collectionId, options.characterId, "WALLET_BALANCE", "current", "COMPLETE",
          walletEndpoint, result.observed_at, [result.data], result.data,
          { http_status: result.status, retry_count: result.retry_count, headers: result.headers }));
      } catch (error) {
        observations.push(failedObservation(collectionId, options.characterId, "WALLET_BALANCE", "current", walletEndpoint, error));
      }

      const journalEndpoint = characterProvenance(options.characterId, endpointFor("WALLET_JOURNAL"));
      try {
        const first = await client.fetchWalletJournalPage(options.characterId, 1, token);
        const pages = pageCount(first.headers);
        observations.push(makeObservation(collectionId, options.characterId, "WALLET_JOURNAL", "page:1", "COMPLETE",
          journalEndpoint, first.observed_at, first.data, first.data,
          { http_status: first.status, retry_count: first.retry_count, headers: first.headers }));
        for (let page = 2; page <= pages; page += 1) {
          const result = await client.fetchWalletJournalPage(options.characterId, page, token);
          if (pageCount(result.headers) !== pages) throw new Error("ESI_PAGINATION_CHANGED");
          observations.push(makeObservation(collectionId, options.characterId, "WALLET_JOURNAL", `page:${page}`, "COMPLETE",
            journalEndpoint, result.observed_at, result.data, result.data,
            { http_status: result.status, retry_count: result.retry_count, headers: result.headers }));
        }
      } catch (error) {
        observations.push(failedObservation(collectionId, options.characterId, "WALLET_JOURNAL", "error", journalEndpoint, error));
      }

      const transactionEndpoint = characterProvenance(options.characterId, endpointFor("WALLET_TRANSACTION"));
      try {
        let fromId: number | undefined;
        while (true) {
          const result = await client.fetchWalletTransactions(options.characterId, fromId, token);
          observations.push(makeObservation(
            collectionId,
            options.characterId,
            "WALLET_TRANSACTION",
            fromId === undefined ? "from_id:none" : `from_id:${fromId}`,
            "COMPLETE",
            transactionEndpoint,
            result.observed_at,
            result.data,
            result.data,
            { http_status: result.status, retry_count: result.retry_count, headers: result.headers },
          ));
          if (result.data.length === 0) break;
          if (fromId !== undefined && result.data.length === 1) break;
          const nextId = result.data.at(-1)?.transaction_id;
          if (nextId === undefined || nextId === fromId) throw new Error("ESI_FROM_ID_STALLED");
          fromId = nextId;
        }
      } catch (error) {
        observations.push(failedObservation(collectionId, options.characterId, "WALLET_TRANSACTION", "error", transactionEndpoint, error));
      }

      const assetEndpoint = characterProvenance(options.characterId, endpointFor("ASSET"));
      try {
        const first = await client.fetchAssetsPage(options.characterId, 1, token);
        const pages = pageCount(first.headers);
        observations.push(makeObservation(collectionId, options.characterId, "ASSET", "page:1", "COMPLETE",
          assetEndpoint, first.observed_at, first.data, first.data,
          { http_status: first.status, retry_count: first.retry_count, headers: first.headers }));
        for (let page = 2; page <= pages; page += 1) {
          const result = await client.fetchAssetsPage(options.characterId, page, token);
          if (pageCount(result.headers) !== pages) throw new Error("ESI_PAGINATION_CHANGED");
          observations.push(makeObservation(collectionId, options.characterId, "ASSET", `page:${page}`, "COMPLETE",
            assetEndpoint, result.observed_at, result.data, result.data,
            { http_status: result.status, retry_count: result.retry_count, headers: result.headers }));
        }
      } catch (error) {
        observations.push(failedObservation(collectionId, options.characterId, "ASSET", "error", assetEndpoint, error));
      }

      const orderEndpoint = characterProvenance(options.characterId, endpointFor("ACTIVE_ORDER"));
      try {
        const result = await client.fetchActiveOrders(options.characterId, token);
        observations.push(makeObservation(collectionId, options.characterId, "ACTIVE_ORDER", "current", "COMPLETE",
          orderEndpoint, result.observed_at, result.data, result.data,
          { http_status: result.status, retry_count: result.retry_count, headers: result.headers }));
      } catch (error) {
        observations.push(failedObservation(collectionId, options.characterId, "ACTIVE_ORDER", "current", orderEndpoint, error));
      }
    }

    for (const item of observations) {
      await repository.saveObservation(item);
    }

    const sync = buildPlayerSync({
      collection_id: collectionId,
      character_id: options.characterId,
      observed_at: observedAt,
      observations,
    });
    sync.status = aggregateStatus(observations);
    await repository.saveCanonical(sync.state);
    await repository.markSync(collectionId, sync.status);
    return sync;
  } catch (error) {
    await repository.markSync(collectionId, "ERROR");
    throw error;
  }
}

export async function rebuildPlayerState(
  repository: PlayerDataRepository,
  collectionId: string,
): Promise<PlayerSync> {
  const observations = await repository.listObservations(collectionId);
  const first = observations[0];
  if (!first) throw new Error("Player sync has no observations");
  return buildPlayerSync({
    collection_id: collectionId,
    character_id: first.character_id,
    observed_at: first.observed_at,
    observations,
  });
}
