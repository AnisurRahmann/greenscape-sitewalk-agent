import { afterEach, describe, expect, it, vi } from 'vitest';

import { withRetry } from './retry';
import { idempotencyKey } from './types';

const h = vi.hoisted(() => {
  const upserts: Array<Record<string, unknown>> = [];
  return {
    upserts,
    getSupabaseAdmin: () => ({
      from: (table: string) => {
        if (table !== 'outbound_events') throw new Error(`unexpected table: ${table}`);
        return {
          upsert: (row: Record<string, unknown>) => {
            upserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      },
    }),
  };
});

vi.mock('@/lib/db/client', () => ({ getSupabaseAdmin: h.getSupabaseAdmin }));

import { GhlHttpClient, GhlMockClient, selectGhlClient } from '@/lib/integrations/ghl';

describe('withRetry', () => {
  it('succeeds after transient failures and reports attempt count', async () => {
    let calls = 0;
    const outcome = await withRetry(
      () => {
        calls += 1;
        if (calls < 3) throw new Error('transient');
        return Promise.resolve('sent');
      },
      { attempts: 3, baseMs: 1 },
    );
    expect(outcome.value).toBe('sent');
    expect(outcome.attempts).toBe(3);
  });

  it('throws after the third failure and records the attempt count', async () => {
    const err = await withRetry(
      () => Promise.reject(new Error('provider down')),
      { attempts: 3, baseMs: 1 },
    ).catch((e: unknown) => e);
    expect((err as Error).message).toBe('provider down');
    expect((err as { retryAttempts?: number }).retryAttempts).toBe(3);
  });
});

describe('idempotencyKey', () => {
  it('is deterministic per proposal, channel and version', () => {
    expect(idempotencyKey('prop-1', 'email', 2)).toBe('prop-1:email:2');
    expect(idempotencyKey('prop-1', 'email', 2)).toBe(idempotencyKey('prop-1', 'email', 2));
    expect(idempotencyKey('prop-1', 'email', 2)).not.toBe(idempotencyKey('prop-1', 'email', 3));
    expect(idempotencyKey('prop-1', 'sms', 2)).not.toBe(idempotencyKey('prop-1', 'email', 2));
  });
});

describe('slack channel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts to the internal webhook with the given text', async () => {
    const { sendSlackNotify } = await import('./slack');
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    await sendSlackNotify({ text: 'Total: $47,410.94 · Margin: 44.9% · Agent cost: $0.05' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('https://hooks.slack.com/test');
    expect(init.body).toContain('$47,410.94');
    expect(init.body).toContain('44.9%');
    expect(init.body).toContain('$0.05');
  });
});

describe('GHL integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GHL_MODE;
    delete process.env.GHL_API_KEY;
    h.upserts.length = 0;
  });

  it('defaults to the mock client when GHL_MODE is unset', () => {
    expect(selectGhlClient({ proposalId: 'p-1', version: 1 })).toBeInstanceOf(GhlMockClient);
  });

  it('mock client upserts one outbound_events row per interaction', async () => {
    const client = new GhlMockClient({
      proposalId: 'prop-9',
      version: 1,
      slackNotify: async () => {},
    });

    const { contactId } = await client.upsertContact({
      proposalId: 'prop-9',
      fullName: 'Test Lead',
      phone: null,
      email: null,
      address: null,
      city: null,
    });
    const { opportunityId } = await client.createOpportunity({
      proposalId: 'prop-9',
      contactId,
      leadName: 'Test Lead',
      monetaryValue: 23_495.68,
    });
    await client.attachDocument({
      proposalId: 'prop-9',
      contactId,
      name: 'Landscape proposal',
      documentUrl: 'https://example.com/p/token',
    });
    await client.updateStage({ proposalId: 'prop-9', opportunityId, stage: 'proposal_sent' });

    // All four interactions share one deterministic idempotency row.
    expect(h.upserts).toHaveLength(4);
    for (const row of h.upserts) {
      expect(row.channel).toBe('ghl');
      expect(row.idempotency_key).toBe('prop-9:ghl:1');
      expect(row.status).toBe('sent');
    }
    const last = h.upserts[3] as { payload: { interaction: Array<{ method: string }> } };
    expect(last.payload.interaction.at(-1)?.method).toBe('updateStage');
  });

  it('http client posts to the documented GHL v2 upsert endpoint with the Version header', async () => {
    process.env.GHL_MODE = 'http';
    process.env.GHL_API_KEY = 'test-key';
    const fetchMock = vi.fn(async () =>
      Response.json({ contact: { id: 'contact-1' } }, { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new GhlHttpClient();
    const { contactId } = await client.upsertContact({
      proposalId: 'p-1',
      fullName: 'Test Lead',
      phone: '(480) 555-0134',
      email: 'lead@example.com',
      address: '123 Main St',
      city: 'Phoenix',
    });

    expect(contactId).toBe('contact-1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://services.leadconnectorhq.com/contacts/upsert');
    expect(init.headers.Version).toBe('2021-07-28');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(JSON.parse(init.body).firstName).toBe('Test');
  });
});
