import type { CustomerRunCoordinator } from '../customerRuns/runtime.js';
import type { DashboardEventBus } from '../dashboard/eventBus.js';
import type { ConversationStore } from '../persistence/memoryStore.js';
import type { ShowcaseService } from '../showcase/showcase.js';
import type { RouteOptions } from './routeHandlerContracts.js';
import type { RouteCommerceRuntime } from './routeCommerceRuntime.js';
import type { RouteAgentRuntime, StreamingRunObservers } from './routeAgentRuntime.js';
import type { RouteMessengerRuntime } from './routeMessengerRuntime.js';

export type RouteHandlerContext = {
  options: RouteOptions;
  store: ConversationStore;
  dashboard: DashboardEventBus;
  showcase: ShowcaseService | undefined;
  streamingRunObservers: StreamingRunObservers;
  customerRuns: CustomerRunCoordinator;
} & RouteCommerceRuntime & RouteAgentRuntime & RouteMessengerRuntime;
