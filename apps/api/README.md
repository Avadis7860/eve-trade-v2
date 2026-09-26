# EVE Trade v2 API

The API is the read-only application boundary between persisted/domain evidence and product clients.

## Runtime

The server requires:

```
DATABASE_URL=postgresql://...
PORT=3000
HOST=0.0.0.0
```

Only `DATABASE_URL` is mandatory. The API does not accept or expose EVE credentials.

Run locally with:

```
pnpm --filter @eve-trade/api dev
```

## Codespaces

The repository Dev Container provides PostgreSQL 16 and the shared DATABASE_URL for the workspace.

The Codespaces bootstrap starts the API on port 3000 and validates PostgreSQL connectivity, migrations, GET /health, and the CORS contract used by the Web app.

The API starts without ESI_ACCESS_TOKEN, PLAYER_CHARACTER_ID, or any other EVE credential.

## Read contract

Opportunity contract version: `phase-08.1`
Economic operation contract version: `phase-08.3`

Public routes:

- `GET /health`
- `GET /api/v1/opportunities`
- `GET /api/v1/opportunities/:opportunityId`
- `GET /api/v1/operations`
- `GET /api/v1/operations/:operationId`

The API composes persisted opportunity observations with the deterministic scoring domain function. It also exposes persisted EconomicOperation state and history through a read-only boundary. It does not duplicate domain lifecycle rules.

The default read scope is `PUBLIC`. CHARACTER and CORPORATION data require an explicit authorized scope policy supplied by the application host.

Transport errors are represented separately from business states. An unavailable opportunity, stale evidence or an unavailable score remains a domain/data state; it is never replaced with a zero-value success response.

The API is intentionally read-only. Operation routes expose observed/projected economic state but never place, modify or cancel orders.
