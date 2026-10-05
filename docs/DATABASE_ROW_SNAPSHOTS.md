# Consistent database row snapshots

Run `node --env-file=.env scripts/backup-row-snapshot.mjs` before an explicit schema change. It reads the public schema in one PostgreSQL REPEATABLE READ, READ ONLY transaction, streams rows through gzip, and saves a SHA-256 receipt in ignored `data/backups/`. It does not stop the server or the local model.

The final `.jsonl.gz` filename is published only after successful stream completion and transaction commit. A failed run removes its `.partial` file. A final `complete` record contains per-table row counts. Raw PostgreSQL JSON text preserves bigint/numeric values without a JavaScript number round trip. Snapshot headers include the checked-in migration SQL and table column types.

These are logical **data** snapshots, not `pg_dump` archives or full cluster backups. They exclude other schemas, roles, extensions, sequence positions and browser profile files. A matching database schema and a separately validated restore procedure are required. Do not erase the running database on the strength of this snapshot alone. Automated pre-migration enforcement and a full restore rehearsal remain pending.

Snapshot files can contain candidate and application information. Keep them outside Git; do not attach them to public reports. Tests use an isolated PostgreSQL schema and confirm that a write committed during the export does not enter the snapshot.
