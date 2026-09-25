# API Contract

EVE Trade v2 exposes product data through a versioned HTTP boundary.

## Contract

Current contract version: `phase-08.1`.

The boundary follows:

```
persisted evidence
      ↓
domain contracts
      ↓
API read model
      ↓
product UI
```

The API may compose existing domain contracts. It must not reproduce domain scoring, trade analysis or prediction rules.

## Routes

### GET /health

Transport/application health only. It is not a business-data result.

### GET /api/v1/opportunities

Returns the latest observation for each opportunity in the explicitly requested principal scope.

Supported filters:

- `limit`: 1–100, default 20
- `offset`: non-negative integer
- `type_id`: positive type identifier
- `presence`: PRESENT, ABSENT, UNAVAILABLE
- `freshness_state`: CURRENT, STALE, UNKNOWN
- `advice_kind`: ACTIONABLE, ACTIONABLE_WITH_LIMITATION, WATCH, NO_ACTION, INSUFFICIENT_DATA
- `principal_scope`: PUBLIC, CHARACTER, CORPORATION
- `principal_id`: required for non-public scopes
- `character_id`: optional explicit character identity for non-public scopes

The default scope is PUBLIC.

### GET /api/v1/opportunities/:opportunityId

Returns the latest observation for one opportunity in the explicitly requested scope, including the full trade-analysis and scoring contracts.

No implicit cross-scope merge is performed.

## Errors

Transport/API errors are distinct from business states:

```
HTTP 404 / 400 / 403 / 500
≠
ABSENT / UNAVAILABLE / UNKNOWN / STALE / PARTIAL
≠
NO_ACTION
≠
SCORE_UNAVAILABLE
```

A failed read does not become an empty successful list.

## Evidence propagation

The API preserves:

- source provenance;
- principal scope and identifiers;
- observation freshness;
- opportunity presence;
- trade-analysis status;
- scoring availability;
- score components;
- reasons, blockers and limitations;
- evidence references.

A `null` or unavailable value is preserved as unavailable. No API mapper turns missing evidence into numeric zero.

## Scope safety

The default authorizer only exposes PUBLIC observations.

CHARACTER and CORPORATION reads require an explicit application-supplied authorization policy. The API cannot derive authorization from a query parameter alone.

The read model groups and selects records only inside the exact requested scope tuple:

```
principal_scope
principal_id
character_id
```

## Read-only boundary

Phase 8 has no write endpoints and introduces no EVE credential flow. Browser clients must never call ESI directly.
