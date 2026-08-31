# Changelog

## v0.10.0 — 2026-08-31
- Added: /proposals review queue — status badge, lead, total, margin, guardrail flag count, generation cost, created time
- Added: /proposals/[id] review screen — editable line items repriced live by the real pricing engine, match-method chips, confidence bars, amber/red review highlighting, and verbatim transcript evidence on every row
- Added: transcript drawer with evidence spans highlighted in context; guardrail blocks/warns grouped in the right rail with the 30% margin floor on the gauge
- Added: approve gating on live-recomputed blocks and reject-with-reason; every edit writes an audit_log before/after entry
- Changed: guardrail rules split into a pure module (rules.ts) importable by the client so the UI and the pipeline run identical checks
## v0.9.0 — 2026-08-31
- Added: staged pipeline orchestrator (runSitewalkPipeline) — transcribe, classify, extract, match, price, guardrails, narrative, persist with graceful per-step failure handling
- Added: Haiku-tier classification gate that rejects non-site-walk audio before any Sonnet spend
- Added: cost accounting module (costOf, proposalCost) with the $0.75 ceiling checked before every LLM call; 120s AbortController dead-man switch across step boundaries and in-flight calls
- Added: live proposals.step_status progress (jsonb) with a polling endpoint /api/pipeline-status/[siteWalkId]; the ingest action triggers the pipeline via after() so HTTP responses never block
- Added: optional add-ons flow — uncommitted extraction items are matched but priced at $0, guarded by G7
## v0.8.0 — 2026-08-31
- Added: proposal narrative agent (src/lib/agent/draftNarrative.ts) — Sonnet tool-forced copy grounded only on priced line items, project summary and property context; the transcript and all cost data are structurally absent from its input
- Added: numeric leakage post-check — every dollar figure in the copy must equal a computed total; violations retry once, then a deterministic template takes over
- Added: deterministic timeline sentence from total value (2 weeks under $20K, 3-4 weeks to $50K, 5-6 weeks above)
- Added: agent_runs auditing for narrative attempts; 7 new unit tests (58 total)
## v0.7.0 — 2026-08-31
- Added: nine-rule guardrail layer (src/lib/guardrails) — schema validity, evidence grounding, catalog grounding, margin floor, total bounds, quantity sanity, uncommitted-item separation, cost ceiling and a 120s wall-clock dead-man switch
- Added: runGuardrails orchestrator — persists every rule result to guardrail_events and returns a verdict with inline per-line blocking rules for the UI
- Changed: any blocking rule routes the proposal to needs_review; warns badge without gating; cost/wall-clock failures abort the run
- Added: explicit record of the future auto-approve tier conditions (total < $15k, zero blocks, zero warns, match_confidence > 0.90) — approval remains human-only for now
- Added: 27 guardrail unit tests (pass + fail per rule, verdict routing, abort and persistence resilience)
## v0.6.0 — 2026-08-31
- Added: deterministic pricing engine (src/lib/pricing/engine.ts) — volume tiers, min_qty coercion, mobilization waiver at $40k, itemised 5% contingency, Phoenix 8.6% tax on materials only; zero LLM involvement
- Added: integer-cents money module — every currency value rounds through a single helper, no float arithmetic on money
- Added: catalog_items.materials_ratio column (default 0.45) with per-section seed values from bulk materials (0.6) to paperwork (0.05)
- Added: unmatched items carried visibly at $0 with needs_review instead of being dropped
- Added: 19 pricing tests incl. tier/waiver boundary cases and a seeded property test proving subtotal === sum of line totals in exact cents
## v0.5.0 — 2026-08-31
- Added: scope extraction agent (src/lib/agent/extractScope.ts) — Sonnet tool-forced structured extraction, zod contract generating the tool schema, max 2 validation-error repair retries then typed ExtractionFailedError
- Added: evidence verification — every span checked by normalised containment against the transcript, evidence_verified per item (rule 3)
- Added: per-model pricing table with real-token cost accounting into agent_runs (rule 4)
- Added: vitest unit suite (npm test) with mocked model client covering happy path, repair, hallucinated evidence and empty transcripts
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
