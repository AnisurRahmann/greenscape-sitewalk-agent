# CLAUDE.md

## What this is
An AI agent that turns a contractor's spoken site-walk notes into a priced, reviewable
proposal. Client: Greenscape Pro, a $4.2M hardscape design-build company in Phoenix.

## Non-negotiable engineering rules
1. **The LLM never does arithmetic.** It maps natural language to catalog SKUs and writes
   prose. All pricing, totals, tax, margin and discounts are computed in TypeScript in
   src/lib/pricing/. If you find yourself asking the model for a number, stop.
2. **Every LLM output is Zod-validated** before it touches the database. Max 2 repair
   retries with the validation error fed back, then hard-fail to human review.
3. **Every scope item carries a verbatim evidence span** from the transcript. We verify by
   string containment against the transcript, not by trusting the model's claim.
4. **Every LLM call writes a row to agent_runs** with model, tokens in/out, cost_usd,
   latency_ms and status. No exceptions. Cost observability is a feature, not logging.
5. **Nothing is sent to a customer without an explicit human approval record.** Enforced at
   the database level, not just in the UI.
6. **Every agentic loop has a hard iteration cap and a wall-clock dead-man switch.**
7. **External calls are idempotent.** outbound_events has a unique idempotency_key.

## Style
- Server Components by default. 'use client' only where there is real interactivity.
- Server Actions for mutations. No API routes unless a webhook needs them.
- No `any`. No non-null assertions without a comment justifying them.
- Small files. One responsibility each.
- Comments explain *why*, never *what*.

## Commit discipline
Conventional commits. One logical change per commit. Never squash phases together.

## Model routing
- Chat provider is a switch, not a hardcode: `LLM_PROVIDER=anthropic` (default) uses
  the Haiku tier for classification and the Sonnet tier for scope extraction and
  proposal narrative; `LLM_PROVIDER=openai` uses gpt-4o-mini / gpt-4o for the same
  tiers. Either way: cheap tier for classification, strong tier for extraction.
- Never Opus-class models. Nothing here needs it and the per-proposal cost target is under $0.15.
