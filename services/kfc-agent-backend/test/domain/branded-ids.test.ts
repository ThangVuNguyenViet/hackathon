import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  orderId,
  sessionId,
  type OrderId,
  type SessionId,
} from '../../src/domain/ids.js';

describe('branded domain identifiers', () => {
  it('preserves the public string representation after validation', () => {
    expect(sessionId('messenger:customer-1')).toBe('messenger:customer-1');
    expect(orderId('KFC-1001')).toBe('KFC-1001');
  });

  it('rejects empty identifiers at the boundary', () => {
    expect(() => sessionId('   ')).toThrow('SessionId must be a non-empty string');
  });

  it('keeps semantically different identifiers incompatible', () => {
    const session = sessionId('session-1');
    const order = orderId('order-1');

    expectTypeOf(session).toEqualTypeOf<SessionId>();
    expectTypeOf(order).toEqualTypeOf<OrderId>();
    // @ts-expect-error Order identifiers must not be accepted as session identifiers.
    const invalidSession: SessionId = order;
    expect(invalidSession).toBe(order);
  });
});
