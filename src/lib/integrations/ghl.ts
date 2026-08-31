/**
 * GHL (GoHighLevel) integration.
 *
 * HONEST DISCLOSURE: no GHL sandbox key or account was provided with the
 * take-home, so the HTTP client below is written to the documented GHL API v2
 * request/response shapes (services.leadconnectorhq.com, Version 2021-07-28
 * header, /contacts/upsert, /opportunities/, /contacts/{id}/documents) but it
 * has been exercised ONLY against GhlMockClient. Treat every endpoint path and
 * payload as unverified until it is run against a real GHL account.
 *
 * Selection: GHL_MODE=http|mock in the environment. Default is mock.
 */

import { getSupabaseAdmin } from '@/lib/db/client';

export interface GhlUpsertContactInput {
  proposalId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
}

export interface GhlCreateOpportunityInput {
  proposalId: string;
  contactId: string;
  leadName: string;
  monetaryValue: number;
}

export interface GhlAttachDocumentInput {
  proposalId: string;
  contactId: string;
  name: string;
  documentUrl: string;
}

export interface GhlUpdateStageInput {
  proposalId: string;
  opportunityId: string;
  stage: string;
}

export interface GhlClient {
  upsertContact(input: GhlUpsertContactInput): Promise<{ contactId: string }>;
  createOpportunity(input: GhlCreateOpportunityInput): Promise<{ opportunityId: string }>;
  attachDocument(input: GhlAttachDocumentInput): Promise<{ documentId: string }>;
  updateStage(input: GhlUpdateStageInput): Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// HTTP client — real GHL API v2 shapes, unverified against a live account.
// ---------------------------------------------------------------------------

export class GhlHttpClient implements GhlClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly pipelineId: string | null;
  private readonly stageId: string | null;

  constructor(config?: { apiKey?: string; baseUrl?: string; pipelineId?: string; stageId?: string }) {
    this.apiKey = config?.apiKey ?? process.env.GHL_API_KEY ?? '';
    this.baseUrl = config?.baseUrl ?? process.env.GHL_API_BASE ?? 'https://services.leadconnectorhq.com';
    this.pipelineId = config?.pipelineId ?? process.env.GHL_PIPELINE_ID ?? null;
    this.stageId = config?.stageId ?? process.env.GHL_STAGE_ID ?? null;
    if (!this.apiKey) throw new Error('GHL_API_KEY not configured');
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      Version: '2021-07-28',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  private async postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`GHL ${path} failed (${response.status}): ${await response.text()}`);
    }
    return (await response.json()) as T;
  }

  async upsertContact(input: GhlUpsertContactInput): Promise<{ contactId: string }> {
    const [firstName, ...rest] = input.fullName.split(' ');
    const json = await this.postJson<{ contact: { id: string } }>('/contacts/upsert', {
      firstName: firstName ?? 'Client',
      lastName: rest.join(' ') || undefined,
      name: input.fullName,
      phone: input.phone ?? undefined,
      email: input.email ?? undefined,
      address1: input.address ?? undefined,
      city: input.city ?? undefined,
    });
    return { contactId: json.contact.id };
  }

  async createOpportunity(input: GhlCreateOpportunityInput): Promise<{ opportunityId: string }> {
    const json = await this.postJson<{ opportunity: { id: string } }>('/opportunities/', {
      name: `Hardscape proposal — ${input.leadName}`,
      contactId: input.contactId,
      pipelineId: this.pipelineId,
      stageId: this.stageId ?? undefined,
      status: 'open',
      monetaryValue: input.monetaryValue,
    });
    return { opportunityId: json.opportunity.id };
  }

  async attachDocument(input: GhlAttachDocumentInput): Promise<{ documentId: string }> {
    const json = await this.postJson<{ id: string }>(
      `/contacts/${input.contactId}/documents`,
      { name: input.name, url: input.documentUrl },
    );
    return { documentId: json.id };
  }

  async updateStage(input: GhlUpdateStageInput): Promise<{ ok: boolean }> {
    const response = await fetch(
      `${this.baseUrl}/opportunities/${input.opportunityId}`,
      {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify({ stageId: input.stage }),
      },
    );
    if (!response.ok) {
      throw new Error(`GHL stage update failed (${response.status}): ${await response.text()}`);
    }
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// Mock client — the exercised implementation. Writes the full interaction to
// outbound_events (channel='ghl', one row per proposal version, upserted so
// the four methods share a single deterministic idempotency_key) and posts a
// summary to Slack when a webhook is configured.
// ---------------------------------------------------------------------------

export interface GhlMockOptions {
  proposalId: string;
  version: number;
  slackNotify?: (text: string) => Promise<void>;
}

export class GhlMockClient implements GhlClient {
  private readonly options: GhlMockOptions;
  private interaction: Array<Record<string, unknown>> = [];

  constructor(options: GhlMockOptions) {
    this.options = options;
  }

  private async record(method: string, detail: Record<string, unknown>): Promise<void> {
    this.interaction.push({ method, ...detail });
    const { error } = await getSupabaseAdmin()
      .from('outbound_events')
      .upsert(
        {
          proposal_id: this.options.proposalId,
          channel: 'ghl',
          idempotency_key: `${this.options.proposalId}:ghl:${this.options.version}`,
          payload: { mock: true, interaction: this.interaction } as unknown as import('@/lib/db/types').Json,
          status: 'sent',
          attempts: 1,
          provider_message_id: `ghl-mock-${method}`,
        },
        { onConflict: 'idempotency_key' },
      );
    if (error) throw new Error(error.message);
  }

  async upsertContact(input: GhlUpsertContactInput): Promise<{ contactId: string }> {
    const contactId = `mock-contact-${input.proposalId.slice(0, 8)}`;
    await this.record('upsertContact', { contactId, fullName: input.fullName });
    return { contactId };
  }

  async createOpportunity(input: GhlCreateOpportunityInput): Promise<{ opportunityId: string }> {
    const opportunityId = `mock-opp-${input.proposalId.slice(0, 8)}`;
    await this.record('createOpportunity', {
      opportunityId,
      contactId: input.contactId,
      monetaryValue: input.monetaryValue,
    });
    return { opportunityId };
  }

  async attachDocument(input: GhlAttachDocumentInput): Promise<{ documentId: string }> {
    const documentId = `mock-doc-${input.proposalId.slice(0, 8)}`;
    await this.record('attachDocument', { documentId, name: input.name, url: input.documentUrl });
    return { documentId };
  }

  async updateStage(input: GhlUpdateStageInput): Promise<{ ok: boolean }> {
    await this.record('updateStage', { opportunityId: input.opportunityId, stage: input.stage });
    if (this.options.slackNotify) {
      await this.options.slackNotify(
        `GHL (mock): opportunity moved to stage "${input.stage}" for proposal ${this.options.proposalId.slice(0, 8)}`,
      );
    }
    return { ok: true };
  }
}

/** GHL_MODE=http|mock — default mock (see the disclosure above). */
export function selectGhlClient(options: GhlMockOptions): GhlClient {
  const mode = process.env.GHL_MODE ?? 'mock';
  return mode === 'http' ? new GhlHttpClient() : new GhlMockClient(options);
}
