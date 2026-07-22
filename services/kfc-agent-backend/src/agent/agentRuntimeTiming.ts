export const agentTurnDeadlineMs = 30_000;
export const agentTurnPersistenceMarginMs = 30_000;
export const irreversibleOperationLeaseTtlMs =
  agentTurnDeadlineMs + agentTurnPersistenceMarginMs;
