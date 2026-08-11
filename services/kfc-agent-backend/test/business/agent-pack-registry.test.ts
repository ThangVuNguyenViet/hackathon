import { tool } from '@kfc/openai-agents-runtime';
import { describe, expect, it, vi } from 'vitest';
import {
  AgentPackRegistry,
  type AgentPack,
} from '../../src/business/agentPack.js';

const inspectTool = tool({
  name: 'inspect',
  description: 'Inspect an opaque resource.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  strict: true,
  execute: () => 'inspected',
});

function pack(
  id: string,
): AgentPack<{ requestId: string }, { traceId: string }> {
  return {
    id,
    profile: {
      name: `${id} agent`,
      instructions: `Serve the ${id} pack.`,
    },
    prepareTurn: ({ requestId }) => ({
      tools: [inspectTool],
      context: { traceId: `trace:${requestId}` },
    }),
  };
}

describe('AgentPackRegistry', () => {
  it('resolves only explicitly registered packs and preserves opaque prepared resources', async () => {
    const alpha = pack('alpha');
    const registry = new AgentPackRegistry([alpha]);

    const resolved = registry.require('alpha');
    const prepared = await resolved.prepareTurn({ requestId: 'request-1' });

    expect(resolved.profile).toEqual({
      name: 'alpha agent',
      instructions: 'Serve the alpha pack.',
    });
    expect(prepared).toEqual({
      tools: [inspectTool],
      context: { traceId: 'trace:request-1' },
    });
  });

  it('rejects missing and unknown selections before a pack can prepare a turn', () => {
    const alpha = pack('alpha');
    const prepareTurn = vi.spyOn(alpha, 'prepareTurn');
    const registry = new AgentPackRegistry([alpha]);

    expect(() => registry.require(undefined)).toThrow('agent_pack_id_missing');
    expect(() => registry.require('beta')).toThrow(
      'agent_pack_id_unknown:beta',
    );
    expect(prepareTurn).not.toHaveBeenCalled();
  });

  it.each(['', '   '])('rejects a missing registration ID %#', (id) => {
    expect(() => new AgentPackRegistry([pack(id)])).toThrow(
      'agent_pack_id_missing',
    );
  });

  it('rejects duplicate registration IDs', () => {
    expect(() => new AgentPackRegistry([pack('alpha'), pack('alpha')])).toThrow(
      'agent_pack_id_duplicate:alpha',
    );
  });

  it('validates the complete trusted startup inventory when expected IDs are supplied', () => {
    expect(
      () =>
        new AgentPackRegistry([pack('alpha')], {
          expectedIds: ['alpha', 'beta'],
        }),
    ).toThrow('agent_pack_registration_missing:beta');
    expect(
      () =>
        new AgentPackRegistry([pack('alpha'), pack('gamma')], {
          expectedIds: ['alpha'],
        }),
    ).toThrow('agent_pack_id_unknown:gamma');
  });

  it('snapshots its trusted inventory instead of observing later input mutation', () => {
    const configured = [pack('alpha')];
    const registry = new AgentPackRegistry(configured);

    configured.push(pack('beta'));

    expect(registry.ids).toEqual(['alpha']);
    expect(Object.isFrozen(registry.ids)).toBe(true);
    expect(() => registry.require('beta')).toThrow(
      'agent_pack_id_unknown:beta',
    );
  });
});
