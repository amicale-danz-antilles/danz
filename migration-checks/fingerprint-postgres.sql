\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
\pset pager off
-- PRIVATE OUTPUT ONLY. Execute from an approved computer, with an authorized
-- read-only connection that can see every row. Do not publish the fingerprints.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL row_security = off;
SET LOCAL statement_timeout = '120s';
-- Compare like-for-like PostgreSQL restorations, not PostgreSQL vs SQLite.
-- Sorted digests preserve multiplicity and remove dependence on physical row order.
SELECT format($q$
SELECT jsonb_build_object('table', %L, 'rows', count(*)::text,
  'sha256', encode(sha256(convert_to(coalesce(string_agg(h, '' ORDER BY h COLLATE "C"), ''), 'UTF8')), 'hex'))
FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex') AS h
      FROM %I.%I AS t) AS digests;
$q$, n.nspname || '.' || c.relname, n.nspname, c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','p')
  AND n.nspname IN ('public','private','danz_finance_v2_staging','auth','storage')
ORDER BY n.nspname,c.relname
\gexec
COMMIT;
