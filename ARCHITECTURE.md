# Architecture decision log

The eight decisions that shape this codebase. Each one: the options considered, what
was chosen, and the trade-off accepted. Everything else in the repo follows from these.

---

## 1. Who does the arithmetic

**Options considered.** (a) The LLM prices lines directly — one call, prompt includes
the catalog, fastest to build. (b) Hybrid — LLM proposes, code sanity-checks numbers.
(c) The LLM never touches numbers: extraction produces scope, a deterministic engine
prices it.

**Chosen.** (c) — `src/lib/pricing/engine.ts`, integer-cents arithmetic only. This is
CLAUDE.md rule 1 and the axis of the eval ablation (variant A vs C).

**Trade-off accepted.** Every pricing behavior — volume tiers, minimum quantities,
contingency, materials-share tax — is code someone has to write and maintain; the
model cannot "reason out" a discount we forgot to encode. Accepted because a
confidently wrong total is the one failure this product cannot survive: the entire
value is that the number on the page is reproducible.

---

## 2. Retrieval strategy

**Options considered.** (a) Vector-only semantic search. (b) Lexical/full-text only.
(c) Fuzzy trigram only. (d) Fusion of all three, done in application code. (e) Fusion
inside Postgres as a set-returning function.

**Chosen.** All three strategies plus reciprocal rank fusion (k=60) inside Postgres
(`match_catalog_fused`, migration 0002), because the golden cases show the failure
modes are complementary: lexical nails exact names and misses colloquial phrasing,
trigrams rescue mishearings ("pergula", 0.5 similarity — below Supabase's default
0.6 trigram threshold, so the function pins 0.3), vectors carry meaning.

**Trade-off accepted.** SQL functions are harder to iterate on than TypeScript, and
the pg_trgm threshold footgun (Supabase ships 0.6) required pinning inside the
function to be deployment-safe. Accepted because fusion close to the data means one
RPC per query, one ranking definition, and no re-implementation drift between the
pipeline and the eval harness.

---

## 3. Structured extraction

**Options considered.** (a) Free-text output parsed with regex/heuristics.
(b) JSON mode / "reply with only JSON". (c) Tool-forced output with a schema generated
from the zod contract, plus a bounded repair loop.

**Chosen.** (c) — `tool_choice` pinned to one tool, `input_schema` generated via
`z.toJSONSchema` so the model contract and the validator cannot drift, max 2 repair
retries with the validation error fed back as an error tool_result, then a typed
`ExtractionFailedError`.

**Trade-off accepted.** Two extra round-trips in the failure case and a slightly
strait-jacketed model (no chain-of-thought prose alongside the answer within one
message). Accepted because unparseable output is a pipeline stage, not an exception —
rule 2 counts the repairs, audits each attempt, and fails loudly on the third.

---

## 4. Evidence grounding

**Options considered.** (a) Trust the extraction; spot-check manually.
(b) Post-hoc LLM judgment ("does this evidence support the line?").
(c) Mechanical verification — every evidence span must be a substring of the
transcript after casefolding and whitespace collapse; failures are flagged, never
silently dropped.

**Chosen.** (c), as rules G2/G3-adjacent and `evidence_verified` per line item, with
the review UI surfacing the span on every row and a human attestation path for
unverified spans.

**Trade-off accepted.** Valid paraphrases get flagged and cost a human click (this is
measured, not hidden: the false-flag rate is the eval headline). Mechanical containment
is weaker than semantic judgment. Accepted because rule 3 is a trust product: Marcus
must be able to see the exact words that priced a line, and a mechanical check is one
that cannot itself hallucinate.

---

## 5. Guardrails as pure, shared rules

**Options considered.** (a) Checks inline in the pipeline code. (b) An LLM judge
reviewing the proposal. (c) Pure functions over an injected context, re-run by both
the server orchestrator (which persists) and the client review UI (which recomputes
live).

**Chosen.** (c) — `src/lib/guardrails/rules.ts` (pure) + `index.ts` (persistence).
The review UI imports the same rules so approve-gating, amber/red rows and the margin
gauge reflect exactly what the pipeline will enforce, live as Marcus edits.

**Trade-off accepted.** Pure rules see only the context they are handed — G3's valid
catalog ids and G8's cost are pipeline-computed inputs — and some thresholds (the G6
quantity P90 table) are static until real data exists. Accepted because the alternative
is two implementations of "is this proposal OK" that drift, and because an LLM judge
would make the enforcement layer as fallible as the thing it guards.

---

## 6. Human approval and the audit trail

**Options considered.** (a) Auto-send on pipeline success (fastest demo).
(b) Auto-approve within a risk band. (c) Human approval, enforced at the database
level, with every action audited.

**Chosen.** (c) — a CHECK constraint makes `status='sent'` impossible without
`approved_by`/`approved_at`, a trigger blocks customer-facing outbound rows for
unapproved proposals, the review UI disables approve while any guardrail block is
live, and every edit writes `audit_log` before/after. The conditions under which a
future auto-approve tier would be safe are written down in the guardrails module so
the reasoning is on record.

**Trade-off accepted.** Speed: nothing reaches a customer without Marcus even when
the pipeline is confident, and the reviewer is a single person. Rule 5 is the product.

---

## 7. Dispatch idempotency

**Options considered.** (a) Fire-and-forget from the approval action; dedupe later.
(b) An outbox table polled by a worker. (c) Claim-then-send: insert a deterministic
`proposalId:channel:version` row against a unique index, send only if the claim
succeeded, retry with exponential backoff, record attempts.

**Chosen.** (c) — the database unique index is the double-send guard, retries are
per channel, and the GHL CRM interaction is behind a swappable client
(`GhlHttpClient` / `GhlMockClient`, `GHL_MODE`, default mock) because no sandbox key
was provided — stated plainly in the module header.

**Trade-off accepted.** Retry with backoff is at-least-once: a provider that accepted
our email but timed out on the response will be retried, so provider-side effects
assume their own idempotency. And the claim-then-send lives in the Next.js process
(see 8) rather than a dedicated worker. Accepted because a unique index is the only
guard that survives a double-click, and provider idempotency keys can be added
without changing the row shape.

---

## 8. Execution model

**Options considered.** (a) Run the whole pipeline inside the HTTP request.
(b) A separate queue worker (Trigger.dev, QStash, BullMQ). (c) Next.js `after()` with
progress written to `proposals.step_status` and a polling endpoint.

**Chosen.** (c) — the ingest action returns immediately, the pipeline runs via
`after()`, the UI polls `/api/pipeline-status/[siteWalkId]`, and a 120 s
`AbortController` plus a $0.75 pre-call budget check bound the run. Step failures are
recorded and the run advances to a reviewable state instead of vanishing.

**Trade-off accepted.** `after()` ties the run to the Next.js server lifecycle — a
crash or deploy mid-pipeline kills in-flight work, recovery is manual, and step
checkpointing is status-only, not resumable. Accepted for a single-office, single-town
deploy because it removes an entire queue infrastructure from the take-home scope;
"what breaks first at scale" in the README names this as the first thing to replace.

---

## Cross-cutting invariants

Whatever the decisions above, these hold everywhere:

- The LLM never computes a number that reaches a customer or the database
  (`agent_runs` costs are computed from real token counts in TypeScript).
- Every LLM call writes an `agent_runs` row: model, tokens, cost, latency, status.
- Every LLM output is zod-validated before it touches anything.
- Money is integer cents via `src/lib/pricing/money.ts`; nothing else rounds currency.
- `server-only` guards the service-role client; RLS is deny-all as a second wall.
