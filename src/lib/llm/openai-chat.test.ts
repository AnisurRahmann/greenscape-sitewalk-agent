import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OpenAI } from 'openai';

import {
  openaiChatClient,
  type OpenAiChatArgs,
  type OpenAiChatResponse,
} from './openai-chat';
import { llmProvider, selectChatClient, type ChatClient } from './chat-provider';
import { GPT_MINI_MODEL, GPT_MODEL, HAIKU_MODEL, SONNET_MODEL, tierModel } from '@/lib/agent/pricing-table';

beforeEach(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('llmProvider switch', () => {
  it('defaults to anthropic', () => {
    vi.stubEnv('LLM_PROVIDER', '');
    expect(llmProvider()).toBe('anthropic');
  });

  it('routes to openai when set', () => {
    vi.stubEnv('LLM_PROVIDER', 'openai');
    expect(llmProvider()).toBe('openai');
  });

  it('maps unknown values to the default provider', () => {
    vi.stubEnv('LLM_PROVIDER', 'glm');
    expect(llmProvider()).toBe('anthropic');
  });

  it('tierModel follows the switch', () => {
    vi.stubEnv('LLM_PROVIDER', 'anthropic');
    expect(tierModel('fast')).toBe(HAIKU_MODEL);
    expect(tierModel('standard')).toBe(SONNET_MODEL);

    vi.stubEnv('LLM_PROVIDER', 'openai');
    expect(tierModel('fast')).toBe(GPT_MINI_MODEL);
    expect(tierModel('standard')).toBe(GPT_MODEL);
  });

  it('selectChatClient picks the configured provider', async () => {
    vi.stubEnv('LLM_PROVIDER', 'openai');
    const picked = selectChatClient({
      anthropic: () => stub(async () => ({ who: 'anthropic' })),
      openai: () => stub(async () => ({ who: 'openai' })),
    });
    await expect(picked.messages.create({} as never)).resolves.toEqual({ who: 'openai' });

    vi.stubEnv('LLM_PROVIDER', 'anthropic');
    const pickedAnthropic = selectChatClient({
      anthropic: () => stub(async () => ({ who: 'anthropic' })),
      openai: () => stub(async () => ({ who: 'openai' })),
    });
    await expect(pickedAnthropic.messages.create({} as never)).resolves.toEqual({
      who: 'anthropic',
    });
  });
});

function stub(create: (...args: unknown[]) => unknown): ChatClient<unknown, unknown> {
  return {
    messages: {
      create: create as ChatClient<unknown, unknown>['messages']['create'],
    },
  };
}

const ARGS: OpenAiChatArgs = {
  model: 'claude-sonnet-4-5', // adapters ignore this — provider chooses
  max_tokens: 300,
  system: 'system prompt',
  messages: [{ role: 'user', content: 'hello' }],
  tools: [{ name: 'submit_thing', description: 'submit it', input_schema: { type: 'object' } }],
  tool_choice: { type: 'tool', name: 'submit_thing' },
};

describe('openaiChatClient — wire translation', () => {
  it('maps Anthropic-style blocks onto the OpenAI request and back', async () => {
    const create = vi.fn(async (_body: unknown, _options?: unknown) => ({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'submit_thing', arguments: '{"answer":42}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
      model: 'gpt-4o-2024-11-20',
    }));
    const client = openaiChatClient('gpt-4o', {
      chat: { completions: { create } },
    } as unknown as OpenAI);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 300,
      system: 'system prompt',
      messages: [
        { role: 'user', content: 'first ask' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call_0', name: 'submit_thing', input: { bad: 1 } }] },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call_0', is_error: true, content: 'validation failed' },
          ],
        },
      ],
      tools: [{ name: 'submit_thing', description: 'submit it', input_schema: { type: 'object' } }],
      tool_choice: { type: 'tool', name: 'submit_thing' },
    });

    const sent = create.mock.calls[0]?.[0] as unknown as OpenAI.ChatCompletionCreateParams;
    expect(sent.model).toBe('gpt-4o'); // the passed model is ignored
    expect(sent.messages[0]).toEqual({ role: 'system', content: 'system prompt' });
    expect(sent.messages[1]).toEqual({ role: 'user', content: 'first ask' });
    expect(sent.messages[2]).toMatchObject({
      role: 'assistant',
      tool_calls: [
        { id: 'call_0', type: 'function', function: { name: 'submit_thing', arguments: '{"bad":1}' } },
      ],
    });
    expect(sent.messages[3]).toEqual({
      role: 'tool',
      tool_call_id: 'call_0',
      content: 'validation failed',
    });
    expect(sent.tool_choice).toEqual({ type: 'function', function: { name: 'submit_thing' } });

    // Response shape: function call parsed back into a tool_use block, and the
    // answering model recorded for the audit row.
    expect(response.model).toBe('gpt-4o-2024-11-20');
    expect(response.usage).toEqual({ input_tokens: 11, output_tokens: 7 });
    expect(response.content).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'submit_thing', input: { answer: 42 } },
    ]);
  });

  it('keeps malformed tool arguments as an empty object for validation to reject', async () => {
    const create = vi.fn(async (_body: unknown, _options?: unknown) => ({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'submit_thing', arguments: 'not json' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      model: 'gpt-4o',
    }));
    const client = openaiChatClient('gpt-4o', {
      chat: { completions: { create } },
    } as unknown as OpenAI);

    const response: OpenAiChatResponse = await client.messages.create(ARGS);
    expect(response.content[0]).toMatchObject({ type: 'tool_use', id: 'call_1', input: {} });
  });
});
