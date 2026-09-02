/**
 * Human touch rate over a date range: how much of the machine's draft did a
 * human correct? Reads the corrections table (labelled review signal) and
 * prints a markdown table to stdout.
 *
 * Usage:
 *   npx tsx scripts/human-touch-rate.ts [--from=2026-08-01] [--to=2026-09-30]
 *
 * Defaults: the last 30 days. Env: same Supabase service-role vars the app
 * uses (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
 */
import { getSupabaseAdmin } from '../src/lib/db/client';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split('=').slice(1).join('=');
}

const to = arg('to') ?? new Date().toISOString().slice(0, 10);
const from =
  arg('from') ??
  new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

const fromIso = `${from}T00:00:00Z`;
const toIso = `${to}T23:59:59Z`;

async function main(): Promise<void> {
  const db = getSupabaseAdmin();

  // Review activity in the range: proposal-level audit rows (approve/reject/
  // pdf) plus every correction, each of which knows its proposal.
  const { data: audit, error: auditError } = await db
    .from('audit_log')
    .select('entity_type, entity_id, created_at')
    .gte('created_at', fromIso)
    .lte('created_at', toIso);
  if (auditError) throw new Error(auditError.message);

  const { data: corrections, error: correctionsError } = await db
    .from('corrections')
    .select('proposal_id, line_item_id, correction_type, created_at')
    .gte('created_at', fromIso)
    .lte('created_at', toIso);
  if (correctionsError) throw new Error(correctionsError.message);

  const auditProposalIds = (audit ?? [])
    .filter((row) => row.entity_type === 'proposal' && row.entity_id)
    .map((row) => row.entity_id as string);
  const proposalIds = [
    ...new Set([...auditProposalIds, ...(corrections ?? []).map((c) => c.proposal_id)]),
  ];

  const { data: lines, error: linesError } = await db
    .from('proposal_line_items')
    .select('id, proposal_id, excluded')
    .in('proposal_id', proposalIds);
  if (linesError) throw new Error(linesError.message);

  const reviewedProposalIds = new Set(proposalIds);
  const totalLineItems = (lines ?? []).filter((l) => reviewedProposalIds.has(l.proposal_id));

  const correctedLineIds = new Set(
    (corrections ?? [])
      .filter((c) => c.line_item_id !== null)
      .map((c) => c.line_item_id as string),
  );

  const byType = new Map<string, number>();
  for (const c of corrections ?? []) {
    byType.set(c.correction_type, (byType.get(c.correction_type) ?? 0) + 1);
  }

  const total = totalLineItems.length;
  const corrected = correctedLineIds.size;
  const rate = total > 0 ? (corrected / total) * 100 : 0;

  console.log(`# Human touch rate — ${from} → ${to}`);
  console.log();
  console.log('| Metric | Value |');
  console.log('| --- | --- |');
  console.log(`| Proposals reviewed | ${proposalIds.length} |`);
  console.log(`| Total line items | ${total} |`);
  console.log(`| Items corrected | ${corrected} |`);
  console.log(`| Human touch rate | ${rate.toFixed(1)}% |`);
  console.log();
  console.log('## Corrections by type');
  console.log();
  console.log('| Correction type | Count |');
  console.log('| --- | --- |');
  if (byType.size === 0) console.log('| — | 0 |');
  for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`| ${type} | ${count} |`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
