# Migration integrity gate — isolated, non-production

This branch is based on current main. It does not deploy a Worker, proxy the existing blocked service, alter Supabase or migrate real data. Network authorization is a separate hard gate.

## Private restoration verification

The previous contract only covered the public schema and selected managed tables. The new comparison requires the current inventory of public, private, treasury staging, auth and storage tables. It detects missing tables even if both sides omit them, changed counts, and changed values with identical counts.

On an authorized, encrypted workstation, use a consistent snapshot or approved suspension of writes (including auth and background jobs). Use an authorized connection that can see all rows; row_security=off causes error rather than silently excluding rows. Keep source and restoration output private, outside Git. With PostgreSQL psql, use -X -qAt -v ON_ERROR_STOP=1 and -f migration-checks/fingerprint-postgres.sql, redirecting stdout to a private source file. Do the same on an isolated restored PostgreSQL with equivalent schema/version. Do not share connection strings, credentials or fingerprints. Run node migration-checks/compare-restoration.mjs <private-source-file> <private-restored-file>.

The SQL fingerprints sorted SHA-256 digests of complete JSONB rows. It is intentionally strict for same-version PostgreSQL restorations, not a direct PostgreSQL-to-D1 equivalence proof. Large tables can exceed statement or memory limits: fail closed and use a reviewed streaming comparator. Schema, RLS, functions, roles, extensions, secrets configuration, sequences, triggers, background jobs and actual storage object bytes still require separate verified restoration; ephemeral managed tables may require an explicit approved retention decision. The contract must be refreshed when the live schema changes. An existing export or a matching count alone is not proof of a backup.

## Free plan

Workers Free limits: 100,000 requests/day, 10 ms CPU per invocation; D1 Free: 5 million row reads/day, 100,000 row writes/day, 5 GB total. See current official docs:
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/r2/pricing/

The local gate uses an internal 80% threshold and fails when measurements, billing settings or cost controls are unknown. This does not enforce actual billing: metrics must be measured across the account, including indexes and staging, CPU under load, storage and egress. Never activate a billable service or increase the plan automatically. Existing R2 usage and billing need direct verification; no assumption of a hard free cap. Availability can be interrupted if free quotas are reached.

## Before proceeding

1. Official IT authorization for the intended hosting and data handling, including access from professional devices.
2. Two independent encrypted backups of database, authentication and all binary objects, verified against independently collected source inventories.
3. Restore and compare privately; resolve every discrepancy, including accounting history, private reconciliation and user access.
4. Synthetic tests of complete functional parity, isolation and free-plan performance. No production data in D1 staging.
5. Explicit approval of the final architecture and reversible cutover with write synchronization.

No evidence in this branch authorizes deployment, real-data import or switching production.
