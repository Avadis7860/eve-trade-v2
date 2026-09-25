# Development Workflow

EVE Trade v2 uses one active technical chantier at a time: one branch, one pull request, one phase issue.

OPS-001 is a transverse operations chantier and follows the same isolation rule with its dedicated Issue, branch and pull request.

Every working branch starts from the current `main`.

A chantier is complete only when implementation, relevant tests/type checks, integration validation and documentation are complete, the pull request is merged, and `main` is revalidated.

## CI contract

The repository CI is the generic workflow:

`.github/workflows/ci.yml`

It is not tied to any product phase.

### Pull request validation

Pull requests targeting `main` run:

1. dependency installation from the locked `pnpm-lock.yaml`;
2. TypeScript type checking;
3. the complete workspace test suite with PostgreSQL 16 available.

The CI job does not call ESI, use EVE OAuth credentials or depend on application secrets.

### Main validation

Pushes to `main` execute the same validation contract. This provides a post-merge proof using the exact same environment and commands as PR validation.

### Manual validation

`workflow_dispatch` is available for an explicit re-run without changing repository code.

## CI efficiency

The CI intentionally keeps one application-validation job rather than splitting typecheck, tests and database validation into redundant jobs.

Concurrency cancels an obsolete run when a newer commit arrives for the same PR or ref.

The validation job has a 10-minute timeout. The historical CI runs are well below that ceiling; the timeout exists to cap pathological hangs rather than to extend normal execution time.

The pnpm store is cached using the repository lockfile as the dependency key. `node_modules` is not cached, preserving deterministic installation from the lockfile.

## Validation commands

The mandatory repository gates are:

```
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

The root `pnpm lint` script currently delegates recursively, but the workspaces do not expose a homogeneous `lint` script. Lint is therefore not a required CI gate until a separate lint contract exists.

## Database validation

PostgreSQL is provided as a GitHub Actions service:

```
PostgreSQL 16
database: eve_trade_v2
user: postgres
```

The service healthcheck gates the validation job. Existing integration tests apply the required migrations against the test database, so OPS-001 does not duplicate that work in a second PostgreSQL migration job.

Migrations remain ordered lexically from:

`database/migrations/*.sql`

## Dependency Review

`.github/workflows/dependency-review.yml` runs only for pull requests targeting `main`.

The check uses the official GitHub Dependency Review Action and focuses on high and critical known vulnerabilities in dependencies introduced by the pull request. License checking is currently disabled to avoid turning the security gate into an unscoped license-policy project.

No application tests are duplicated there.

## Dependabot

`.github/dependabot.yml` manages the root npm/pnpm dependency graph weekly.

Normal minor and patch updates are grouped. Security updates are grouped separately. Major version updates remain individual so they require deliberate review instead of becoming an automated bulk upgrade.

Normal version-update pull requests are limited to three open items.

## Security posture

Workflow permissions are restricted to:

```yaml
permissions:
  contents: read
```

Actions used by the repository workflows are pinned to immutable full commit SHAs.

Checkout does not persist the workflow token into the working tree.

No EVE credentials are required by CI.

CodeQL is intentionally deferred until the repository has a sufficiently meaningful public API/deployment surface to justify the additional analysis cost.

## Repository governance

The intended merge contract remains:

```
PR required
+
required CI checks
+
red required check blocks merge
```

The repository currently has no observable repository-level ruleset through the available GitHub integration, and direct branch-protection inspection requires owner-side GitHub administration access. Those settings must therefore be verified in GitHub repository settings before OPS-001 is considered fully governed.

There is no deployment, release publishing or application scheduler in this CI foundation.
