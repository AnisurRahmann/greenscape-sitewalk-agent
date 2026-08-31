/** Shared dispatch types. The idempotency key is deterministic so a
 *  double-clicked approval cannot double-send: the unique index on
 *  outbound_events.idempotency_key is the real guard. */

export type DispatchChannel = 'email' | 'sms' | 'slack' | 'stripe' | 'ghl';

export function idempotencyKey(
  proposalId: string,
  channel: DispatchChannel,
  version: number,
): string {
  return `${proposalId}:${channel}:${version}`;
}

export interface ChannelOutcome {
  channel: DispatchChannel;
  /** sent = delivered (or accepted by provider); skipped = already sent or not configured; failed = exhausted retries */
  status: 'sent' | 'skipped' | 'failed';
  attempts: number;
  detail?: string;
  providerMessageId?: string;
}

export interface ProposalDispatchContext {
  proposalId: string;
  version: number;
  publicToken: string;
  lead: {
    fullName: string;
    phone: string | null;
    email: string | null;
  };
  projectName: string;
  total: number;
  marginPct: number;
  /** Agent generation cost for this proposal — internal (Slack) only. */
  generationCostUsd: number;
}
