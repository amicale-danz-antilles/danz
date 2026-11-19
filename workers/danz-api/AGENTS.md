# DANZ Cloudflare migration — mandatory instructions for coding agents (including Codex)

## Context and approved work area
- This repository powers **Amicale DANZ Antilles**, a French military association. Real member data and financial records require careful access control.
- **Production frontend is `https://amicale-danz-antilles.github.io/danz/` on GitHub Pages. Do not edit, merge into, or deploy from `main`.**
- **Production Supabase must remain intact and serving users.** Never delete, truncate, modify, rotate credentials for, or migrate its live data while working on this task.
- Work ONLY on a new branch based on `cloudflare/danz-api-preparation` (or this preparation branch with explicit authorization). PR #52 is a **draft staging PR** and must not be merged automatically.
- Cloudflare staging Worker: `danz-api` and D1: `danz-staging`. The existing `stg_*` pilot schema is not the complete future application schema.

## Zero-loss migration contract
- Read `migration/PLAN-SANS-PERTE.md`, `migration/source-contract.json`, `migration/legacy-export-coverage.json`, and `migration/SAUVEGARDE-PRIVEE.md` **before writing migration code**.
- There are **36 public Supabase tables, five with composite primary keys, and nine Edge Functions**. The existing admin export only covers **16/36 tables**. All domains (identity, finance, documents, R2, Supabase Storage, push notifications, PWA/offline) must be audited.
- Use synthetic data in tests. Never read or save real personal, military, financial or credential data in git, CI artifacts, Worker responses, issue comments, screenshots, or logs.
- A complete independent encrypted backup and **verified isolated restore** are mandatory before any real data import.
- For data parity, require 100% of row keys and field values, full auth roles/statuses, accounting balances in integer cents, source/target asset size and SHA-256, and functionality tests. Stop on any unexplained difference.
- Preserve authentication without password exposure. Do not presume bcrypt verification on Workers Free works: benchmark **synthetic hashes only**, with CPU cost measured and clear no-cost constraints.
- Treat member, admin and treasurer separately; only active admins with `is_treasurer=true` may access treasury. Never trust user-supplied role flags. Enforce authorization at Worker API and use safe atomic D1 transactions for writes.
- No actual cutover, frontend change, change of billing plan, production import, credential rotation, data deletion or decommissioning without **new explicit user approval after a signed-off readiness report**.
- Do not add billing obligations, external services, security-bypass instructions, or unreviewed dependencies.

## Development workflow
1. Inspect existing test and migration code. Implement one coherent safe milestone per pull request.
2. Keep the staging Worker available, public diagnostic routes read-only and test-only. No real user login exposed until independently validated.
3. Ensure `node --test` in `workers/danz-api/` passes (and other repo checks as appropriate).
4. Document exact coverage, what has NOT been verified, required approvals and rollback requirements.
5. Produce a PR for human review. Never auto-merge or push to `main`.
6. Prioritize code that **verifies** backups and cross-system parity over code that moves production data.
7. If blocked by unavailable secrets, local equipment, provider quotas, policy approval or missing backups, report the blocker instead of bypassing it.

## First safe task for Codex
Improve staging-only backup/restore validation and a dry-run migration pipeline driven by **synthetic fixtures**, with strong negative tests for absent records, truncated storage, broken foreign keys and altered amounts. Produce a detailed readiness checklist. Do not initiate the live migration.
