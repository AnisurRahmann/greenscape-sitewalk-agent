import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { getSupabaseAdmin } from '@/lib/db/client';
import { depositForTotal } from '@/lib/pdf/proposal';

export const metadata: Metadata = { title: 'Your proposal — Greenscape Pro' };

export const dynamic = 'force-dynamic';

const storedNarrativeSchema = z.object({
  scope_overview: z.string(),
  whats_included: z.array(z.string()),
  exclusions: z.array(z.string()),
  timeline_sentence: z.string(),
});

const usd = (value: number): string =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/**
 * Client-facing proposal view, addressed by the proposal's public_token —
 * a capability URL Marcus shares after approving. No auth: the token is the
 * secret. Drafts and rejected proposals are never served.
 */
export default async function PublicProposalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const db = getSupabaseAdmin();

  const { data: proposal } = await db
    .from('proposals')
    .select(
      'id, status, created_at, subtotal, mobilization_fee, contingency, tax, total, narrative, exclusions, pdf_path, leads(full_name, phone, email, address, city)',
    )
    .eq('public_token', token)
    .single();

  if (!proposal || !['approved', 'sent'].includes(proposal.status)) {
    notFound();
  }

  const { data: lines } = await db
    .from('proposal_line_items')
    .select('description, qty, unit, unit_price, line_total, needs_review')
    .eq('proposal_id', proposal.id)
    .order('sort_order');

  const pricedLines = (lines ?? []).filter((line) => !line.needs_review || line.line_total > 0);
  const addOns = (lines ?? [])
    .filter((line) => line.needs_review && line.line_total === 0)
    .map((line) => ({
      description: line.description.replace(/\s*\(optional add-on\)\s*/i, ' ').trim(),
      quantity: line.qty,
      unit: line.unit,
    }));

  const narrative = storedNarrativeSchema.safeParse(
    proposal.narrative ? JSON.parse(proposal.narrative) : null,
  );

  const deposit = depositForTotal(proposal.total ?? 0);
  // Stripe checkout wiring comes with the payments phase; the button links to
  // a payment link when the environment provides one.
  const payHref = process.env.NEXT_PUBLIC_STRIPE_DEPOSIT_LINK ?? '#';

  let pdfUrl: string | null = null;
  if (proposal.pdf_path) {
    const { data: signed } = await db.storage
      .from('proposals')
      .createSignedUrl(proposal.pdf_path, 3600);
    pdfUrl = signed?.signedUrl ?? null;
  }

  const narrativeData = narrative.success ? narrative.data : null;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <header className="rounded-2xl bg-[#1e4d3b] p-6 text-white">
        <p className="text-lg font-bold tracking-[0.2em]">GREENSCAPE PRO</p>
        <p className="mt-1 text-xs text-[#cfe3d8]">HARDSCAPE DESIGN-BUILD · PHOENIX, AZ</p>
        <h1 className="mt-4 text-2xl font-semibold">Your landscape proposal</h1>
        <p className="mt-1 text-sm text-[#cfe3d8]">
          Prepared for {proposal.leads?.full_name}
          {proposal.leads?.address ? ` · ${proposal.leads.address}` : ''}
        </p>
      </header>

      {narrativeData && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#1e4d3b]">
            Scope of work
          </h2>
          <p className="mt-2 text-sm leading-relaxed">{narrativeData.scope_overview}</p>
          {narrativeData.whats_included.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              {narrativeData.whats_included.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          )}
          {narrativeData.timeline_sentence && (
            <p className="mt-3 text-sm font-medium">{narrativeData.timeline_sentence}</p>
          )}
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#1e4d3b]">Investment</h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-muted-foreground">
              <th className="py-2">Item</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit price</th>
              <th className="py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {pricedLines.map((line, index) => (
              <tr key={index} className="border-b last:border-0">
                <td className="py-2 pr-2">{line.description}</td>
                <td className="py-2 text-right tabular-nums">{line.qty}</td>
                <td className="py-2 text-right tabular-nums">{usd(line.unit_price)}</td>
                <td className="py-2 text-right font-medium tabular-nums">{usd(line.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-4 ml-auto max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="tabular-nums">{usd(proposal.subtotal ?? 0)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Contingency (5%)</dt>
            <dd className="tabular-nums">{usd(proposal.contingency ?? 0)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Sales tax (materials)</dt>
            <dd className="tabular-nums">{usd(proposal.tax ?? 0)}</dd>
          </div>
          <div className="flex justify-between border-t pt-1.5 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{usd(proposal.total ?? 0)}</dd>
          </div>
        </dl>
      </section>

      {addOns.length > 0 && (
        <section className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-800">Optional add-ons</h2>
          <p className="mt-1 text-xs text-amber-700">
            Not included in the total — priced separately on request.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {addOns.map((addOn, index) => (
              <li key={index}>
                {addOn.description} ({addOn.quantity} {addOn.unit})
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6 rounded-2xl bg-[#1e4d3b] p-6 text-white">
        <p className="text-sm text-[#cfe3d8]">50% deposit begins your project</p>
        <p className="mt-1 text-3xl font-bold tabular-nums">{usd(deposit)}</p>
        <a
          href={payHref}
          className="mt-4 inline-block rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-[#1e4d3b] hover:bg-[#e6efe9]"
        >
          Pay deposit
        </a>
        {pdfUrl && (
          <Link
            href={pdfUrl}
            target="_blank"
            className="ml-3 inline-block rounded-xl border border-[#cfe3d8] px-5 py-2.5 text-sm font-medium text-[#cfe3d8] hover:bg-white/10"
          >
            Download PDF
          </Link>
        )}
      </section>

      {narrativeData && narrativeData.exclusions.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#1e4d3b]">Exclusions</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {narrativeData.exclusions.map((exclusion, index) => (
              <li key={index}>{exclusion}</li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-8 border-t pt-4 text-xs text-muted-foreground">
        Proposal valid for 30 days · 50% deposit due at signing, balance at completion · 2-year
        hardscape workmanship warranty · Licensed, bonded &amp; insured in Arizona.
      </footer>
    </main>
  );
}
