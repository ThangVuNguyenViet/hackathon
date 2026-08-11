import type {
  ChannelTextOutcomeClient,
  ExternalCallContext,
  MessengerClient,
  ZaloClient,
} from '../clients/interfaces.js';
import type {
  Address,
  Cart,
  MenuItem,
  Order,
  ToolResult,
} from '../domain/types.js';
import type { AutomaticRecommendationHttpRuntime } from '../recommendations/serving/http-runtime.js';
import type {
  ChatRecommendationContext,
  RecommendationJourneyStore,
} from '../clients/catalogObservationClients.js';
import type { FulfillmentMethod } from '../ordering/types.js';
import type { MockedUpstreamApiProfile } from './mockedUpstreamProfile.js';

export interface MockClientOptions {
  channelClients?: {
    messenger: Omit<MessengerClient, 'sendTextWithOutcome'> &
      Partial<ChannelTextOutcomeClient>;
    zalo: Omit<ZaloClient, 'sendTextWithOutcome'> &
      Partial<ChannelTextOutcomeClient>;
  };
  initialOrders?: Order[];
  savedAddressesProvider?: (
    customerId: string,
    externalCallContext: ExternalCallContext,
  ) => Promise<ToolResult<Address[]>> | ToolResult<Address[]>;
  recentOrderProvider?: (
    customerId: string,
    externalCallContext: ExternalCallContext,
  ) => Promise<ToolResult<Order | null>> | ToolResult<Order | null>;
  favoriteItemsProvider?: (
    customerId: string,
    externalCallContext: ExternalCallContext,
  ) => Promise<ToolResult<MenuItem[]>> | ToolResult<MenuItem[]>;
  orderStatusProvider?: (
    orderId: string,
    externalCallContext: ExternalCallContext,
  ) => Promise<ToolResult<Order>> | ToolResult<Order>;
  paymentStatusProvider?: (
    orderId: string,
    externalCallContext: ExternalCallContext,
  ) =>
    | Promise<
        ToolResult<{
          status: 'pending' | 'paid' | 'failed';
        }>
      >
    | ToolResult<{ status: 'pending' | 'paid' | 'failed' }>;
  fulfillmentQuoteProvider?: (
    input: {
      address: Address;
      method: FulfillmentMethod;
      itemCodes: string[];
      storeId: string;
      storeName: string;
    },
    externalCallContext: ExternalCallContext,
  ) =>
    | Promise<ToolResult<{ feeVnd: number; etaMinutes: number }>>
    | ToolResult<{ feeVnd: number; etaMinutes: number }>;
  sessionId?: string;
  automaticRecommendations?: AutomaticRecommendationHttpRuntime;
  automaticRecommendationContext?: (
    sessionId: string,
    cart: Cart,
  ) => ChatRecommendationContext | Promise<ChatRecommendationContext>;
  automaticRecommendationJourney?: (
    sessionId: string,
  ) => RecommendationJourneyStore;
  mockedUpstreamApiProvider?: () => MockedUpstreamApiProfile | undefined;
}
