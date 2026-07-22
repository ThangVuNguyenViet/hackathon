import { agentFailure } from './agentToolAuthority.js';
import {
  agentToolArgumentSchemas,
  resolvedFulfillmentAddressSchema,
  toolArgumentSchemas,
} from './toolCatalog.js';
import type {
  AgentToolCallFailure,
  ToolCallRequest,
  ToolCallSuccessFor,
} from './types.js';

function exactStringSet(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length && left.every((value) => right.includes(value))
  );
}

export function bindAgentFulfillmentQuote(input: {
  request: ToolCallRequest;
  itemCodes: readonly string[] | undefined;
}): ToolCallRequest | AgentToolCallFailure {
  const args = agentToolArgumentSchemas.quoteFulfillment.parse(
    input.request.arguments,
  );
  if (args.address === null) {
    return agentFailure(
      input.request,
      'Saved-address reference must be resolved by the agent graph',
      'invalid_tool_arguments',
    );
  }
  if (!input.itemCodes?.length) {
    return agentFailure(
      input.request,
      'A non-empty verified cart is required',
      'cart_required',
    );
  }
  return {
    toolName: input.request.toolName,
    arguments: {
      address: args.address,
      method: args.method,
      itemCodes: [...input.itemCodes],
    },
  };
}

export function validateAgentFulfillmentQuote(input: {
  request: ToolCallRequest;
  result: ToolCallSuccessFor<'quoteFulfillment'>;
  expectedItemCodes: readonly string[];
}): AgentToolCallFailure | undefined {
  const requested = toolArgumentSchemas.quoteFulfillment.safeParse(
    input.request.arguments,
  );
  if (
    !requested.success ||
    input.result.value.method !== requested.data.method ||
    input.result.value.disposition !== requested.data.method
  ) {
    return agentFailure(
      input.request,
      'Fulfillment provider returned a quote for a different method',
      'invalid_fulfillment_quote_binding',
    );
  }
  if (
    !resolvedFulfillmentAddressSchema.safeParse(
      input.result.value.resolvedAddress,
    ).success
  ) {
    return agentFailure(
      input.request,
      'Fulfillment provider did not return a normalized address',
      'invalid_fulfillment_address_resolution',
    );
  }
  if (
    !exactStringSet(
      input.expectedItemCodes,
      input.result.value.availability.checkedItemIds,
    )
  ) {
    return agentFailure(
      input.request,
      'Fulfillment quote does not cover the exact current cart',
      'incomplete_cart_availability',
    );
  }
  return undefined;
}
