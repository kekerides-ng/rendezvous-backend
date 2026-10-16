-- Runs once, on an empty postgres-data volume, as the superuser.
-- Editing this file does nothing to an existing volume: `docker compose down -v` first.

-- profile.base_location and every radius search in discovery (architecture.md §3).
CREATE EXTENSION IF NOT EXISTS postgis;

-- Column-level encryption for phone and DOB under the NDPA (architecture.md §8).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Module schemas are NOT created here. Each module declares its tables with
-- pgSchema('<module>') and `bun run db:generate` emits the CREATE SCHEMA, so the
-- Drizzle schema files stay the single source of truth (CLAUDE.md rule 7).

SELECT 'companion init: postgis + pgcrypto ready' AS status;
