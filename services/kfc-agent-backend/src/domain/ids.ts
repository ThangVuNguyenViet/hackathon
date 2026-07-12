const idBrand: unique symbol = Symbol('kfc-id-brand');

export type BrandedId<Name extends string> = string & {
  readonly [idBrand]: Name;
};

function createIdParser<Name extends string>(name: Name) {
  return (value: string): BrandedId<Name> => {
    if (value.trim().length === 0) {
      throw new TypeError(`${name} must be a non-empty string`);
    }

    // Branding is intentionally centralized here: runtime validation happens
    // immediately above and branded strings retain their wire representation.
    return value as BrandedId<Name>;
  };
}

export type SessionId = BrandedId<'SessionId'>;
export type CustomerId = BrandedId<'CustomerId'>;
export type ConversationTurnId = BrandedId<'ConversationTurnId'>;
export type AgentRunId = BrandedId<'AgentRunId'>;
export type AgentId = BrandedId<'AgentId'>;
export type ExternalEventId = BrandedId<'ExternalEventId'>;
export type ExternalMessageId = BrandedId<'ExternalMessageId'>;
export type ExternalUserId = BrandedId<'ExternalUserId'>;
export type ExternalThreadId = BrandedId<'ExternalThreadId'>;
export type ClientMessageId = BrandedId<'ClientMessageId'>;
export type CartId = BrandedId<'CartId'>;
export type ItemCode = BrandedId<'ItemCode'>;
export type StoreId = BrandedId<'StoreId'>;
export type OrderId = BrandedId<'OrderId'>;
export type CommerceOrderId = BrandedId<'CommerceOrderId'>;
export type OmsOrderId = BrandedId<'OmsOrderId'>;
export type PosTicketId = BrandedId<'PosTicketId'>;
export type OfferId = BrandedId<'OfferId'>;
export type VoucherId = BrandedId<'VoucherId'>;
export type RewardId = BrandedId<'RewardId'>;
export type ScenarioId = BrandedId<'ScenarioId'>;
export type TraceId = BrandedId<'TraceId'>;

export const sessionId = createIdParser('SessionId');
export const customerId = createIdParser('CustomerId');
export const conversationTurnId = createIdParser('ConversationTurnId');
export const agentRunId = createIdParser('AgentRunId');
export const agentId = createIdParser('AgentId');
export const externalEventId = createIdParser('ExternalEventId');
export const externalMessageId = createIdParser('ExternalMessageId');
export const externalUserId = createIdParser('ExternalUserId');
export const externalThreadId = createIdParser('ExternalThreadId');
export const clientMessageId = createIdParser('ClientMessageId');
export const cartId = createIdParser('CartId');
export const itemCode = createIdParser('ItemCode');
export const storeId = createIdParser('StoreId');
export const orderId = createIdParser('OrderId');
export const commerceOrderId = createIdParser('CommerceOrderId');
export const omsOrderId = createIdParser('OmsOrderId');
export const posTicketId = createIdParser('PosTicketId');
export const offerId = createIdParser('OfferId');
export const voucherId = createIdParser('VoucherId');
export const rewardId = createIdParser('RewardId');
export const scenarioId = createIdParser('ScenarioId');
export const traceId = createIdParser('TraceId');
