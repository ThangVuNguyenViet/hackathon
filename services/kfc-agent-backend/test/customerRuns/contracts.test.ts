import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_RUN_SCHEMA_VERSION,
  customerRunEventSchema,
  customerRunPhaseSchema,
  customerRunStartRequestSchema,
  customerRunStatusSchema,
} from '../../src/customerRuns/contracts.js';

const clientCapability = {
  appVersion: '1.0.0+1',
  supportedSchemaVersions: [1],
};

describe('customer run contracts', () => {
  it('accepts one closed text input with streaming capability metadata', () => {
    const parsed = customerRunStartRequestSchema.parse({
      schemaVersion: 1,
      sessionId: 'kfc:customer_1',
      customerId: 'customer_1',
      clientMessageId: 'customer_chat_msg_1',
      clientCapability,
      input: { kind: 'text', text: 'Cho mình một combo gà' },
    });

    expect(CUSTOMER_RUN_SCHEMA_VERSION).toBe(1);
    expect(parsed.input).toEqual({ kind: 'text', text: 'Cho mình một combo gà' });
  });

  it('accepts a GenUI action capability invocation as the sole input', () => {
    const parsed = customerRunStartRequestSchema.parse({
      schemaVersion: 1,
      sessionId: 'kfc:customer_1',
      customerId: 'customer_1',
      clientMessageId: 'customer_chat_action_1',
      clientCapability,
      input: {
        kind: 'genui_action',
        capabilityId: 'cap_confirm_order_1',
        actionId: 'confirm_order',
        values: { confirmation: true },
      },
    });

    expect(parsed.input.kind).toBe('genui_action');
  });

  it('rejects unsupported versions, empty text, and extra untrusted fields', () => {
    const base = {
      schemaVersion: 1,
      sessionId: 'kfc:customer_1',
      customerId: 'customer_1',
      clientMessageId: 'customer_chat_msg_1',
      clientCapability,
      input: { kind: 'text', text: 'hello' },
    };

    expect(() => customerRunStartRequestSchema.parse({ ...base, schemaVersion: 2 })).toThrow();
    expect(() => customerRunStartRequestSchema.parse({ ...base, input: { kind: 'text', text: '   ' } })).toThrow();
    expect(() => customerRunStartRequestSchema.parse({ ...base, rawToolArguments: {} })).toThrow();
  });

  it('defines the approved lifecycle statuses and execution phases', () => {
    for (const status of ['accepted', 'running', 'cancelling', 'completed', 'failed', 'cancelled', 'superseded']) {
      expect(customerRunStatusSchema.parse(status)).toBe(status);
    }
    for (const phase of [
      'queued',
      'planning',
      'read_only_tool',
      'state_change_tool',
      'irreversible_tool',
      'reconciling',
      'response_composition',
      'text_delivery',
      'finalizing',
    ]) {
      expect(customerRunPhaseSchema.parse(phase)).toBe(phase);
    }
  });

  it('accepts a versioned sequenced event and rejects unknown event types or sequence zero', () => {
    const event = {
      schemaVersion: 1,
      eventId: 'run_event_1',
      runId: 'customer_run_1',
      sequence: 1,
      type: 'run_accepted',
      occurredAt: '2026-07-11T00:00:00.000Z',
      payload: { status: 'accepted', phase: 'queued' },
    };

    expect(customerRunEventSchema.parse(event)).toEqual(event);
    expect(() => customerRunEventSchema.parse({ ...event, sequence: 0 })).toThrow();
    expect(() => customerRunEventSchema.parse({ ...event, type: 'tool_called' })).toThrow();
  });
});
