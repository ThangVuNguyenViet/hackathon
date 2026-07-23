import { describe, expect, it } from 'vitest';
import { buildMonitorEvidenceRevision } from '../../src/api/routeMonitorRuntime.js';

const base = {
  latestTurnOrdinal: 4,
  customerTurnCount: 2,
  packStateSha256: 'a'.repeat(64),
  sessionAuthorityGeneration: 3,
  agentMode: 'ai_active' as const,
  assignedAgentId: null,
  latestDashboardEvent: {
    id: 'dashboard-a',
    type: 'session_updated' as const,
    createdAt: '2026-07-24T00:00:00.000Z',
  },
};

describe('monitor evidence revision', () => {
  it('is stable for the same canonical evidence', () => {
    expect(buildMonitorEvidenceRevision(base)).toBe(
      buildMonitorEvidenceRevision({ ...base }),
    );
  });

  it.each([
    ['transcript ordinal', { latestTurnOrdinal: 5 }],
    ['typed state revision', { packStateSha256: 'b'.repeat(64) }],
    ['session authority', { sessionAuthorityGeneration: 4 }],
    [
      'dashboard state',
      {
        latestDashboardEvent: {
          id: 'dashboard-b',
          type: 'session_resolved' as const,
          createdAt: '2026-07-24T00:01:00.000Z',
        },
      },
    ],
  ])('changes when %s changes', (_label, patch) => {
    expect(buildMonitorEvidenceRevision({ ...base, ...patch })).not.toBe(
      buildMonitorEvidenceRevision(base),
    );
  });
});
