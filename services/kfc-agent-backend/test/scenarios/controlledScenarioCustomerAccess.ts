import type {
  Channel,
  CustomerAccessContext,
} from '../../src/domain/types.js';
import {
  controlledCustomerAccess,
} from '../fixtures/controlledCustomerAccess.js';

/**
 * Binds controlled authenticated access to the same external subject that the
 * scenario runner persists for the current user turn.
 */
export function controlledScenarioCustomerAccess(input: {
  sessionId: string;
  customerId: string;
  channel: Channel;
}): CustomerAccessContext {
  const access = controlledCustomerAccess(input);
  return access.customerSurface === 'kfc-app-chat'
    ? access
    : {
        ...access,
        surfaceSubjectRef: input.customerId,
      };
}
