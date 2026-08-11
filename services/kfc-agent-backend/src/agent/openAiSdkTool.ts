import type { FunctionTool } from '@kfc/openai-agents-runtime';
import type {
  DirectAgentLifecycleObserver,
  DirectAgentToolCallTrace,
} from './directAgentTurn.js';

export interface OpenAiStrictJsonObjectSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
  [key: string]: unknown;
}

export interface OpenAiAgentRunContext {
  toolCalls: DirectAgentToolCallTrace[];
  developerMessages: string[];
  toolStartedAt?: Map<string, number>;
  lifecycle?: DirectAgentLifecycleObserver;
}

export type OpenAiFunctionTool = FunctionTool<
  OpenAiAgentRunContext,
  OpenAiStrictJsonObjectSchema,
  unknown
>;
