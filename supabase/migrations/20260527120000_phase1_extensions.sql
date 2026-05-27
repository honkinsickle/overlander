-- Phase 1 (data foundation): required Postgres extensions.
-- Idempotent — safe to apply against an existing database.

-- gen_random_uuid() is built into Postgres 13+ via pgcrypto — no extension needed.
-- (The existing 20260513000000_init_identity.sql uses gen_random_uuid() for the same reason.)
create extension if not exists postgis;
create extension if not exists pg_trgm;
