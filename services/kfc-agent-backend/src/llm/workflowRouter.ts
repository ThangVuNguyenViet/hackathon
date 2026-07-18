import type { ConversationTurn } from '../domain/types.js';
import {
  isSocialWorkflowRoute,
  workflowRouteSchema,
  type WorkflowRoute,
} from '../domain/workflow.js';
import type { AgentGraphState } from '../graph/state.js';
import {
  assertOpenAiResponseOk,
  createOpenAiRequestMetadata,
  openAiRequestHeaders,
  type OpenAiDiagnosticContext,
} from './openAiDiagnostics.js';

export interface WorkflowRouterInput {
  latestUserMessage: string;
  recentTurns: Array<Pick<ConversationTurn, 'role' | 'text'>>;
  verifiedState: {
    hasCart: boolean;
    hasAddress: boolean;
    hasFulfillment: boolean;
    hasOrderPreview: boolean;
    hasOrder: boolean;
    hasPaymentAttempt: boolean;
    hasHandoff: boolean;
  };
}

export interface WorkflowRouter {
  readonly model?: string;
  readonly promptVersion?: string;
  route(input: WorkflowRouterInput): Promise<WorkflowRoute>;
}

export interface OpenAIWorkflowRouterOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  diagnosticContext?: OpenAiDiagnosticContext;
}

const outputJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    primaryWorkflows: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['catalog_cart', 'fulfillment', 'checkout_payment', 'post_order_support'],
      },
    },
    capabilities: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['membership', 'promotions_content', 'food_safety', 'human_support'],
      },
    },
    needsClarification: { type: 'boolean' },
  },
  required: ['primaryWorkflows', 'capabilities', 'needsClarification'],
} as const;

const instructions = [
  'Route one KFC Vietnam customer turn and return only strict JSON.',
  'Choose every primary workflow required by the latest turn: catalog_cart, fulfillment, checkout_payment, or post_order_support.',
  'Choose every independent cross-cutting capability required: membership, promotions_content, food_safety, or human_support.',
  'Use food_safety for ingredient, allergen, spice-level, cheese, dietary, or other food-content safety questions.',
  'Use membership only when the latest turn asks about points, rewards, wallet, membership, or semantically refers to an unresolved membership choice.',
  'Use human_support only for an explicit person or staff request, a continued submitted-order cancellation, a safety escalation, or another policy-mandated transfer.',
  'Capabilities describe the latest request only. Do not carry a capability forward merely because it appeared in older recentTurns.',
  'Use verifiedState and recentTurns only to resolve references and active lifecycle state; never treat them as a new customer request.',
  'For a mixed request, return the union of all required workflows and capabilities.',
  'A menu or cart change combined with fulfillment requires both catalog_cart and fulfillment.',
  'A menu or cart change combined with payment or checkout requires both catalog_cart and checkout_payment.',
  'A submitted-order request for a person requires post_order_support and human_support.',
  'A food-content question about a menu or cart item requires food_safety and catalog_cart when catalog evidence is needed.',
  'Return needsClarification=true only when no safe workflow can be selected without customer clarification.',
  'For needsClarification=true, return empty workflow and capability arrays.',
  'A pure self-contained greeting, thanks, or goodbye has empty arrays and needsClarification=false.',
  'Do not write a customer response, tool plan, business answer, or chain-of-thought.',
].join(' ');

interface ResponsesApiBody {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ text?: unknown }> }>;
  error?: { message?: unknown };
}

function outputText(body: ResponsesApiBody): string | undefined {
  if (typeof body.output_text === 'string' && body.output_text.trim()) return body.output_text.trim();
  for (const output of body.output ?? []) {
    for (const content of output.content ?? []) {
      if (typeof content.text === 'string' && content.text.trim()) return content.text.trim();
    }
  }
  return undefined;
}

export function workflowRouterInput(
  state: AgentGraphState,
  recentTurns: ConversationTurn[],
): WorkflowRouterInput {
  return {
    latestUserMessage: state.latestUserMessage,
    recentTurns: recentTurns.slice(-8).map(({ role, text }) => ({ role, text })),
    verifiedState: {
      hasCart: Boolean(state.cart),
      hasAddress: Boolean(state.address || state.addressDraft),
      hasFulfillment: Boolean(state.fulfillment),
      hasOrderPreview: Boolean(state.orderPreview),
      hasOrder: Boolean(state.order),
      hasPaymentAttempt: Boolean(state.paymentAttempt),
      hasHandoff: Boolean(state.handoff),
    },
  };
}

export function stateDerivedWorkflowRoute(state: AgentGraphState): WorkflowRoute {
  if (state.order) {
    return { primaryWorkflows: ['post_order_support'], capabilities: [], needsClarification: false };
  }
  if (state.orderPreview || state.paymentAttempt) {
    return { primaryWorkflows: ['checkout_payment'], capabilities: [], needsClarification: false };
  }
  if (state.address || state.addressDraft || state.fulfillment) {
    return { primaryWorkflows: ['fulfillment'], capabilities: [], needsClarification: false };
  }
  if (state.cart) {
    return { primaryWorkflows: ['catalog_cart'], capabilities: [], needsClarification: false };
  }
  return { primaryWorkflows: [], capabilities: [], needsClarification: true };
}

export { isSocialWorkflowRoute };

export class OpenAIWorkflowRouter implements WorkflowRouter {
  readonly model: string;
  readonly promptVersion = 'workflow-router-v2';
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAIWorkflowRouterOptions) {
    this.model = options.model ?? 'gpt-4.1-mini';
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 2_500;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async route(input: WorkflowRouterInput): Promise<WorkflowRoute> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const requestMetadata = createOpenAiRequestMetadata(
      'workflow router',
      this.model,
      this.options.diagnosticContext,
    );
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: 'POST',
        signal: controller.signal,
        headers: openAiRequestHeaders(this.options.apiKey, requestMetadata),
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          text: {
            format: {
              type: 'json_schema',
              name: 'workflow_route',
              strict: true,
              schema: outputJsonSchema,
            },
          },
          instructions,
          input: JSON.stringify(input),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as ResponsesApiBody;
      assertOpenAiResponseOk(response, body, requestMetadata);
      const text = outputText(body);
      if (!text) throw new Error('Workflow router returned no text');
      return workflowRouteSchema.parse(JSON.parse(text));
    } finally {
      clearTimeout(timeout);
    }
  }
}
