import type { DashboardEvent, ConversationTurn } from '../domain/types.js';
import type { SessionControl } from '../persistence/memoryStore.js';
import type { ScenarioScript } from '../scenarios/scenarioScript.js';

export interface LiveProofEndpointCheck {
  name: string;
  ok: boolean;
  status?: number | undefined;
  message?: string | undefined;
  body?: unknown | undefined;
}

export interface LiveScenarioProofInput {
  script: ScenarioScript;
  sessionId: string;
  workerUrl: string;
  endpointChecks: LiveProofEndpointCheck[];
  sessionControl?: SessionControl | null | undefined;
  turns: ConversationTurn[];
  dashboardEvents: DashboardEvent[];
}

export interface LiveScenarioReplyCheck {
  userTurnIndex: number;
  userText: string;
  ok: boolean;
  assistantTurnId: string | null;
  userExternalMessageId: string | null;
}

export interface LiveScenarioProofResult {
  ok: boolean;
  workerUrl: string;
  sessionId: string;
  scenarioId: string;
  failures: string[];
  endpointChecks: LiveProofEndpointCheck[];
  sessionControl: SessionControl | null;
  replyChecks: LiveScenarioReplyCheck[];
  counts: {
    expectedCustomerTurns: number;
    observedCustomerTurns: number;
    observedAssistantTurns: number;
    dashboardEvents: number;
  };
}

const handoffFinalStates = new Set(['human_handoff_created', 'human_review_required']);

export function evaluateLiveScenarioProof(input: LiveScenarioProofInput): LiveScenarioProofResult {
  const failures: string[] = [];
  for (const check of input.endpointChecks) {
    if (!check.ok) failures.push(`Endpoint ${check.name} failed${check.status ? ` with HTTP ${check.status}` : ''}.`);
  }

  if (input.sessionControl?.agentMode === 'human_paused') {
    failures.push(`Session ${input.sessionId} is human_paused.`);
  }

  const customerTurns = input.turns.filter((turn) => turn.role === 'user');
  const assistantTurns = input.turns.filter((turn) => turn.role === 'assistant');
  const replyChecks = buildReplyChecks(input.script, input.turns);
  for (const check of replyChecks) {
    if (!check.userExternalMessageId) continue;
    if (!isRealMessengerInboundId(check.userExternalMessageId)) {
      failures.push(
        `Customer turn ${check.userTurnIndex} was not sent through real Messenger (${check.userExternalMessageId}).`,
      );
    }
  }
  if (!handoffFinalStates.has(input.script.finalState)) {
    for (const check of replyChecks) {
      if (!check.ok) failures.push(`Missing assistant reply after customer turn ${check.userTurnIndex}.`);
    }
  }

  if (customerTurns.length < input.script.userTurns.length) {
    failures.push(`Expected ${input.script.userTurns.length} customer turns, observed ${customerTurns.length}.`);
  }

  return {
    ok: failures.length === 0,
    workerUrl: input.workerUrl,
    sessionId: input.sessionId,
    scenarioId: input.script.id,
    failures,
    endpointChecks: input.endpointChecks,
    sessionControl: input.sessionControl ?? null,
    replyChecks,
    counts: {
      expectedCustomerTurns: input.script.userTurns.length,
      observedCustomerTurns: customerTurns.length,
      observedAssistantTurns: assistantTurns.length,
      dashboardEvents: input.dashboardEvents.length,
    },
  };
}

function buildReplyChecks(script: ScenarioScript, turns: ConversationTurn[]): LiveScenarioReplyCheck[] {
  let cursor = 0;
  return script.userTurns.map((scenarioTurn) => {
    const userTurnIndex = turns.findIndex(
      (turn, index) => index >= cursor && turn.role === 'user' && turn.text === scenarioTurn.text,
    );
    if (userTurnIndex === -1) {
      return {
        userTurnIndex: scenarioTurn.index,
        userText: scenarioTurn.text,
        ok: false,
        assistantTurnId: null,
        userExternalMessageId: null,
      };
    }

    const assistantTurn = turns.slice(userTurnIndex + 1).find((turn) => turn.role === 'assistant');
    cursor = userTurnIndex + 1;
    const userTurn = turns[userTurnIndex];
    if (!userTurn) throw new Error(`Missing persisted user turn at index ${userTurnIndex}`);
    return {
      userTurnIndex: scenarioTurn.index,
      userText: scenarioTurn.text,
      ok: Boolean(assistantTurn),
      assistantTurnId: assistantTurn?.id ?? null,
      userExternalMessageId: userTurn.externalMessageId ?? null,
    };
  });
}

function isRealMessengerInboundId(externalMessageId: string): boolean {
  if (!externalMessageId.startsWith('m_')) return false;
  return !/^m_(liveproof|pausedproof|proof|scenario)/i.test(externalMessageId);
}
