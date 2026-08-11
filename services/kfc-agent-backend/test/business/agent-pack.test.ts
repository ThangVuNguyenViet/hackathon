import { describe, expect, it, vi } from 'vitest';
import {
  AgentPackRegistry,
  type BusinessAgentPack,
} from '../../src/business/agentPack.js';

interface FakeTurn {
  readonly requestId: string;
}

interface FakeResult {
  readonly selectedPack: string;
}

function pack(id: string): BusinessAgentPack<FakeTurn, FakeResult> {
  return {
    id,
    runTurn: async () => ({ selectedPack: id }),
  };
}

describe('AgentPackRegistry', () => {
  it('resolves only explicitly registered business packs', async () => {
    const alpha = pack('alpha');
    const registry = new AgentPackRegistry([alpha]);

    await expect(registry.require('alpha').runTurn({ requestId: 'request-1' }))
      .resolves.toEqual({ selectedPack: 'alpha' });
  });

  it('rejects missing and unknown selections before a pack can run a turn', () => {
    const alpha = pack('alpha');
    const runTurn = vi.spyOn(alpha, 'runTurn');
    const registry = new AgentPackRegistry([alpha]);

    expect(() => registry.require(undefined)).toThrow('agent_pack_id_missing');
    expect(() => registry.require('beta')).toThrow(
      'agent_pack_id_unknown:beta',
    );
    expect(runTurn).not.toHaveBeenCalled();
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
