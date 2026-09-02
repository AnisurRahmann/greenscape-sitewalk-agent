# REVIEW.md — merged audit (code-reviewer + security-reviewer + claim reconciliation)

Repo: `greenscape-sitewalk-agent` @ `dev` (`d2297b9`). Nothing was fixed in this pass.
Sources: **[CR]** = code-reviewer, **[SR]** = security-reviewer, **[CL]** = claim reconciliation (main agent, docs vs code vs git history).

---

## 1. VERDICT

Submittable after fixes — the build itself is genuinely green (clean `tsc --noEmit`, 83/83 tests pass, production build and the secret-leak gate succeed), every load-bearing architecture claim in the docs traces to real code, and not a single eval number is fabricated. But the stated deployment reality (public URL, no auth) makes two P0 findings live right now: anyone can read every lead's PII and transcript, tamper with proposal prices, approve them, and burn your Anthropic/OpenAI/Twilio/Stripe accounts. Fix the auth + spend-bound pair and the double-discount/approve-trusts-client money bug — roughly a day of work — before anyone clicks the link; as it stands the public URL is the submission's biggest liability, not its demo.

---

## 2. Merged findings (sorted by severity, deduplicated across sources)

| # | Sev | Source | Finding | Evidence |
|---|-----|--------|---------|----------|
| 1 | P0 | SR | **No authentication anywhere.** No middleware, no session, no rate limit. `/proposals` exposes all leads' PII, transcripts, margins, costs; all mutating server actions (`submitSitewalk`, `commitLineEdit`, `approveProposal`, `rejectProposal`, `generateProposalPdf`, `createSignedSitewalkUpload`) are invocable by anyone with the action ID from the public bundle. `src/app/(review)/layout.tsx`, `src/app/(review)/proposals/[id]/actions.tsx:18-151`, absence of `middleware.ts` | SR |
| 2 | P0 | SR | **Unbounded aggregate spend.** `submitSitewalk` is unauthenticated and unthrottled; the $0.75 ceiling is *per proposal*, so repeated submissions drain API credits without limit (50k-char transcripts allowed by schema). `src/app/(app)/new/actions.ts:47-113`, `src/lib/guardrails/rules.ts:325`, `src/lib/ingest/schema.ts:28` | SR |
| 3 | P1 | CR | **Double-discount reaches the customer.** Pipeline persists the *discounted* unit price; the review UI re-runs `priceProposal` on that stored price, applying the volume tier a second time; `approveProposal` persists the double-discounted totals. Reproducible with the repo's own demo seed (TF-PET-70, 900 sqft: $8,424 → $8,091; total 17,277 → ~16,494). `src/lib/pricing/engine.ts:137-155`, `orchestrator.ts:482`, `proposal-review.tsx:56,143-152`, `seed-demo.ts:143-159` | CR |
| 4 | P1 | CR+SR | **Approve trusts the client.** `approveProposal` persists `input.totals.*` verbatim — no server-side re-price, no guardrail re-run. Combined with #1, anyone can approve a proposal at any total, and the "human approval enforced at the DB level" invariant only certifies that *someone* clicked, not what numbers were approved. `src/app/(review)/proposals/[id]/actions.tsx:84-101`, CHECK only covers `approved_by/at` (`0001_init.sql:100`) | CR+SR |
| 5 | P1 | SR | **Unlimited signed upload URLs.** `createSignedSitewalkUpload` mints unthrottled PUT URLs into the private bucket; no `file_size_limit` in code → storage exhaustion, free hosting, and each upload feeds a paid Whisper call. `src/app/(app)/new/actions.ts:27-45`, `supabase/migrations/0003_storage.sql:6-8` | SR |
| 6 | P2 | CR+CL | **Budget check is blind to audio/embedding spend** — and README's "$0.75 checked before every LLM call" overclaims. Whisper + query-embedding `agent_runs` rows carry `proposal_id: null`, so `proposalCost()` (and G8) never see them; embeddings are also never re-checked inside the match step or the extraction repair loop. `src/lib/ingest/transcribe.ts:87`, `orchestrator.ts:309`, `src/lib/agent/cost.ts:27-35` vs README:49 | CR+CL |
| 7 | P2 | CR | **Claim-then-send permanently skips failed channels.** Any 23505 is treated as `alreadySent` without checking row status, so a channel that failed once (e.g. missing `RESEND_API_KEY` on first approve) can never send without manual DB surgery — "retries are per channel" holds only within one run. `src/lib/dispatch/outbound.ts:36-38`, `dispatch/index.ts:35-38` | CR |
| 8 | P2 | CR+CL | **Doc/code drift a grader will see.** (a) README:66 and ARCHITECTURE #8 say the UI polls `/api/pipeline-status/[siteWalkId]`; the endpoint works but **no component ever fetches it**. (b) ARCHITECTURE:36 presents "pergula, 0.5 similarity" as observed golden-case evidence while the eval has never run (see C-4 below). (c) Root `/` is the untouched create-next-app template with no nav to `/new` or `/proposals`. | CR+CL |
| 9 | P2 | CR | **Classify fail-open is broken.** Module documents fail-open when Haiku is unavailable, but `new Anthropic()` runs outside the try/catch, so a missing `ANTHROPIC_API_KEY` kills the run at classify instead of using the fallback — exactly the cold-environment case written for. `src/lib/agent/classify.ts:76-106 vs :64-70` | CR |
| 10 | P2 | CR | **Silent audit gaps.** Four of five review actions (`verifyLineEvidence`, `approveProposal`, `rejectProposal`, `generateProposalPdf`) ignore the `audit_log` insert error and still return `{ok: true}` — weakening the "every edit writes audit_log" invariant that `commitLineEdit` upholds. `actions.tsx:61-67,104-110,143-149,180-186` | CR |
| 11 | P2 | SR | **`/api/health` echoes raw DB error strings** to the public (project refs, constraint names). `src/app/api/health/route.ts:18,26` | SR |
| 12 | P2 | SR | **Prompt-injection surface.** Attacker-controlled transcript interpolated into classify/extract prompts with no untrusted-data framing; impact limited by tool-forcing + containment checks + guardrails — but with #1 the "human in the loop" is also anyone. `classify.ts:123`, `extractScope.ts:117-130` | SR |
| 13 | P2 | CR | **The ablation measures a different matcher than production.** `eval-pipeline.ts` accepts any top-1 fused row, hardcodes `matchMethod: 'hybrid'`, and never applies the 0.55 confidence threshold production uses — when the headline eval finally runs, variant C will understate the production system. `scripts/eval-pipeline.ts:226,251` vs `matchCatalog.ts:25,72` | CR |
| 14 | P2 | CR | **Dead UI + unguarded parse.** `proposal_line_items` has no `sku` column so the SKU chip is dead UI (`page.tsx:77` hardcodes null); `/p/[token]` calls `JSON.parse(proposal.narrative)` unguarded in a server component (500s the customer page on a partial write). `line-items-table.tsx:59`, `p/[token]/page.tsx:64` | CR |
| 15 | P2 | CL | **STRATEGY.md does not exist** — never existed in git history. Strategy content lives in README ("four decisions"), ARCHITECTURE.md ("eight decisions") and CLAUDE.md (rules 1–7). If you intended a standalone strategy doc, it was never written. | CL |

