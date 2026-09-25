import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type {
  ApiDetailResponse,
  ApiErrorBody,
  ApiHealthResponse,
  ApiListResponse,
  ApiOpportunityDetail,
  ApiOpportunitySummary,
  OpportunityObservation,
  OpportunityObservationScope,
} from "@eve-trade/contracts";
import { projectDetail, projectSummary } from "./projection.js";
import type { OpportunityReadModel, ScopeAuthorizer } from "./read-model.js";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.writeHead(statusCode, jsonHeaders);
  response.end(JSON.stringify(payload));
}

function sendError(
  response: ServerResponse,
  statusCode: number,
  code: ApiErrorBody["error"]["code"],
  message: string,
): void {
  sendJson(response, statusCode, {
    contract_version: "phase-08.1",
    error: { code, message },
  } satisfies ApiErrorBody);
}

function parseInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum?: number,
): number | null {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) return null;
  if (maximum !== undefined && parsed > maximum) return null;
  return parsed;
}

function scopeFromQuery(
  url: URL,
): OpportunityObservationScope | null {
  const principalScope = url.searchParams.get("principal_scope") ?? "PUBLIC";
  if (
    principalScope !== "PUBLIC" &&
    principalScope !== "CHARACTER" &&
    principalScope !== "CORPORATION"
  ) {
    return null;
  }

  const principalIdRaw = url.searchParams.get("principal_id");
  const characterIdRaw = url.searchParams.get("character_id");

  if (principalScope === "PUBLIC") {
    if (principalIdRaw !== null || characterIdRaw !== null) return null;
    return {
      principal_scope: "PUBLIC",
      principal_id: null,
      character_id: null,
      provenance: null,
    };
  }

  const principalId = parseInteger(principalIdRaw, 0, 1);
  if (principalId === null || principalId === 0) return null;

  const characterId = parseInteger(characterIdRaw, 0, 1);
  if (characterIdRaw !== null && (characterId === null || characterId === 0)) {
    return null;
  }

  return {
    principal_scope: principalScope,
    principal_id: principalId,
    character_id: characterIdRaw === null ? null : characterId,
    provenance: null,
  };
}

function sameScope(
  left: OpportunityObservationScope,
  right: OpportunityObservationScope,
): boolean {
  return (
    left.principal_scope === right.principal_scope &&
    (left.principal_id ?? null) === (right.principal_id ?? null) &&
    (left.character_id ?? null) === (right.character_id ?? null)
  );
}

function sortNewest(
  observations: OpportunityObservation[],
): OpportunityObservation[] {
  return [...observations].sort(
    (left, right) =>
      right.observed_at.localeCompare(left.observed_at) ||
      right.observation_id.localeCompare(left.observation_id),
  );
}

function parseFilters(url: URL): {
  typeId: number | null;
  presence: OpportunityObservation["presence"] | null;
  freshness: OpportunityObservation["freshness_state"] | null;
  adviceKind: ApiOpportunitySummary["advice"]["kind"] | null;
  offset: number;
  limit: number;
  scope: OpportunityObservationScope;
} | null {
  const typeId = parseInteger(url.searchParams.get("type_id"), 0, 1);
  if (url.searchParams.has("type_id") && (typeId === null || typeId === 0)) {
    return null;
  }

  const limit = parseInteger(url.searchParams.get("limit"), 20, 1, 100);
  const offset = parseInteger(url.searchParams.get("offset"), 0, 0);
  if (limit === null || offset === null) return null;

  const presenceRaw = url.searchParams.get("presence");
  const freshnessRaw = url.searchParams.get("freshness_state");
  const adviceRaw = url.searchParams.get("advice_kind");

  const presence =
    presenceRaw === null
      ? null
      : presenceRaw === "PRESENT" ||
          presenceRaw === "ABSENT" ||
          presenceRaw === "UNAVAILABLE"
        ? presenceRaw
        : null;
  if (presenceRaw !== null && presence === null) return null;

  const freshness =
    freshnessRaw === null
      ? null
      : freshnessRaw === "CURRENT" ||
          freshnessRaw === "STALE" ||
          freshnessRaw === "UNKNOWN"
        ? freshnessRaw
        : null;
  if (freshnessRaw !== null && freshness === null) return null;

  const adviceKind =
    adviceRaw === null
      ? null
      : [
          "ACTIONABLE",
          "ACTIONABLE_WITH_LIMITATION",
          "WATCH",
          "NO_ACTION",
          "INSUFFICIENT_DATA",
        ].includes(adviceRaw)
        ? (adviceRaw as ApiOpportunitySummary["advice"]["kind"])
        : null;
  if (adviceRaw !== null && adviceKind === null) return null;

  const scope = scopeFromQuery(url);
  if (scope === null) return null;

  return {
    typeId: typeId === 0 ? null : typeId,
    presence,
    freshness,
    adviceKind,
    offset,
    limit,
    scope,
  };
}

