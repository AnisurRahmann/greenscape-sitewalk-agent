import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { recordAgentRun, type AgentRunContext } from '@/lib/agent-runs';

import { costOf } from './cost';
import { tierModel } from './pricing-table';
import { selectChatClient } from '@/lib/llm/chat-provider';
import { openaiChatClient } from '@/lib/llm/openai-chat';

/**
 * The cheap gate: a Haiku-tier pass that decides whether a transcript is a
 * site walk at all before any Sonnet spend. Costs fractions of a cent.
 */

export const classificationSchema = z.object({
  is_sitewalk: z.boolean(),
  project_type: z.string().min(1),
  size_band: z.enum(['small', 'mid', 'large']),
});

export type Classification = z.infer<typeof classificationSchema>;

export interface ClassificationClient {
  messages: {
    create(
      args: {
        model: string;
        max_tokens: number;
        system: string;
        messages: Array<{ role: 'user'; content: string }>;
        tools: Array<{
          name: string;
          description: string;
          input_schema: Anthropic.Tool.InputSchema;
        }>;
        tool_choice: { type: 'tool'; name: string };
      },
      options?: { signal?: AbortSignal },
    ): Promise<{
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: unknown }
      >;
      usage: { input_tokens: number; output_tokens: number };
      /** The model that actually answered — set by provider adapters. */
      model?: string;
    }>;
  };
}

export interface ClassifyOptions {
  client?: ClassificationClient;
  recordRun?: typeof recordAgentRun;
  proposalId?: string | null;
  signal?: AbortSignal;
}

const TOOL_NAME = 'submit_classification';

const SYSTEM_PROMPT =
  'You classify voice-memo transcripts for a hardscape contractor. ' +
  'is_sitewalk is true only when the speaker is walking a property and describing outdoor construction work ' +
  '(patios, turf, pools, kitchens, walls, drainage and similar). Lunch orders, scheduling chats and spam are not site walks. ' +
  'project_type is a short label like "patio and turf", "pool surround", "not a site walk". ' +
  'size_band reflects the apparent scale: small, mid, or large.';

// Fail-open: the gate exists to save tokens, not to reject work. If Haiku is
// unavailable or unparseable, we continue rather than kill a real site walk.
export const FALLBACK_CLASSIFICATION: Classification = {
  is_sitewalk: true,
  project_type: 'unknown',
  size_band: 'mid',
};

/** The Anthropic adapter (Haiku tier). */
function anthropicClient(): ClassificationClient {
  const anthropic = new Anthropic();
  return {
    messages: {
      create: async (args, options) => {
        const response = await anthropic.messages.create(args, {
          signal: options?.signal,
        });
        const content: Array<
          { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }
        > = [];
        for (const block of response.content) {
          if (block.type === 'text') {
            content.push({ type: 'text', text: block.text });
          } else if (block.type === 'tool_use') {
            content.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
          }
        }
        return {
          content,
          usage: {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
          },
          model: response.model,
        };
      },
    },
  };
}

function defaultClient(): ClassificationClient {
  // Provider switch (LLM_PROVIDER): the configured provider owns every
  // request — failures fail loudly rather than crossing providers.
  return selectChatClient({
    anthropic: anthropicClient,
    openai: () => openaiChatClient(tierModel('fast')),
  });
}

export async function classifyTranscript(
  transcript: string,
  opts: ClassifyOptions = {},
): Promise<{ classification: Classification }> {
  const client = opts.client ?? defaultClient();
  const recordRun = opts.recordRun ?? recordAgentRun;
  const runCtx: AgentRunContext = {
    step: 'classify',
    proposalId: opts.proposalId ?? null,
  };

  // The audit row must name the model that actually answered (rule 4), which
  // differs from the tier default whenever the provider adapter maps it.
  let attemptedModel = tierModel('fast');
  const startedAt = Date.now();
  try {
    const response = await client.messages.create(
      {
        model: tierModel('fast'),
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `<transcript>\n${transcript.slice(0, 12_000)}\n</transcript>\n\nClassify this transcript.`,
          },
        ],
        tools: [
          {
            name: TOOL_NAME,
            description: 'Submit the transcript classification.',
            input_schema: z.toJSONSchema(classificationSchema) as unknown as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      },
      { signal: opts.signal },
    );
    attemptedModel = response.model ?? tierModel('fast');

    const toolUse = response.content.find(
      (block): block is { type: 'tool_use'; id: string; name: string; input: unknown } =>
        block.type === 'tool_use' && block.name === TOOL_NAME,
    );
    if (!toolUse) {
      throw new Error('model did not submit the classification tool');
    }
    const parsed = classificationSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '));
    }

    await recordRun(runCtx, {
      model: attemptedModel,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
      costUsd: costOf(attemptedModel, response.usage.input_tokens, response.usage.output_tokens),
      latencyMs: Date.now() - startedAt,
      status: 'ok',
    });

    return { classification: parsed.data };
  } catch (err) {
    await recordRun(runCtx, {
      model: attemptedModel,
      tokensIn: null,
      tokensOut: null,
      costUsd: 0,
      latencyMs: Date.now() - startedAt,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
    return { classification: FALLBACK_CLASSIFICATION };
  }
}
