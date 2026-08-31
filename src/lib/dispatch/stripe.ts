import { fromCents, toCents } from '@/lib/pricing/money';

export interface StripeDepositLink {
  url: string;
  depositAmount: number;
}

/**
 * Creates a Stripe Payment Link for the 50% deposit. REST (form-encoded)
 * rather than the SDK so this stays dependency-light and testable with a
 * fetch stub. Deposit cents are computed with the shared integer-cents rule.
 */
export async function createDepositPaymentLink(input: {
  proposalId: string;
  leadName: string;
  total: number;
}): Promise<StripeDepositLink> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not configured');

  const depositCents = toCents(input.total / 2);
  const body = new URLSearchParams({
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(depositCents),
    'line_items[0][price_data][product_data][name]': `Proposal deposit — ${input.leadName} (#${input.proposalId.slice(0, 8)})`,
  });

  const response = await fetch('https://api.stripe.com/v1/payment_links', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`stripe payment link failed (${response.status}): ${await response.text()}`);
  }
  const json = (await response.json()) as { url?: string };
  if (!json.url) throw new Error('stripe response missing payment link url');

  return { url: json.url, depositAmount: fromCents(depositCents) };
}

export function depositFor(total: number): number {
  return fromCents(toCents(total) / 2);
}
