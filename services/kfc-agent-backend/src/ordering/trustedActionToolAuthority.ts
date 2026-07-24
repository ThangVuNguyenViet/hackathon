import {
  trustedCustomerActionEnvelopeSchema,
  type TrustedCustomerActionEnvelope,
} from '../domain/customerCommand.js';
import { digestCommerceAction } from './commerceDigest.js';
import type { ToolCallRequest, ToolName } from './types.js';

const trustedActionAuthorityBrand = Symbol('trustedActionToolAuthority');

export interface TrustedActionToolAuthority {
  readonly [trustedActionAuthorityBrand]: true;
  readonly sessionId: string;
  readonly currentRunIdentity: string;
  readonly durableRequestIdentity: string;
  readonly actionDigest: string;
  readonly verifiedRevision: string;
  readonly commandKind: TrustedCustomerActionEnvelope['command']['kind'];
  readonly toolName: ToolName;
  readonly argumentsDigest: string;
  readonly customerConfirmed: true;
}

function authorizedToolRequest(
  action: TrustedCustomerActionEnvelope,
): ToolCallRequest | undefined {
  switch (action.command.kind) {
    case 'confirm_order':
      return { toolName: 'placeOrder', arguments: {} };
    case 'select_payment_method':
      return {
        toolName: 'createPaymentLink',
        arguments: { methodId: action.command.selection.methodId },
      };
    default:
      return undefined;
  }
}

export async function createTrustedActionToolAuthority(input: {
  action: unknown;
  sessionId: string;
  currentRunIdentity: string;
  durableRequestIdentity: string;
  request: ToolCallRequest;
}): Promise<TrustedActionToolAuthority | undefined> {
  const action = trustedCustomerActionEnvelopeSchema.safeParse(input.action);
  if (
    !action.success ||
    input.sessionId.length === 0 ||
    input.currentRunIdentity.length === 0 ||
    input.durableRequestIdentity.length === 0
  ) {
    return undefined;
  }
  const authorized = authorizedToolRequest(action.data);
  if (!authorized || authorized.toolName !== input.request.toolName) {
    return undefined;
  }
  const [authorizedArgumentsDigest, requestedArgumentsDigest] =
    await Promise.all([
      digestCommerceAction(authorized.arguments),
      digestCommerceAction(input.request.arguments),
    ]);
  if (authorizedArgumentsDigest !== requestedArgumentsDigest) {
    return undefined;
  }
  return Object.freeze({
    [trustedActionAuthorityBrand]: true as const,
    sessionId: input.sessionId,
    currentRunIdentity: input.currentRunIdentity,
    durableRequestIdentity: input.durableRequestIdentity,
    actionDigest: action.data.actionDigest,
    verifiedRevision: action.data.verifiedRevision,
    commandKind: action.data.command.kind,
    toolName: authorized.toolName,
    argumentsDigest: authorizedArgumentsDigest,
    customerConfirmed: true,
  });
}

export async function validateTrustedActionToolAuthority(input: {
  authority: TrustedActionToolAuthority | undefined;
  sessionId: string | undefined;
  currentRunIdentity: string | undefined;
  durableRequestIdentity: string | undefined;
  request: ToolCallRequest;
}): Promise<{ customerConfirmed: true } | undefined> {
  const authority = input.authority;
  if (
    !authority ||
    authority[trustedActionAuthorityBrand] !== true ||
    !input.sessionId ||
    !input.currentRunIdentity ||
    !input.durableRequestIdentity ||
    authority.sessionId !== input.sessionId ||
    authority.currentRunIdentity !== input.currentRunIdentity ||
    authority.durableRequestIdentity !== input.durableRequestIdentity ||
    authority.toolName !== input.request.toolName ||
    authority.argumentsDigest !==
      (await digestCommerceAction(input.request.arguments))
  ) {
    return undefined;
  }
  return { customerConfirmed: authority.customerConfirmed };
}
