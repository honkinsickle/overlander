-- Phase 1 (data foundation): required Postgres extensions.
-- Idempotent — safe to apply against an existing database.

create extension if not exists postgis;
create extension if not exists pg_trgm;
create extension if not exists "uuid-ossp";
