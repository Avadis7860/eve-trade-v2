# Worker

Background processing entry point.

The worker can run market ingestion or a character-scoped Player Data synchronization without requiring the web application.

## Market mode

Set:
- `DATABASE_URL`
- `ESI_USER_AGENT`
- `REGION_ID`

## Player mode

Set:
- `DATABASE_URL`
- `ESI_USER_AGENT`
- `PLAYER_CHARACTER_ID`
- `ESI_ACCESS_TOKEN` (optional; absent credentials are represented as UNKNOWN)

The access token is read only at the credential boundary and is never logged or persisted as Player Data. P3 does not persist refresh tokens; a durable implementation must provide a secure credential provider upstream of the worker.


## ESI compatibility

Set `ESI_COMPATIBILITY_DATE` to pin the ESI compatibility contract reviewed by the application. The default is the P3 certification date `2026-09-25`; changing it is an explicit compatibility review.


## Phase 8.1 opportunity pipeline

Market mode continues from the existing ingestion flow and then runs the opportunity pipeline against the same complete canonical collection and its comparable market-history snapshot.

Optional economic inputs:

- `DEPLOYABLE_CAPITAL`: explicit deployable capital used by Phase 4 analysis; when absent, the analysis remains data-limited rather than assuming zero or another value.
- `SALES_TAX_RATE`: explicit sales-tax configuration used by Phase 4 analysis; when absent, the fee input remains UNKNOWN.

The worker persists an operational `OpportunityPipelineRun` for each market cycle. Its status is:

- `SUCCESS`;
- `NO_CANDIDATES`;
- `INPUT_UNAVAILABLE`;
- `ERROR`.

The run counters make the operational chain observable without changing the opportunity domain contract.

No worker mode places, modifies or cancels EVE orders.
