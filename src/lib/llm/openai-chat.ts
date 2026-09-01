/**
 * OpenAI chat adapter. Speaks the same Anthropic-style block protocol the
 * chat modules use (system + tool_use/tool_result blocks, tool_choice pinned
 * to one tool), translated onto OpenAI's chat completions with function
 * calling. Selected via LLM_PROVIDER=openai; it never falls back to anything.
 */
import OpenAI from 'openai';

import { type ChatClient } from './chat-provider';

export interface OpenAiTextBlock {
  type: 'text';
  text: string;
}
export interface OpenAiToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}
export interface OpenAiToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  is_error?: boolean;
  content: string;
}
export type OpenAiResponseBlock = OpenAiTextBlock | OpenAiToolUseBlock;

export type OpenAiMessageParam =
  | { role: 'user'; content: string | OpenAiToolResultBlock[] }
  | { role: 'assistant'; content: OpenAiResponseBlock[] };

export interface OpenAiChatArgs {
  /** Accepted for interface compatibility; the adapter always uses its own model. */
  model: string;
  max_tokens: number;
  system: string;
  messages: OpenAiMessageParam[];
  tools: Array<{ name: string; description: string; input_schema: object }>;
  tool_choice: { type: 'tool'; name: string };
}

export interface OpenAiChatResponse {
  content: OpenAiResponseBlock[];
  usage: { input_tokens: number; output_tokens: number };
  stop_reason?: string | null;
  /** The model that actually answered — audit rows must record this. */
  model?: string;
}

/**
 * Builds a chat client on the OpenAI SDK. `injectClient` exists for tests so
 * the SDK is never constructed (and never hits the network) in the suite.
 */
export function openaiChatClient(
  model: string,
  injectClient?: OpenAI,
): ChatClient<OpenAiChatArgs, OpenAiChatResponse> {
  const openai = injectClient ?? new OpenAI();

  function toOpenAiMessages(args: OpenAiChatArgs): OpenAI.ChatCompletionMessageParam[] {
    const messages: OpenAI.ChatCompletionMessageParam[] = [{ role: 'system', content: args.system }];
    for (const message of args.messages) {
      if (message.role === 'user') {
        if (typeof message.content === 'string') {
          messages.push({ role: 'user', content: message.content });
        } else {
          // Each tool_result becomes its own role:'tool' message, which is
          // how the OpenAI protocol pairs results to tool_call ids.
          for (const block of message.content) {
            messages.push({ role: 'tool', tool_call_id: block.tool_use_id, content: block.content });
          }
        }
      } else {
        const toolCalls = message.content
          .filter((block): block is OpenAiToolUseBlock => block.type === 'tool_use')
          .map((block) => ({
            id: block.id,
            type: 'function' as const,
            function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
          }));
        const text = message.content
          .filter((block): block is OpenAiTextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('\n');
        messages.push({
          role: 'assistant',
          content: text.length > 0 ? text : null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        });
      }
    }
    return messages;
  }

  return {
    messages: {
      create: async (args, options) => {
        const completion = await openai.chat.completions.create(
          {
            model,
            max_completion_tokens: args.max_tokens,
            messages: toOpenAiMessages(args),
            tools: args.tools.map((tool) => ({
              type: 'function' as const,
              function: {
                name: tool.name,
                description: tool.description,
                // OpenAI honours JSON Schema here just like the Anthropic
                // input_schema — the zod-generated contract passes through.
                // Boundary cast: the SDK's FunctionParameters type wants an
                // index signature the widened input_schema type lacks.
                parameters: tool.input_schema as Record<string, unknown>,
              },
            })),
            tool_choice: { type: 'function' as const, function: { name: args.tool_choice.name } },
          },
          { signal: options?.signal },
        );

        const choice = completion.choices[0]?.message;
        const content: OpenAiResponseBlock[] = [];
        if (typeof choice?.content === 'string' && choice.content.length > 0) {
          content.push({ type: 'text', text: choice.content });
        }
        for (const call of choice?.tool_calls ?? []) {
          if (call.type !== 'function') continue;
          // Malformed arguments become an empty object: the caller's zod
          // validation rejects it and the repair loop feeds the error back.
          let input: unknown = {};
          try {
            input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          } catch {
            input = {};
          }
          content.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
        }

        return {
          content,
          usage: {
            input_tokens: completion.usage?.prompt_tokens ?? 0,
            output_tokens: completion.usage?.completion_tokens ?? 0,
          },
          stop_reason: completion.choices[0]?.finish_reason ?? null,
          model: completion.model ?? model,
        };
      },
    },
  };
}