**Explicitly clean** (both auditors + claims): secrets hygiene (no secrets tracked, full-history grep clean, `.env*` gitignored, bundle scanner passes); Supabase posture (RLS enabled + zero policies = deny-all, private buckets, `server-only` client, `gen_random_uuid()` tokens); no SQLi/SSRF/exec paths (all queries via query builder / parameterized RPC); deps have no clearly known vulns; `tsc --noEmit` clean; 83/83 vitest tests pass; `next build` succeeds; CHANGELOG test-count claims reconcile exactly (27 guardrail + 19 pricing + 5+7 = 58 at v0.8.0 → 83 today).

---

## 3. Claim reconciliation (docs vs code vs git history)

| Claim | Where claimed | Does the code support it? | Evidence (file:line) |
|---|---|---|---|
| Staged pipeline transcribe→extract→match→price→guardrails→narrative | README:16-17 | **YES** | `orchestrator.ts:37-46,88-524`; full chain traced by CR |
| "$4.2M company", "$2.5M/yr", "6 to 9 days" | README:4,11-12 | **N/A — narrative** | Client-brief scenario numbers; nothing could verify them; don't defend them as data on the call |
| Ablation table (accuracy, false-flag, cost, latency) | README:25-32, evals/RESULTS.md | **YES — honestly empty.** The single worst thing you feared (a fabricated eval number) does not exist: the table is empty, marked "Not yet run", and git history shows the file *never* contained numbers (only commit `58ee79c`, which added just the header) | `evals/RESULTS.md:3-11`; `git log -p -- evals/RESULTS.md` |
| "Regenerated by `npm run eval:pipeline`" | README:22, RESULTS.md:3 | **YES** — runner is real, writes that exact file, has a keyless `--list` mode | `package.json:14`, `scripts/eval-pipeline.ts:470,383-389` |
| Golden set of 10 labelled cases | README:23 | **YES** | `evals/golden/01..10/{transcript.md,labels.json}` exist |
| Cost table ($0.060 whisper, ~$0.001 Haiku, $0.07–0.13 total, 25–60 s) | README:39-47 | **YES as labeled** — rates match code constants, arithmetic sums correctly, and it is explicitly a *design budget* ("the ablation measures the real numbers") | `pricing-table.ts:13-14`, `transcribe.ts:9`, `embedQuery.ts:8`; README:36-37 |
| "$0.75 cost ceiling (checked before **every** LLM call)" | README:49 | **PARTLY** — ceiling real, but not checked before match-step embeddings or between repair retries, and whisper/embedding spend is invisible to the check entirely (finding #6) | `rules.ts:325`, `orchestrator.ts:164,248,273,295,428` (absent `:306-346`) |
| "120 s wall-clock dead-man switch" | README:50 | **YES** | `orchestrator.ts:35,89-90`; `maxDuration = 120` on 3 routes (`new/page.tsx:11`, `[id]/page.tsx:13`, `pipeline-status/route.ts:7`) |
| "No hosted demo ships with this take-home" | README:54 | **NO — stale vs stated reality.** You told us it *is* deployed publicly. If deployed, this claim is false and findings #1/#2 are live | README:54 |
| "watch `/api/pipeline-status/[siteWalkId]` stream the stages" | README:64-67 | **PARTLY** — endpoint real and works if you open it manually; no UI code polls it | `pipeline-status/route.ts:10`; CR grep: zero client fetchers |
| Mermaid architecture diagram | README:71-90 | **YES structurally** — matches the traced call chain; drifts: omits the narrative step, and "stream the stages" implies UI behavior that doesn't exist | CR traced chain (14 steps) vs diagram |
| "The LLM never does arithmetic… engine owns every number" | README:94-96, ARCH:15-16 | **YES for the pipeline; NO on the approve path** — the engine owns pipeline numbers, but approve persists client-sent totals (finding #4) and the review re-price double-discounts (finding #3) | `money.ts:9-14` ✓ vs `actions.tsx:94-99` ✗ |
| Hybrid retrieval, RRF k=60 fused in Postgres, pinned 0.3 trigram threshold | README:97-100, ARCH:31-36 | **YES** | `0002_search_fns.sql:120,124,95-97`; `matchCatalog.ts:94` |
| "the golden cases show the failure modes are complementary… ('pergula', 0.5 similarity…)" | ARCH:33-36 | **NO — reads as measured, is not.** The eval has never run, so no golden case has ever demonstrated anything. The 0.5 figure is at best a hand-computed `pg_trgm` value presented as an observation. This is the closest thing to a fabricated number in the repo — reword it | `evals/RESULTS.md:3` ("Not yet run") vs ARCH:35-36 |
| Tool-forced extraction, `z.toJSONSchema`, max 2 repairs, typed failure | ARCH:50-55 | **YES** | `extractScope.ts:137,115,140,259-349` |
| Evidence verified by containment, `evidence_verified` per line, attestation path | ARCH:69-74 | **YES** | `extractScope.ts:164-178`, `orchestrator.ts:488`, `actions.tsx:49` |
| Pure guardrail rules shared by server and review UI | ARCH:90-93 | **YES** | `proposal-review.tsx:17-21` imports `evaluateRules` + `priceProposal`; G1–G9 all present in `rules.ts:91-363` |
| DB-level approval gate (CHECK + trigger), audit_log before/after | ARCH:109-113 | **YES with caveats** — CHECK/trigger real; 4 of 5 audit writes ignore errors (finding #10); the approve gate lives in the client | `0001_init.sql:100,188`; `actions.tsx:42-45` ✓ vs `:61-67` ✗ |
| Claim-then-send idempotency, retries per channel, GHL mock default disclosed | ARCH:126-131 | **YES with caveat** — failed channels can never retry (finding #7); GHL disclosure is plain and honest | `outbound.ts:17-90`, `ghl.ts:8-11,214-217` |
| `after()` execution, step_status, 120 s AbortController | ARCH:148-151 | **YES** (resumability honestly disclaimed) | `new/actions.ts:105`, `orchestrator.ts:35,106` |
| Every LLM call writes `agent_runs` with real-token costs | ARCH:165-167, CLAUDE.md rule 4 | **YES** — all five LLM modules record, including failures; costs from real token counts, unknown models → null not fake 0 | `pricing-table.ts:23-33`; grep: recordAgentRun in classify/embedQuery/transcribe/draftNarrative/extractScope |
| "RLS deny-all as a second wall" + `server-only` client | ARCH:170-171 | **YES** | `0001_init.sql:211-220` (enable, zero policies), `db/client.ts:1` |
| 210-item catalog; migrations 0001–0007; ports 6432x | README:113-116 | **YES — the 210 is *enforced* by the seed script** | `catalog-data.ts:444,452-453` (throws if ≠210); 7 migration files; `config.toml:12,36,98` |
| "58 total tests" (v0.8.0), 27 guardrail, 19 pricing, 40 retrieval pairs | CHANGELOG:42,48,54,69 | **YES — all reconcile exactly** (83 today = 58 + 25 later) | counted: `it/test` per file; `eval-retrieval.ts` = 40 pairs + 1 type field |
| STRATEGY.md | (you asked for it) | **DOES NOT EXIST** | never in `git log --all`; only variable-name grep hits |

---

## 4. Deduplicated fix plan (ordered; do not start without deciding scope)

| Step | Fix | Resolves | Est. | Running |
|---|---|---|---|---|
| 1 | **Auth gate**: middleware + single shared-password session cookie in front of `/new`, `(review)/*` and all mutating server actions; keep `/p/[token]` and `/api/health` public | #1, most of #12's impact | 2.5 h | 2.5 h |
| 2 | **Spend + storage bounds**: per-IP rate limit + global daily run cap on `submitSitewalk` (before `after()` enqueues); throttle upload-URL minting; set bucket `file_size_limit` | #2, #5 | 2 h | 4.5 h |
| 3 | **Server-authoritative approve**: reload line items, re-run `priceProposal` + `evaluateRules` server-side, reject on blocks, ignore `input.totals` | #4 | 1 h | 5.5 h |
| 4 | **Fix double-discount**: persist the *list* `unit_price` (or an explicit tier-applied flag) so the engine is idempotent across review re-pricing | #3 | 1 h | 6.5 h |
| 5 | Thread `proposalId` into transcribe + embed-query `agent_runs` ctx so budget/G8 see real spend | #6 | 0.5 h | 7 h |
| 6 | Claim fix: on 23505, read existing row; only treat `sent` as already-sent, else adopt the row and retry | #7 | 0.75 h | 7.75 h |
| 7 | Move Anthropic client construction inside classify's try (or typed env check à la extractScope) | #9 | 0.25 h | 8 h |
| 8 | Check `audit_log` insert errors in the four actions (one shared helper) | #10 | 0.33 h | 8.3 h |
| 9 | `/api/health`: log the DB error, return a generic message | #11 | 0.17 h | 8.5 h |
| 10 | Tiny polling hook on the post-submit screen for `pipeline-status` (or reword README/ARCH — but the hook *is* the demo pitch) | #8a | 0.75 h | 9.25 h |
| 11 | Replace stock `/` template with a launcher to `/new` and `/proposals` | #8c | 0.5 h | 9.75 h |
| 12 | Doc rewording: ARCH:35-36 "pergula 0.5" → "hand-checked pg_trgm value, not measured"; align README:54 with actual deployment posture; decide STRATEGY.md (write it or don't — see #15) | #8b, #15 | 0.5 h | 10.25 h |
| 13 | Guard `JSON.parse` on `/p/[token]` | #14b | 0.17 h | 10.4 h |
| 14 | Eval fidelity: make variant C go through production `matchCatalog` (0.55 threshold) or document the delta in the runner header; then actually run the eval if keys + DB exist (~$1–2 of API spend) | #13 + the empty table | 1 h | 11.4 h |
| 15 | Prompt framing: delimit the transcript as untrusted data in classify/extract prompts | #12 | 0.33 h | 11.75 h |
| 16 | *(optional polish)* add `sku` column to `proposal_line_items` so the chip isn't dead UI | #14a | 0.5 h | 12.25 h |

Steps 1–4 are the submission gate; 5–12 are what a grader poking at error paths will find; 13–16 are polish. Total ≈ **12 h**, ≈ **7 h** if you stop after step 10.

---

## 5. DO NOT FIX (and the sentence to say on the call)

1. **The empty ablation table.** "The empty table is the point — measurement rigour means I never ship a number my harness didn't produce. The golden set, the metric definitions and the runner are all in the repo and take one command plus two API keys to reproduce."
2. **The `after()` execution model (no queue).** "For one office in one town, a queue is infrastructure without a customer; `step_status` makes every failure visible, and 'move the orchestrator to a real queue' is the first line of my what-breaks-at-scale section — I'd rather show I know exactly where it breaks than bolt BullMQ on in hour 23."
3. **The unverified GHL HTTP client (mock default).** "No sandbox key was provided, so the real client is written to the documented API v2 shape and shipped behind `GHL_MODE` with mock as the default — the module header says it's unverified in the first ten lines, because a CRM integration that silently pretends to work is worse than one that admits it hasn't seen a live account."
4. **The static G6 P90 quantity table.** "There is no proposal history on day one, so a static percentile table that's visible and flagged as replaceable is more honest than inventing history — it's the third thing I'd swap for measured data with a week."
5. **RLS deny-all + service-role-only data access.** "The server is the only actor by design in a single-office tool, so RLS is the second wall behind `server-only`, not a multi-tenant boundary — and deny-all means a leaked anon key reads nothing."

---

## 6. The three sharpest questions this codebase invites

1. **"Your README says the $0.75 ceiling is checked before every LLM call — but Whisper and embedding costs are written to `agent_runs` with a null proposal, so your own accounting can't see them; and on a public deployment with no auth, the ceiling is per-proposal anyway. So what, precisely, bounds your spend?"** (Finds #6 + #2 together: the invariant is overclaimed *and* the real bound doesn't exist.)
2. **"You lead with 'the LLM never does arithmetic and a deterministic engine owns every number' — yet `approveProposal` persists whatever totals the browser sends, and the review screen re-prices an already-discounted unit price. Walk me through what guarantees the number in the customer's PDF equals the engine's number."** (Finds #3 + #4: the headline invariant is bypassed on exactly the path that produces the customer-facing artifact.)
3. **"The false-flag rate is your headline metric, the table has never been run, and when it does run, variant C doesn't use the production matcher — no confidence threshold, hardcoded match method. Why should I believe any number that eventually lands in that table?"** (Finds the empty RESULTS.md + #13: the differentiator you're claiming — measurement rigour — is currently measured by a harness that differs from the thing it measures.)
