import { getSupabaseAdmin } from '@/lib/db/client';
import type { Json } from '@/lib/db/types';

import { idempotencyKey, type DispatchChannel } from './types';

export interface OutboundClaim {
  /** Row id when this run owns the send; null when another run already did. */
  id: string | null;
  alreadySent: boolean;
}

/**
 * Claims the send by inserting the deterministic outbound_events row. The
 * unique index on idempotency_key makes this race-safe: a double-clicked
 * approval produces a 23505 here and the channel skips itself.
 */
export async function claimOutboundEvent(
  proposalId: string,
  channel: DispatchChannel,
  version: number,
  payload: Record<string, unknown>,
): Promise<OutboundClaim> {
  const { data, error } = await getSupabaseAdmin()
    .from('outbound_events')
    .insert({
      proposal_id: proposalId,
      channel,
      idempotency_key: idempotencyKey(proposalId, channel, version),
      payload: payload as Json,
      status: 'pending',
      attempts: 0,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') return { id: null, alreadySent: true };
    throw new Error(error.message);
  }
  return { id: data?.id ?? null, alreadySent: false };
}

export async function completeOutboundEvent(
  eventId: string,
  patch: {
    status: 'sent' | 'failed';
    attempts: number;
    providerMessageId?: string | null;
    error?: string | null;
  },
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('outbound_events')
    .update({
      status: patch.status,
      attempts: patch.attempts,
      provider_message_id: patch.providerMessageId ?? null,
      error: patch.error ?? null,
    })
    .eq('id', eventId);
  if (error) throw new Error(error.message);
}

/** Upsert-style write used by the GHL mock client, which owns its own row. */
export async function upsertOutboundEvent(
  proposalId: string,
  channel: DispatchChannel,
  version: number,
  row: {
    status: string;
    attempts: number;
    detail: Record<string, unknown>;
    providerMessageId?: string | null;
    error?: string | null;
  },
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('outbound_events')
    .upsert(
      {
        proposal_id: proposalId,
        channel,
        idempotency_key: idempotencyKey(proposalId, channel, version),
        payload: row.detail as Json,
        status: row.status,
        attempts: row.attempts,
        provider_message_id: row.providerMessageId ?? null,
        error: row.error ?? null,
      },
      { onConflict: 'idempotency_key' },
    );
  if (error) throw new Error(error.message);
}
