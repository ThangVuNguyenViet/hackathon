import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type {
  DashboardEvent,
  MonitorSessionIntelligence,
} from '../domain/types.js';
import type { AgentState } from '../agent/agentState.js';
import { buildVerifiedStateSnapshot } from '../agent/verifiedState.js';
import type {
  MonitorSessionIntelligenceJudge,
  MonitorSessionIntelligenceJudgeInput,
} from '../monitor/sessionIntelligence.js';
import { parseAiMonitorSessionIntelligence } from '../monitor/sessionIntelligence.js';
import type { MonitorModelIdentity } from '../config/monitorModelProfile.js';

export interface ModelMonitorJudgeOptions {
  model: BaseChatModel;
  identity: MonitorModelIdentity;
  timeoutMs?: number;
}

const monitorJudgePromptVersion = 'monitor-judge-v1';
const monitorJudgeSystemPrompt =
  'You are a monitor judge for KFC Vietnam AI ordering automation. Return only valid JSON. Use only supplied runtime evidence; do not invent evidence.';

function messageText(message: BaseMessage): string {
  if (typeof message.content === 'string') return message.content.trim();
  return message.content
    .flatMap((part) =>
      typeof part === 'object' &&
      part !== null &&
      'text' in part &&
      typeof part.text === 'string'
        ? [part.text]
        : [],
    )
    .join('')
    .trim();
}

function buildPrompt(input: MonitorSessionIntelligenceJudgeInput): string {
  return JSON.stringify(
    {
      locale: 'vi-VN',
      role: 'KFC Vietnam monitor automation judge',
      promptVersion: monitorJudgePromptVersion,
      task: 'Score whether AI automation can continue handling this session without human intervention. Return only strict JSON matching outputSchema.',
      guardrails: [
        'Use only state, dashboardEvents, and deterministicFallback evidence in this payload.',
        'Do not invent tool names, event types, escalation reasons, safety reasons, order ids, payment facts, delivery facts, or customer profile facts.',
        'Write contextSummary as a concise Vietnamese or customer-language summary of the current chat context for an operations monitor card.',
        'Use recentTurns to summarize what the customer is trying to do and what the assistant has already said; do not quote private IDs.',
        'When deterministicFallback includes ai_resumed, describe AI as the current owner; do not say a human agent is currently participating or handling the session.',
        'contextSummary must not be a raw event type such as conversation_turn_created or customer_message_received.',
        'Confidence is the automation readiness of the AI agent for the next step, not customer sentiment.',
        'If safetyGateReasons is non-empty, do not exceed deterministicFallback.aiAutomationConfidencePercent.',
        'If evidence is incomplete or ambiguous, lower confidence instead of inventing certainty.',
      ],
      state: stateForPrompt(input.state),
      dashboardEvents: dashboardEventsForPrompt(input.dashboardEvents),
      deterministicFallback: input.deterministicFallback,
      allowedValues: {
        orderStage: [
          'collecting_info',
          'cart_ready',
          'fulfillment_pending',
          'payment_issue',
          'confirmed',
        ],
        riskLevel: ['low', 'medium', 'high', 'critical'],
        reasons: [
          'awaiting_customer_info',
          'cart_verified',
          'missing_address',
          'missing_fulfillment',
          'order_previewed',
          'order_created',
          'payment_link_pending',
          'payment_failed',
          'payment_paid',
          'handoff_required',
          'human_joined',
          'ai_resumed',
          'failed_delivery',
          'tool_execution_failed',
          'safety_gate_blocked',
        ],
        evidence: {
          dashboardEventTypes: input.dashboardEvents.map((event) => event.type),
          toolNames: [
            ...new Set(
              input.state.toolTrace?.map((entry) => entry.toolName) ?? [],
            ),
          ],
          escalationReasons: input.state.escalationReasons,
          safetyGateReasons:
            input.deterministicFallback.evidence.safetyGateReasons,
        },
      },
      outputSchema: {
        schemaVersion: 1,
        orderStage:
          'collecting_info|cart_ready|fulfillment_pending|payment_issue|confirmed',
        aiAutomationConfidencePercent: 'integer 0..100',
        riskLevel: 'low|medium|high|critical',
        priorityRank: 'integer, lower is more urgent',
        contextSummary:
          'short monitor-card summary, 6..140 chars, no raw event names or user ids',
        evaluatedCustomerTurnCount:
          'integer, copy deterministicFallback.evaluatedCustomerTurnCount',
        reasons: ['allowed reason strings only'],
        evidence: {
          dashboardEventTypes: [
            'subset of allowed evidence.dashboardEventTypes',
          ],
          toolNames: ['subset of allowed evidence.toolNames'],
          escalationReasons: ['subset of allowed evidence.escalationReasons'],
          safetyGateReasons: ['subset of allowed evidence.safetyGateReasons'],
        },
        source: 'ai_monitor_judge',
        model: '<model name>',
        promptVersion: monitorJudgePromptVersion,
        updatedAt: '<ISO timestamp>',
      },
    },
    null,
    2,
  );
}

function stateForPrompt(state: AgentState): Record<string, unknown> {
  const verifiedState = buildVerifiedStateSnapshot(state);
  return {
    sessionId: state.sessionId,
    channel: state.channel,
    latestUserMessage: state.latestUserMessage,
    recentTurns: state.recentTurns?.slice(-6).map((turn) => ({
      role: turn.role,
      text: turn.text,
      deliveryStatus: turn.deliveryStatus,
      createdAt: turn.createdAt,
    })),
    cart: verifiedState.cart,
    address: verifiedState.address,
    orderPreview: verifiedState.orderPreview,
    order: verifiedState.order,
    escalationReasons: state.escalationReasons,
    fulfillment: verifiedState.fulfillment,
    paymentAttempt: verifiedState.paymentAttempt,
    invoiceRequest: verifiedState.invoiceRequest,
    handoff: verifiedState.handoff,
    toolTrace: verifiedState.toolTrace,
  };
}

function dashboardEventsForPrompt(
  events: DashboardEvent[],
): Array<Record<string, unknown>> {
  return events.slice(-20).map((event) => ({
    type: event.type,
    createdAt: event.createdAt,
  }));
}

export class ModelMonitorJudge implements MonitorSessionIntelligenceJudge {
  readonly identity: MonitorModelIdentity;

  constructor(private readonly options: ModelMonitorJudgeOptions) {
    this.identity = options.identity;
  }

  async judge(
    input: MonitorSessionIntelligenceJudgeInput,
  ): Promise<MonitorSessionIntelligence> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 20_000,
    );

    let outputText: string;
    try {
      const response = await this.options.model.invoke(
        [
          new SystemMessage(monitorJudgeSystemPrompt),
          new HumanMessage(buildPrompt(input)),
        ],
        {
          runName: 'post_turn_monitor_model',
          signal: controller.signal,
        },
      );
      outputText = messageText(response);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `Monitor judge timed out after ${this.options.timeoutMs ?? 20_000}ms`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!outputText) {
      throw new Error('Monitor judge returned no text');
    }

    const parsed = parseAiMonitorSessionIntelligence(JSON.parse(outputText));
    if (!parsed) {
      throw new Error('Monitor judge returned invalid session intelligence');
    }

    return {
      ...parsed,
      model: this.identity.model,
      promptVersion: parsed.promptVersion ?? monitorJudgePromptVersion,
    };
  }
}
