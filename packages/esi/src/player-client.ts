import type {
  EsiAsset,
  EsiCharacterOrder,
  EsiCharacterPublicInfo,
  EsiWalletJournalEntry,
  EsiWalletTransaction,
} from "@eve-trade/contracts";
import { EsiHttpClient, type EsiHttpResult } from "./http-client.js";

const CHARACTER_PUBLIC = "/characters/{character_id}/";
const WALLET = "/v1/characters/{character_id}/wallet/";
const JOURNAL = "/v6/characters/{character_id}/wallet/journal/";
const TRANSACTIONS = "/v1/characters/{character_id}/wallet/transactions/";
const ASSETS = "/v5/characters/{character_id}/assets/";
const ORDERS = "/v2/characters/{character_id}/orders/";

function assertCharacterId(characterId: number): void {
  if (!Number.isInteger(characterId) || characterId <= 0) {
    throw new Error("characterId must be a positive integer");
  }
}

function path(template: string, characterId: number): string {
  assertCharacterId(characterId);
  return template.replace("{character_id}", String(characterId));
}

function assertArray<T>(value: unknown, label: string, valid: (item: unknown) => item is T): T[] {
  if (!Array.isArray(value) || !value.every(valid)) {
    throw new Error(`ESI ${label} response is not a valid array`);
  }
  return value;
}

function isCharacter(value: unknown): value is EsiCharacterPublicInfo {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === "string" && typeof v.corporation_id === "number";
}

function isWalletEntry(value: unknown): value is EsiWalletJournalEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "number" && typeof v.date === "string" && typeof v.amount === "number" &&
    typeof v.balance === "number" && typeof v.description === "string" &&
    typeof v.first_party_id === "number" && typeof v.ref_type === "string" && typeof v.second_party_id === "number";
}

function isTransaction(value: unknown): value is EsiWalletTransaction {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.client_id === "number" && typeof v.date === "string" &&
    typeof v.is_buy === "boolean" && typeof v.is_personal === "boolean" &&
    typeof v.journal_ref_id === "number" && typeof v.location_id === "number" &&
    typeof v.quantity === "number" && typeof v.transaction_id === "number" &&
    typeof v.type_id === "number" && typeof v.unit_price === "number";
}

function isAsset(value: unknown): value is EsiAsset {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.item_id === "number" && typeof v.location_flag === "string" &&
    typeof v.location_id === "number" && typeof v.location_type === "string" &&
    typeof v.quantity === "number" && typeof v.is_singleton === "boolean" && typeof v.type_id === "number";
}

function isOrder(value: unknown): value is EsiCharacterOrder {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.duration === "number" && typeof v.escrow === "number" &&
    typeof v.is_buy_order === "boolean" && typeof v.issued === "string" &&
    typeof v.location_id === "number" && typeof v.min_volume === "number" &&
    typeof v.order_id === "number" && typeof v.price === "number" &&
    typeof v.range === "string" && typeof v.system_id === "number" &&
    typeof v.type_id === "number" && typeof v.volume_remain === "number" &&
    typeof v.volume_total === "number";
}

export class EsiPlayerClient {
  constructor(private readonly http: EsiHttpClient) {}

  async fetchCharacter(characterId: number): Promise<EsiHttpResult<EsiCharacterPublicInfo>> {
    const result = await this.http.getJson<unknown>(path(CHARACTER_PUBLIC, characterId));
    if (!isCharacter(result.data)) throw new Error("ESI character response is invalid");
    return { ...result, data: result.data };
  }

  async fetchWallet(characterId: number, accessToken: string): Promise<EsiHttpResult<number>> {
    const result = await this.http.getJson<unknown>(path(WALLET, characterId), { accessToken });
    if (typeof result.data !== "number" || !Number.isFinite(result.data)) {
      throw new Error("ESI wallet response is invalid");
    }
    return { ...result, data: result.data };
  }

  async fetchWalletJournalPage(characterId: number, pageNumber: number, accessToken: string): Promise<EsiHttpResult<EsiWalletJournalEntry[]>> {
    if (!Number.isInteger(pageNumber) || pageNumber <= 0) throw new Error("page must be a positive integer");
    const result = await this.http.getJson<unknown>(path(JOURNAL, characterId), {
      accessToken,
      query: { page: pageNumber },
    });
    return { ...result, data: assertArray(result.data, "wallet journal", isWalletEntry) };
  }

  async fetchWalletTransactions(characterId: number, fromId: number | undefined, accessToken: string): Promise<EsiHttpResult<EsiWalletTransaction[]>> {
    const result = await this.http.getJson<unknown>(path(TRANSACTIONS, characterId), {
      accessToken,
      query: { from_id: fromId },
    });
    return { ...result, data: assertArray(result.data, "wallet transactions", isTransaction) };
  }

  async fetchAssetsPage(characterId: number, pageNumber: number, accessToken: string): Promise<EsiHttpResult<EsiAsset[]>> {
    if (!Number.isInteger(pageNumber) || pageNumber <= 0) throw new Error("page must be a positive integer");
    const result = await this.http.getJson<unknown>(path(ASSETS, characterId), {
      accessToken,
      query: { page: pageNumber },
    });
    return { ...result, data: assertArray(result.data, "assets", isAsset) };
  }

  async fetchActiveOrders(characterId: number, accessToken: string): Promise<EsiHttpResult<EsiCharacterOrder[]>> {
    const result = await this.http.getJson<unknown>(path(ORDERS, characterId), { accessToken });
    return { ...result, data: assertArray(result.data, "character orders", isOrder) };
  }
}
