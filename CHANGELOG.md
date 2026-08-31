# Changelog

## v0.2.0 — 2026-08-31
- Added: Supabase schema — 10 tables with pgvector/pg_trgm, HNSW + GIN indexes, RLS deny-all, database-level approval gate (CHECK + trigger) and unique idempotency_key
- Added: typed service-role server client (server-only) and Database types mirroring the migration
- Added: 210-item Phoenix hardscape pricing catalog (19 categories, 35-45% per-line margins, deliberate near-duplicate SKUs) with idempotent `db:seed`
- Added: catalog embedding pipeline via `db:embed` — batched text-embedding-3-small with token and cost logging

## v0.1.0 — 2026-08-31
- Added: Next.js 15 scaffold — App Router, TypeScript strict mode, Tailwind v4, src/ directory
- Added: shadcn/ui with default configuration
- Added: Supabase, Anthropic, OpenAI, Zod, Resend, Twilio, Stripe, @react-pdf/renderer and date-fns dependencies
- Added: CLAUDE.md with the engineering rules for the site-walk proposal agent
