import { describe, expect, it } from 'vitest';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { executeToolCall } from '../../src/ordering/toolExecutor.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

const clients = createMockClients(createTestFixtures());

describe('tool executor', () => {
  it('validates and executes menu search', async () => {
    const result = await executeToolCall(clients, { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.value)).toContain('Combo Hợp Gu 99K');
  });

  it('rejects invalid tool arguments before client execution', async () => {
    const result = await executeToolCall(clients, { toolName: 'searchMenu', arguments: { q: 'wrong' } });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('invalid_tool_arguments');
  });

  it('executes promotion search without inventing public codes', async () => {
    const result = await executeToolCall(clients, {
      toolName: 'validateVoucher',
      arguments: { voucherText: 'KFC50', subtotalVnd: 250000 },
    });
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ ok: false, reason: 'public_code_not_exposed', publicCode: '' });
  });
});
