-- Custom migration, hand-written: drizzle-kit generates table DDL from the
-- schema files, but this is a function those tables depend on.
--
-- `gen_random_uuid_v7()` is native in Postgres 18. The docker-compose image is
-- PostGIS on Postgres 16, so `common/db/columns.ts` `id()` would fail on the
-- first table without this shim. When the image moves to 18, drop this file
-- and the native implementation takes over — the output is interchangeable.
--
-- Needs pgcrypto for gen_random_bytes, which the init script already enables
-- alongside postgis.
CREATE OR REPLACE FUNCTION gen_random_uuid_v7() RETURNS uuid AS $$
DECLARE
  -- Unix milliseconds, big-endian, the first 48 bits of a v7 uuid.
  ts_millis bigint := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;
  bytes bytea := substring(int8send(ts_millis) from 3 for 6) || gen_random_bytes(10);
BEGIN
  -- Version 7 in the high nibble of byte 6.
  bytes := set_byte(bytes, 6, (get_byte(bytes, 6) & 15) | 112);
  -- RFC 4122 variant (10xx) in the top two bits of byte 8.
  bytes := set_byte(bytes, 8, (get_byte(bytes, 8) & 63) | 128);
  RETURN encode(bytes, 'hex')::uuid;
END $$ LANGUAGE plpgsql VOLATILE;
