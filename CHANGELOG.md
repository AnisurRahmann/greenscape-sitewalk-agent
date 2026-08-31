# Changelog

## v0.4.0 — 2026-08-31
- Added: /new capture page — lead details form plus tabbed audio (MediaRecorder webm, elapsed timer, direct-to-Storage signed upload) and typed-notes modes
- Added: whisper-1 transcription (src/lib/ingest/transcribe.ts) with 120s timeout, $0.006/min cost computed in TS, and agent_runs audit on success and failure
- Added: text input mode writes the transcript directly (no transcription cost) — the reliable demo fallback
- Added: three contractor-voice sample transcripts in fixtures/sitewalks (14K / 46K / 95K jobs)
## v0.3.0 — 2026-08-31
- Added: hybrid catalog retrieval — vector, lexical and pg_trgm strategies fused in Postgres with reciprocal rank fusion (k=60) via match_catalog_fused rpc
- Added: matchCatalog() typed client with normalised confidence scoring and MATCH_CONFIDENCE_THRESHOLD (0.55) unmatched gating
- Added: agent_runs auditing for query embedding calls (model, tokens, cost_usd, latency, status)
- Added: retrieval eval harness (eval:retrieval) — 40 query/expected-SKU pairs reporting accuracy@1, accuracy@5 and MRR per strategy
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
