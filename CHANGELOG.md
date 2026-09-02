# Changelog

## v0.17.1 — 2026-09-02
- Fixed: G2 evidence_grounded no longer demands transcript verification for manually priced lines — the reviewer who set the price is the grounding (applies to the pipeline, review UI and approval reprice alike). G2 now also highlights the offending row instead of leaving the reviewer to hunt for it
- Added: the proposals list shows a pulsing "generating · <step>" chip while the pipeline is producing a proposal and auto-refreshes every 3s until it finishes, instead of a bare "draft" with no indication that generation is in flight

## v0.17.0 — 2026-09-02
- Added: manual-price escape hatch — reviewers price an unmatched line by hand (list price + required unit cost, with an optional cost auto-derived at 55% of price and visibly marked), clearing the G3 block and re-enabling approval; zeroing the price reverts the line to unmatched and re-blocks. Every manual price writes a labelled corrections row (type 'add') plus an audit entry
- Added: catalog identity snapshot on line items (migration 0009) — sku, catalog_name and cost_source stored per line so proposals are reproducible artifacts; descriptions render the catalog name (never the raw transcript phrase); existing rows backfilled from catalog_item_id
- Added: line-item soft delete (migration 0010) — "Remove line…" with a required reason; excluded lines stay visible struck-through in review but never price, and never reach the PDF or /p/[token]
- Added: corrections table (migration 0011) capturing every review correction as labelled training signal (qty/price/remove/remap/add with before/after, original query and match confidence), plus scripts/human-touch-rate.ts — human touch rate over a date range as a markdown table
- Added: cost_source lineage on line items (migration 0012) — catalog | reviewer | derived, with derived costs visibly marked in review; existing rows backfilled
- Added: guardrails tooltips with client-facing one-line explanations of every rule and severity banner
- Changed: G3 catalog_grounded now blocks approval while any line is match_method='unmatched' (previously a warning) — approval stays gated until the line is manually priced or removed; 'manual' lines count as grounded
- Fixed: agent spend rendered $0.00 — dated OpenAI snapshot model strings (gpt-4o-2024-08-06, gpt-4o-mini-2024-07-18) now price at their family's listed rate
- Fixed: sku chip reads the snapshotted catalog sku and the UNMATCHED chip shows only when match_method='unmatched' (previously inferred from sku, mislabelling rows)
- Fixed: line edits commit on blur via focus-time comparison (controlled-input state had been silently swallowing edits), manual-price and exclusion failures surface in the UI, and the margin floor caption is neutral unless margin is actually below 30%
- Deployment: apply migrations 0009–0012 with `supabase db push` (0009 and 0012 backfill existing rows)

## v0.16.0 — 2026-09-02
- Added: LLM_PROVIDER switch (anthropic default | openai) — with openai, chat tiers run on gpt-4o-mini (classify) and gpt-4o (extract/narrative) so a single OPENAI_API_KEY covers chat, Whisper transcription and embeddings; a switch, not a fallback, and audit rows record the model that actually answered
- Added: GPT-4o and GPT-4o-mini list prices in the rate table
- Added: first full pipeline ablation run (10 golden cases x 4 variants, LLM_PROVIDER=openai) — results in evals/RESULTS.md and the README with date and commit; in this run staged variants underperformed the single-shot baseline, and staged costs print $0.0000 due to unpriced dated snapshot model names (documented in RESULTS.md, numbers unedited)
## v0.15.0 — 2026-09-01
- Added: shared-password login gate for demo deployment (DEMO_PASSWORD + SESSION_SECRET env vars required; /p/[token] and /api/health stay public)
- Added: app launcher UI replacing the template landing page
- Changed: server-authoritative approval -- client-sent totals are ignored, proposal is repriced and re-guardrailed server-side, blocking rules throw ApprovalBlockedError
- Changed: pricing model stores catalog list price in unit_price with volume tier discount recorded in new discount_bps column (migration 0008)
- Fixed: tier application now idempotent across review repricing; eval variant C exercises the production matcher and threshold
 — 2026-08-31
- Added: /api/health liveness + database probe (503 when the DB is unreachable)
- Added: demo seed script (npm run seed:demo) — one approved proposal and one needs_review proposal with two G6-blocked lines, idempotent, environment-agnostic
- Added: client-bundle secret-leak gate (npm run verify:client) — scans served files for server-only env names and real secret values
- Changed: maxDuration = 120 on the ingest, review and pipeline-status routes covering the pipeline and dispatch after() continuations
## v0.13.1 — 2026-08-31
- Added: README with problem statement, ablation table, cost/latency budget, demo path, mermaid architecture and the scale-breakdown plan
- Added: ARCHITECTURE.md decision log — eight major decisions with options considered, choices and accepted trade-offs
- Changed: .env.example rewritten — every variable documented with source and purpose; APP_URL replaces NEXT_PUBLIC_APP_URL for outbound links
## v0.13.0 — 2026-08-31
- Added: golden evaluation set (evals/golden) — 10 hand-labelled site walks with expected catalog SKUs, quantities and correct prices, spanning small repairs, mixed multi-trade, heavy transcription noise, asks-but-doesn't-commit and HOA-heavy jobs
- Added: four-variant ablation runner (eval:pipeline) — single-shot vs extraction+vector vs extraction+hybrid RRF vs hybrid+guardrails
- Added: eval metrics — scope recall/precision, SKU accuracy@1, pricing error rate, hallucinated line rate and the headline false-flag rate, plus median latency and cost per proposal
- Added: pure metric module with unit tests; results regenerate evals/RESULTS.md as a markdown table
## v0.12.0 — 2026-08-31
- Added: dispatch layer (src/lib/dispatch) — on approval, email (Resend + PDF attachment), SMS (Twilio), Slack (internal total/margin/cost), Stripe Payment Link for the 50% deposit and GHL fire in parallel
- Added: deterministic outbound idempotency keys (proposalId:channel:version) backed by the unique index, so a double-clicked approval cannot double-send
- Added: retry with exponential backoff (3 attempts) on every external call, with attempts and errors recorded on outbound_events
- Added: swappable GHL adapter (GhlHttpClient / GhlMockClient via GHL_MODE, default mock) — mock writes outbound_events and posts to Slack; the HTTP client is written to the documented API v2 shape but unverified against a live account (disclosed in-code)
## v0.11.0 — 2026-08-31
- Added: branded PDF proposal document (@react-pdf/renderer) — logo block, client/property details, scope narrative, priced line table, clearly separated optional add-ons, 50% deposit banner, terms and signature block
- Added: server-side render-and-upload Server Action — PDFs land in the private 'proposals' storage bucket with pdf_path on the proposal and a one-hour signed download link
- Added: public /p/[token] client-facing web view (no auth, capability token) for approved/sent proposals with a Pay deposit button and PDF download
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
