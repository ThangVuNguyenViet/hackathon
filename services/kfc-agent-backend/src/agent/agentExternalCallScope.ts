import type { ExternalCallContext } from '../clients/interfaces.js';
import { agentTurnDeadlineMs } from './agentRuntimeTiming.js';

export const defaultAgentTurnDeadlineMs = agentTurnDeadlineMs;
const maximumTimerDelayMs = 2_147_483_647;

export interface AgentTurnExternalCallScope {
  readonly context: ExternalCallContext;
  abort(reason: unknown): void;
  dispose(): void;
}

export function createAgentTurnExternalCallScope(
  configuredDeadlineMs = defaultAgentTurnDeadlineMs,
): AgentTurnExternalCallScope {
  const deadlineMs = Number.isFinite(configuredDeadlineMs)
    ? Math.min(
        Math.max(0, configuredDeadlineMs),
        maximumTimerDelayMs,
      )
    : defaultAgentTurnDeadlineMs;
  const controller = new AbortController();
  const deadlineAt = Date.now() + deadlineMs;
  const abortForTimeout = () => {
    if (!controller.signal.aborted) {
      controller.abort(new DOMException(
        'agent_turn_deadline_exceeded',
        'TimeoutError',
      ));
    }
  };
  const timeout = deadlineMs === 0
    ? (abortForTimeout(), undefined)
    : setTimeout(abortForTimeout, deadlineMs);
  return {
    context: Object.freeze({
      signal: controller.signal,
      deadlineAt,
    }),
    abort(reason) {
      if (!controller.signal.aborted) controller.abort(reason);
    },
    dispose() {
      if (timeout !== undefined) clearTimeout(timeout);
    },
  };
}
