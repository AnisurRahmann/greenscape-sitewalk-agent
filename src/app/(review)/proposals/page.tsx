import type { Metadata } from 'next';
import Link from 'next/link';

import { AutoRefresh } from '@/components/review/auto-refresh';
import { getSupabaseAdmin } from '@/lib/db/client';
import { generationState } from '@/lib/review/proposal-status';

export const metadata: Metadata = { title: 'Proposals — Greenscape Pro' };

export const dynamic = 'force-dynamic';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  needs_review: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  sent: 'bg-blue-100 text-blue-800',
  rejected: 'bg-red-100 text-red-700',
};

const usd = (value: number | null): string =>
  value == null
    ? '—'
    : value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default async function ProposalsPage() {
  const db = getSupabaseAdmin();

  const { data: proposals } = await db
    .from('proposals')
    .select('id, status, total, margin_pct, created_at, step_status, leads(full_name)')
    .order('created_at', { ascending: false });

  const generation = new Map((proposals ?? []).map((p) => [p.id, generationState(p.step_status)]));
  const anyGenerating = [...generation.values()].some((state) => state.active);

  const ids = (proposals ?? []).map((p) => p.id);
  const { data: failedEvents } = ids.length
    ? await db.from('guardrail_events').select('proposal_id').eq('passed', false).in('proposal_id', ids)
    : { data: [] };
  const { data: costRows } = ids.length
    ? await db.from('agent_runs').select('proposal_id, cost_usd').in('proposal_id', ids)
    : { data: [] };

  const flagCounts = new Map<string, number>();
  for (const event of failedEvents ?? []) {
    flagCounts.set(event.proposal_id, (flagCounts.get(event.proposal_id) ?? 0) + 1);
  }
  const costTotals = new Map<string, number>();
  for (const row of costRows ?? []) {
    if (row.proposal_id === null) continue;
    costTotals.set(row.proposal_id, (costTotals.get(row.proposal_id) ?? 0) + (row.cost_usd ?? 0));
  }

  return (
    <div className="flex flex-col gap-4">
      <AutoRefresh active={anyGenerating} />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Proposals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything the agent has priced, newest first. Nothing sends without you.
        </p>
      </header>

      {(proposals ?? []).length === 0 && (
        <p className="rounded-xl border p-6 text-sm text-muted-foreground">
          No proposals yet — capture a site walk first.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {(proposals ?? []).map((proposal) => (
          <li key={proposal.id}>
            <Link
              href={`/proposals/${proposal.id}`}
              className="block rounded-xl border p-4 transition-colors hover:bg-muted/40"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                {generation.get(proposal.id)?.active ? (
                  <span className="animate-pulse rounded-full bg-blue-600 px-2.5 py-0.5 text-xs font-medium text-white">
                    generating{generation.get(proposal.id)?.step ? ` · ${generation.get(proposal.id)?.step}` : ''}…
                  </span>
                ) : (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      STATUS_STYLES[proposal.status] ?? 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {proposal.status.replace('_', ' ')}
                  </span>
                )}
                <time className="text-xs text-muted-foreground" dateTime={proposal.created_at}>
                  {new Date(proposal.created_at).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </time>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Lead</dt>
                  <dd className="font-medium">{proposal.leads?.full_name ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Total</dt>
                  <dd className="font-medium tabular-nums">{usd(proposal.total)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Margin</dt>
                  <dd className="font-medium tabular-nums">
                    {proposal.margin_pct == null ? '—' : `${proposal.margin_pct.toFixed(1)}%`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Flags / cost</dt>
                  <dd className="font-medium tabular-nums">
                    {flagCounts.get(proposal.id) ?? 0} · $
                    {(costTotals.get(proposal.id) ?? 0).toFixed(2)}
                  </dd>
                </div>
              </dl>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