function latestByOpportunity(
  observations: OpportunityObservation[],
): OpportunityObservation[] {
  const latest = new Map<string, OpportunityObservation>();
  for (const observation of observations) {
    const current = latest.get(observation.opportunity_id);
    if (
      current === undefined ||
      observation.observed_at > current.observed_at ||
      (observation.observed_at === current.observed_at &&
        observation.observation_id > current.observation_id)
    ) {
      latest.set(observation.opportunity_id, observation);
    }
  }
  return sortNewest([...latest.values()]);
}

export interface ApiServerDependencies {
  reader: OpportunityReadModel;
  authorizeScope?: ScopeAuthorizer;
}

export function createApiHandler({
  reader,
  authorizeScope = (scope) => scope.principal_scope === "PUBLIC",
}: ApiServerDependencies) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    response.setHeader("x-request-id", randomUUID());

    try {
      const method = request.method ?? "GET";
      if (method === "OPTIONS") {
        response.writeHead(204, jsonHeaders);
        response.end();
        return;
      }
      if (method !== "GET") {
        sendError(
          response,
          405,
          "METHOD_NOT_ALLOWED",
          "only GET and OPTIONS are supported",
        );
        return;
      }

      const url = new URL(request.url ?? "/", "http://eve-trade.local");

      if (url.pathname === "/health") {
        const payload: ApiHealthResponse = {
          contract_version: "phase-08.1",
          status: "ok",
        };
        sendJson(response, 200, payload);
        return;
      }

      const filters = parseFilters(url);
      if (filters === null) {
        sendError(response, 400, "BAD_REQUEST", "query parameters are invalid");
        return;
      }

      if (url.pathname === "/api/v1/opportunities") {
        if (!authorizeScope(filters.scope)) {
          sendError(response, 403, "FORBIDDEN", "requested principal scope is not authorized");
          return;
        }

        const observations = latestByOpportunity(
          (await reader.listAllObservations()).filter((item) =>
            sameScope(item.scope, filters.scope),
          ),
        );

        const projected = observations
          .filter((item) => filters.typeId === null || item.identity.payload.type_id === filters.typeId)
          .filter((item) => filters.presence === null || item.presence === filters.presence)
          .filter((item) => filters.freshness === null || item.freshness_state === filters.freshness)
          .map((item) => projectSummary(item))
          .filter((item) => filters.adviceKind === null || item.advice.kind === filters.adviceKind);

        const page = projected.slice(filters.offset, filters.offset + filters.limit);

        const payload: ApiListResponse<ApiOpportunitySummary> = {
          contract_version: "phase-08.1",
          data: {
            items: page,
            total: projected.length,
            offset: filters.offset,
            limit: filters.limit,
          },
        };
        sendJson(response, 200, payload);
        return;
      }

      const detailMatch = /^\/api\/v1\/opportunities\/([^/]+)$/.exec(url.pathname);
      if (detailMatch) {
        if (!authorizeScope(filters.scope)) {
          sendError(response, 403, "FORBIDDEN", "requested principal scope is not authorized");
          return;
        }

        const opportunityId = decodeURIComponent(detailMatch[1]!);
        const observations = sortNewest(
          (await reader.listObservations(opportunityId)).filter((item) =>
            sameScope(item.scope, filters.scope),
          ),
        );
        const latest = observations[0];

        if (latest === undefined) {
          sendError(
            response,
            404,
            "NOT_FOUND",
            "opportunity was not found in the requested scope",
          );
          return;
        }

        const payload: ApiDetailResponse<ApiOpportunityDetail> = {
          contract_version: "phase-08.1",
          data: projectDetail(latest),
        };
        sendJson(response, 200, payload);
        return;
      }

      sendError(response, 404, "NOT_FOUND", "route was not found");
    } catch (error) {
      const message = error instanceof Error ? error.message : "unexpected API failure";
      sendError(response, 500, "READ_MODEL_ERROR", message);
    }
  };
}
