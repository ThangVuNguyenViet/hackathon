import { z } from 'zod';
import {
  assertOpenAiResponseOk,
  createOpenAiRequestMetadata,
  openAiRequestHeaders,
  type OpenAiDiagnosticContext,
} from './openAiDiagnostics.js';
import {
  extractText,
  plannerOutputSchema,
  referencesCatalogName,
  savedAddressReferenceSchema,
  type ResponsesBody,
} from './toolPlannerNormalization.js';
import type { ToolPlannerInput, ToolPlannerOutput } from './toolPlanner.js';

interface ClassifierRequestContext {
  apiKey: string;
  baseUrl: string;
  fetchImpl: typeof fetch;
  timeoutMs?: number;
  diagnosticContext?: OpenAiDiagnosticContext;
}

const fastSubmittedOrderDecisionSchema = z.object({
  decision: z.enum(['order_status', 'payment_status', 'human_support', 'full_planning']),
  reason: z.string().trim().min(1).optional(),
});

export async function fetchPlannerResponse(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetchImpl(url, init);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError;
}

export async function classifySavedAddressReference(
  context: ClassifierRequestContext & {
    input: ToolPlannerInput;
    parsed: z.infer<typeof plannerOutputSchema>;
    model: string;
  },
): Promise<number | undefined> {
  const { input, parsed } = context;
  const savedAddresses = input.state.customerContext?.savedAddresses ?? [];
  if (
    savedAddresses.length === 0 ||
    input.state.address ||
    parsed.savedAddressDecision ||
    parsed.entities.addressChangeRequested === true ||
    !parsed.toolCalls.some((call) => call.toolName === 'updateCart')
  ) return undefined;

  const proposedDraft = typeof parsed.entities.addressDraft === 'object' &&
    parsed.entities.addressDraft !== null &&
    !Array.isArray(parsed.entities.addressDraft)
    ? parsed.entities.addressDraft as Record<string, unknown>
    : undefined;
  const hasCurrentTurnAddressEvidence = proposedDraft
    ? Object.values(proposedDraft).some((value) =>
        typeof value === 'string' && referencesCatalogName(input.state.latestUserMessage, value),
      )
    : false;
  if (hasCurrentTurnAddressEvidence) return undefined;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), context.timeoutMs ?? 8_000);
  try {
    const requestMetadata = createOpenAiRequestMetadata(
      'planner saved-address classification',
      context.model,
      context.diagnosticContext,
    );
    const response = await fetchPlannerResponse(context.fetchImpl, `${context.baseUrl}/responses`, {
      method: 'POST',
      signal: controller.signal,
      headers: openAiRequestHeaders(context.apiKey, requestMetadata),
      body: JSON.stringify({
        model: context.model,
        temperature: 0,
        max_output_tokens: 48,
        text: { format: { type: 'json_object' } },
        instructions: [
          'Classify whether the latest customer turn semantically refers to exactly one supplied saved-address candidate.',
          'Return exactly one JSON object with decision=saved_address, not_saved_address, or unclear.',
          'For saved_address, include the matching numeric addressIndex. For either other decision, omit addressIndex.',
          'Use conversation meaning, never a fixed phrase or word list.',
          'Do not select a saved address merely because another typed or carried address is incomplete.',
          'Do not treat item selection, delivery intent, or generic continuation as saved-address evidence.',
        ].join(' '),
        input: JSON.stringify({
          responseFormat: 'json',
          latestUserMessage: input.state.latestUserMessage,
          precedingAssistantTurn: [...(input.consentTurns ?? input.recentTurns)]
            .reverse()
            .find((turn) => turn.role === 'assistant')?.text,
          carriedPartialAddressDraft: input.state.addressDraft,
          savedAddresses: savedAddresses.map((address, addressIndex) => ({ addressIndex, address })),
        }),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as ResponsesBody;
    assertOpenAiResponseOk(response, body, requestMetadata);
    const text = extractText(body);
    const result = text ? savedAddressReferenceSchema.parse(JSON.parse(text)) : undefined;
    return result?.decision === 'saved_address' &&
      result.addressIndex !== undefined &&
      result.addressIndex !== null &&
      savedAddresses[result.addressIndex]
      ? result.addressIndex
      : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export async function classifySubmittedOrderRequest(
  context: ClassifierRequestContext & { input: ToolPlannerInput; model: string },
): Promise<ToolPlannerOutput | undefined> {
  const { input } = context;
  if (!input.state.order) return undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), context.timeoutMs ?? 8_000);
  try {
    const requestMetadata = createOpenAiRequestMetadata(
      'tool planning',
      context.model,
      context.diagnosticContext,
    );
    const response = await fetchPlannerResponse(context.fetchImpl, `${context.baseUrl}/responses`, {
      method: 'POST',
      signal: controller.signal,
      headers: openAiRequestHeaders(context.apiKey, requestMetadata),
      body: JSON.stringify({
        model: context.model,
        temperature: 0,
        max_output_tokens: 80,
        text: { format: { type: 'json_object' } },
        instructions: [
          'Semantically classify only the latest request about an existing submitted order.',
          'Return exactly one JSON object with decision and, only for human_support, a concise semantic reason.',
          'decision must be order_status, payment_status, human_support, or full_planning.',
          'Use order_status only for a read of order progress or ETA.',
          'Use payment_status only for a read or verification of payment state, including a reported payment failure.',
          'A report that a payment button, link, or transaction failed is payment_status even when the failure is repeated; checking the verified status is read-only.',
          'A request to create a new payment, retry it, or change its method is payment mutation and must be full_planning.',
          'Use human_support only when the customer explicitly requests a person or discusses an already active support transfer.',
          'Use full_planning for cancellation, edits, reorder, cart, address, fulfillment, new-order work, payment mutation, ambiguity, or anything else.',
          'Use conversation meaning, never a fixed phrase or word list.',
        ].join(' '),
        input: JSON.stringify({
          locale: 'vi-VN',
          responseFormat: 'json',
          latestUserMessage: input.state.latestUserMessage,
          precedingAssistantTurn: [...(input.consentTurns ?? input.recentTurns)]
            .reverse()
            .find((turn) => turn.role === 'assistant')?.text,
          verifiedOrderState: {
            status: input.state.order.status,
            paymentStatus: input.state.order.paymentStatus,
          },
          verifiedPaymentStatus: input.state.paymentAttempt?.status,
          activeHandoffReasons: input.state.handoff?.reasons,
        }),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as ResponsesBody;
    assertOpenAiResponseOk(response, body, requestMetadata);
    const text = extractText(body);
    if (!text) return undefined;
    const decision = fastSubmittedOrderDecisionSchema.parse(JSON.parse(text));
    if (decision.decision === 'order_status' && input.availableTools.includes('getOrderStatus')) {
      return {
        intent: 'order_status', entities: {},
        toolCalls: [{ toolName: 'getOrderStatus', arguments: { orderId: input.state.order.id } }],
        responseClaims: [],
      };
    }
    if (decision.decision === 'payment_status' && input.availableTools.includes('checkPaymentStatus')) {
      return {
        intent: 'payment', entities: {},
        toolCalls: [{ toolName: 'checkPaymentStatus', arguments: { orderId: input.state.order.id } }],
        responseClaims: [],
      };
    }
    if (
      decision.decision === 'human_support' &&
      decision.reason &&
      input.availableTools.includes('handoff')
    ) {
      return {
        intent: 'handoff', entities: { humanSupportRequested: true },
        toolCalls: [{ toolName: 'handoff', arguments: { reasons: [decision.reason] } }],
        responseClaims: [],
      };
    }
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
