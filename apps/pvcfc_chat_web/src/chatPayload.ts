export interface PvcfcChatPayload {
  sessionId: string;
  customerId: string;
  clientMessageId: string;
  text: string;
}

/**
 * The PVCFC route deliberately binds the session namespace to the customer
 * identity. Keep this invariant at the UI boundary so every transport sends
 * the same identity pair, including demo replay turns.
 */
export function createPvcfcChatPayload(input: {
  customerId: string;
  clientMessageId: string;
  text: string;
}): PvcfcChatPayload {
  return {
    sessionId: `pvcfc:${input.customerId}`,
    customerId: input.customerId,
    clientMessageId: input.clientMessageId,
    text: input.text,
  };
}
