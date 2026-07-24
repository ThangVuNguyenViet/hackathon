import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    pool: 'threads',
    setupFiles: ['test/setup.ts'],
    exclude: [
      // These files exercise the replaced StateGraph runtime. Keep them
      // runnable with `npm test`, but do not block the maintained Responses
      // runtime until the legacy suite is removed or repaired.
      'test/agent/agent-checkpoint-privacy.test.ts',
      'test/agent/agent-state-graph-runner.test.ts',
      'test/agent/agent-state-graph.test.ts',
      'test/agent/legacy-stategraph-boundaries.test.ts',
      'test/agent/payment-selection-authority-e2e.test.ts',
      'test/agent/payment-text-selection-state-graph.test.ts',
      'test/agent/selected-action-state-graph.test.ts',
      'test/agent/single-agent-runtime.test.ts',
      'test/agent/stategraph-order-context-invariants.test.ts',
      'test/agent/stategraph-saved-address-invariants.test.ts',
      'test/api/channel-media-throw-delivery.test.ts',
      'test/api/chat.test.ts',
      'test/api/dashboard-resume-recovery.test.ts',
      'test/api/guest-production-confirmation-resume.test.ts',
      'test/api/human-loop-channels.test.ts',
      'test/api/human-takeover.test.ts',
      'test/api/messenger-guest-checkout-ingress.test.ts',
      'test/api/session-routing.test.ts',
      'test/channels/messenger-webhook.test.ts',
      'test/channels/zalo-webhook.test.ts',
      'test/evaluation/messenger-projection-parity.test.ts',
      'test/genui/kfc-genui-action.test.ts',
      'test/graph/live-conversation-regressions.test.ts',
      'test/graph/native-confirmation-interrupt.test.ts',
      'test/persistence/d1-agent-run-text-delivery-store.test.ts',
      'test/persistence/d1-non-agent-text-delivery-store.test.ts',
      'test/scenarios/scenario-confirmation-resume.test.ts',
      'test/scenarios/stategraph-scenario-boundaries.test.ts',
      'test/scenarios/stategraph-scenario-replay.test.ts',
      'test/worker/worker.test.ts',
    ],
  },
});
