/**
 * Dispatch: on approval, fire email, sms, slack, stripe and ghl. The Stripe
 * payment link runs first (email/sms embed it), then the remaining channels
 * fan out in parallel via Promise.allSettled. Every channel claims a
 * deterministic outbound_events row
 * (`${proposalId}:${channel}:${version}`) — the unique index is what makes a
 * double-clicked approval unable to double-send. Every external call is
 * retried with exponential backoff (3 attempts) and the attempts are recorded
 * on the row.
 */

import { getSupabaseAdmin } from '@/lib/db/client';
import { proposalCost } from '@/lib/agent/cost';
import { selectGhlClient } from '@/lib/integrations/ghl';

import { sendResendEmail } from './email';
import { claimOutboundEvent, completeOutboundEvent, upsertOutboundEvent } from './outbound';
import { ensureProposalPdf } from './proposal-pdf';
import { withRetry, type RetryOptions } from './retry';
import { sendSlackNotify } from './slack';
import { sendTwilioSms } from './sms';
import { createDepositPaymentLink } from './stripe';
import type { ChannelOutcome, DispatchChannel, ProposalDispatchContext } from './types';

const RETRY: RetryOptions = { attempts: 3, baseMs: 500 };

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

async function runChannel(
  channel: DispatchChannel,
  context: ProposalDispatchContext,
  claimPayload: Record<string, unknown>,
  send: () => Promise<string | void>,
): Promise<ChannelOutcome> {
  const claim = await claimOutboundEvent(context.proposalId, channel, context.version, claimPayload);
  if (claim.alreadySent) {
    return { channel, status: 'skipped', attempts: 0, detail: 'idempotency key already present' };
  }
  if (claim.id === null) {
    return { channel, status: 'skipped', attempts: 0, detail: 'claim failed' };
  }

  try {
    const { value, attempts } = await withRetry(send, RETRY);
    const providerMessageId = typeof value === 'string' ? value : undefined;
    await completeOutboundEvent(claim.id, { status: 'sent', attempts, providerMessageId });
    return { channel, status: 'sent', attempts, providerMessageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const attempts = (err as { retryAttempts?: number }).retryAttempts ?? RETRY.attempts ?? 3;
    await completeOutboundEvent(claim.id, { status: 'failed', attempts, error: message });
    return { channel, status: 'failed', attempts, detail: message };
  }
}

export interface DispatchSummary {
  proposalId: string;
  channels: ChannelOutcome[];
  paymentLinkUrl: string | null;
}

export async function dispatchProposal(proposalId: string): Promise<DispatchSummary> {
  const db = getSupabaseAdmin();

  const { data: proposal, error } = await db
    .from('proposals')
    .select(
      'id, version, public_token, total, margin_pct, leads(full_name, phone, email), pdf_path',
    )
    .eq('id', proposalId)
    .single();
  if (error || !proposal) throw new Error(error?.message ?? 'proposal not found');

  const context: ProposalDispatchContext = {
    proposalId: proposal.id,
    version: proposal.version ?? 1,
    publicToken: proposal.public_token,
    lead: {
      fullName: proposal.leads?.full_name ?? 'Valued client',
      phone: proposal.leads?.phone ?? null,
      email: proposal.leads?.email ?? null,
    },
    projectName: 'Your landscape project',
    total: proposal.total ?? 0,
    marginPct: proposal.margin_pct ?? 0,
    generationCostUsd: await proposalCost(proposalId),
  };

  const publicUrl = `${appUrl()}/p/${context.publicToken}`;
  const deposit = context.total / 2;

  // Stripe first: the payment link must exist before email/sms reference it.
  let paymentLinkUrl: string | null = null;
  const stripeOutcome = await runChannel(
    'stripe',
    context,
    { deposit: deposit, purpose: '50% deposit payment link' },
    async () => {
      const link = await createDepositPaymentLink({
        proposalId: context.proposalId,
        leadName: context.lead.fullName,
        total: context.total,
      });
      paymentLinkUrl = link.url;
      return link.url;
    },
  );

  // The remaining channels fire in parallel; each owns its outbound row.
  const outcomes = await Promise.allSettled([
    runChannel(
      'email',
      context,
      { to: context.lead.email, includes_pdf: true, payment_link: paymentLinkUrl },
      async () => {
        if (!context.lead.email) throw new Error('lead has no email address');
        const pdf = await ensureProposalPdf(proposalId);
        return sendResendEmail({
          to: context.lead.email,
          subject: 'Your Greenscape Pro landscape proposal',
          html:
            `<p>Hi ${context.lead.fullName.split(' ')[0]},</p>` +
            `<p>Your landscape proposal is ready: <a href="${publicUrl}">${publicUrl}</a></p>` +
            `<p>The signed PDF is attached. A 50% deposit of about ${usd(deposit)} gets your project on the schedule: <a href="${paymentLinkUrl ?? publicUrl}">pay the deposit here</a>.</p>` +
            '<p>— Greenscape Pro, Phoenix</p>',
          attachmentBase64: pdf.base64,
          attachmentFilename: 'greenscape-proposal.pdf',
        });
      },
    ),
    runChannel(
      'sms',
      context,
      { to: context.lead.phone, payment_link: paymentLinkUrl },
      async () => {
        if (!context.lead.phone) throw new Error('lead has no phone number');
        return sendTwilioSms({
          to: context.lead.phone,
          body: `Greenscape Pro: your landscape proposal is ready — ${publicUrl}. 50% deposit: ${usd(deposit)}. Reply STOP to opt out.`,
        });
      },
    ),
    runChannel(
      'slack',
      context,
      { purpose: 'internal visibility' },
      async () =>
        sendSlackNotify({
          text:
            `:white_check_mark: Proposal approved — *${context.lead.fullName}*\n` +
            `Total: *${usd(context.total)}* · Margin: *${context.marginPct.toFixed(1)}%* · ` +
            `Agent cost: *$${context.generationCostUsd.toFixed(2)}*\n` +
            `Client view: ${publicUrl}`,
        }),
    ),
    (async (): Promise<ChannelOutcome> => {
      const mode = process.env.GHL_MODE ?? 'mock';
      if (mode === 'http') {
        return runChannel('ghl', context, { mode: 'http' }, async () => {
          const client = selectGhlClient({ ...context });
          const { contactId } = await client.upsertContact({
            proposalId: context.proposalId,
            fullName: context.lead.fullName,
            phone: context.lead.phone,
            email: context.lead.email,
            address: null,
            city: null,
          });
          const { opportunityId } = await client.createOpportunity({
            proposalId: context.proposalId,
            contactId,
            leadName: context.lead.fullName,
            monetaryValue: context.total,
          });
          await client.attachDocument({
            proposalId: context.proposalId,
            contactId,
            name: 'Landscape proposal',
            documentUrl: publicUrl,
          });
          await client.updateStage({ proposalId: context.proposalId, opportunityId, stage: 'proposal_sent' });
          return 'ghl-http-complete';
        });
      }
      // Mock mode: the mock client owns its single outbound_events row.
      const claim = await claimOutboundEvent(context.proposalId, 'ghl', context.version, { mode: 'mock' });
      if (claim.alreadySent) {
        return { channel: 'ghl', status: 'skipped', attempts: 0, detail: 'idempotency key already present' };
      }
      try {
        await withRetry(async () => {
          const client = selectGhlClient({
            proposalId: context.proposalId,
            version: context.version,
            slackNotify: async (text) => {
            await sendSlackNotify({ text }).catch(() => {});
          },
          });
          const { contactId } = await client.upsertContact({
            proposalId: context.proposalId,
            fullName: context.lead.fullName,
            phone: context.lead.phone,
            email: context.lead.email,
            address: null,
            city: null,
          });
          const { opportunityId } = await client.createOpportunity({
            proposalId: context.proposalId,
            contactId,
            leadName: context.lead.fullName,
            monetaryValue: context.total,
          });
          await client.attachDocument({
            proposalId: context.proposalId,
            contactId,
            name: 'Landscape proposal',
            documentUrl: publicUrl,
          });
          await client.updateStage({ proposalId: context.proposalId, opportunityId, stage: 'proposal_sent' });
        }, RETRY);
        return { channel: 'ghl', status: 'sent', attempts: 1 };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await upsertOutboundEvent(context.proposalId, 'ghl', context.version, {
          status: 'failed',
          attempts: RETRY.attempts ?? 3,
          detail: { mock: true, error: message },
        });
        return { channel: 'ghl', status: 'failed', attempts: RETRY.attempts ?? 3, detail: message };
      }
    })(),
  ]);

  const channels: ChannelOutcome[] = outcomes.map((outcome, index) =>
    outcome.status === 'fulfilled'
      ? outcome.value
      : { channel: channelNameForIndex(index), status: 'failed', attempts: 0, detail: String(outcome.reason) },
  );

  return { proposalId, channels, paymentLinkUrl };
}

function channelNameForIndex(index: number): DispatchChannel {
  return (['email', 'sms', 'slack', 'ghl'] as const)[index] ?? 'email';
}

function usd(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
