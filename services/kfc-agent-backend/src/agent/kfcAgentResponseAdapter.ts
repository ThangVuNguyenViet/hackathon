import type { ConversationTurnMetadata } from '../domain/types.js';
import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import type { OpenAiResponsesExecutionResult } from './openAiResponsesExecutor.js';

const customerIdentifierKeys = new Set(['code', 'itemCode', 'modifierId']);
const customerAdministrativeIdentifierLabels = [
  ['communeCode', 'communeName'],
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordCustomerIdentifiers(
  value: unknown,
  identifiers: Map<string, string>,
  structuralLabels: Set<string>,
): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      recordCustomerIdentifiers(entry, identifiers, structuralLabels);
    }
    return;
  }
  if (!isRecord(value)) return;
  if (
    typeof value.groupId === 'string' &&
    Array.isArray(value.options) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0
  ) {
    structuralLabels.add(value.name.trim());
  }
  for (const [
    identifierKey,
    labelKey,
  ] of customerAdministrativeIdentifierLabels) {
    const identifier = value[identifierKey];
    const label = value[labelKey];
    if (
      typeof identifier === 'string' &&
      identifier.trim().length > 0 &&
      typeof label === 'string' &&
      label.trim().length > 0 &&
      identifier !== label
    ) {
      identifiers.set(identifier, label.trim());
    }
  }
  const label =
    typeof value.name === 'string' && value.name.trim().length > 0
      ? value.name.trim()
      : undefined;
  if (label) {
    for (const [key, identifier] of Object.entries(value)) {
      if (
        customerIdentifierKeys.has(key) &&
        typeof identifier === 'string' &&
        isCustomerIdentifier(identifier) &&
        identifier !== label
      ) {
        identifiers.set(identifier.trim(), label);
      }
    }
  }
  for (const nested of Object.values(value)) {
    recordCustomerIdentifiers(nested, identifiers, structuralLabels);
  }
}

function isCustomerIdentifier(value: string): boolean {
  const identifier = value.trim();
  return identifier.length >= 5 && /\d/u.test(identifier);
}

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isCurrencyOccurrence(
  source: string,
  start: number,
  length: number,
): boolean {
  const before = source.slice(0, start);
  const after = source.slice(start + length);
  const currency = '(?:VND|VNĐ|đ|₫)';
  return (
    new RegExp(`${currency}\\s*$`, 'iu').test(before) ||
    new RegExp(`^\\s*${currency}(?=\\s|[.,;:!?)]|$)`, 'iu').test(after)
  );
}

function stripStructuralLabels(
  customerText: string,
  structuralLabels: ReadonlySet<string>,
): string {
  let result = customerText;
  const labels = [...structuralLabels].sort(
    (left, right) => right.length - left.length,
  );
  for (const label of labels) {
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}_])${escapedRegExp(label)}(?=$|[^\\p{L}\\p{N}_])`,
      'giu',
    );
    result = result.replace(pattern, (_match, prefix: string) => prefix);
  }
  return result.replace(/[ \t]{2,}/gu, ' ').replace(/\s+([,.;:!?])/gu, '$1');
}

function presentCustomerResponse(input: {
  responseText: string;
  verifiedBusinessContext?: Record<string, unknown>;
  execution: OpenAiResponsesExecutionResult;
}): string {
  const successfulHandoff = input.execution.toolCalls.some(
    (call) =>
      call.name === 'handoff' &&
      isRecord(call.result) &&
      call.result.ok === true,
  );
  if (successfulHandoff) {
    return 'Yêu cầu gặp nhân viên của bạn đã được ghi nhận và đang chờ nhân viên tiếp nhận. Hiện chưa có thời gian phản hồi được xác minh.';
  }
  const identifiers = new Map<string, string>();
  const structuralLabels = new Set<string>();
  recordCustomerIdentifiers(
    input.verifiedBusinessContext,
    identifiers,
    structuralLabels,
  );
  for (const call of input.execution.toolCalls) {
    recordCustomerIdentifiers(call.result, identifiers, structuralLabels);
  }
  let customerText = input.responseText;
  const entries = [...identifiers.entries()].sort(
    ([left], [right]) => right.length - left.length,
  );
  for (const [identifier, label] of entries) {
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}_])(${escapedRegExp(identifier)})(?=$|[^\\p{L}\\p{N}_])`,
      'gu',
    );
    customerText = customerText.replace(
      pattern,
      (
        match: string,
        prefix: string,
        _matchedIdentifier: string,
        offset: number,
        source: string,
      ) =>
        isCurrencyOccurrence(source, offset + prefix.length, identifier.length)
          ? match
          : `${prefix}${label}`,
    );
  }
  return stripStructuralLabels(customerText, structuralLabels);
}

export function kfcDeveloperMessages(input: {
  verifiedBusinessContext?: Record<string, unknown>;
  metadata: ConversationTurnMetadata | null;
}): string[] {
  const messages = input.verifiedBusinessContext
    ? [
        `Verified current KFC business state; reuse these exact identifiers: ${JSON.stringify(input.verifiedBusinessContext)}`,
      ]
    : [];
  if (!input.metadata?.customerCommand) return messages;
  messages.push(
    `Verified GenUI customer action: ${JSON.stringify(input.metadata.customerCommand)}`,
    [
      'The structured GenUI action is already verified and is the only action to handle in this turn.',
      'Give the customer a concise account of the supplied verified state and exact tool result.',
      'Treat order placement, payment, and processing as established when the verified result explicitly reports that state.',
      input.metadata.customerCommand.kind === 'submit_address'
        ? 'Handle the verified structured address update and describe its resulting draft, missing fields, serviceability, or quote.'
        : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
  return messages;
}

export function adaptKfcAgentOutput(input: {
  execution: OpenAiResponsesExecutionResult;
  verifiedBusinessContext?: Record<string, unknown>;
  metadata: ConversationTurnMetadata | null;
  transport: string;
  selectGenUi?: (
    result: OpenAiResponsesExecutionResult,
  ) => KfcGenUiAttachment | undefined;
}) {
  const genUi = input.selectGenUi?.(input.execution);
  const responseText = presentCustomerResponse({
    responseText: input.execution.responseText,
    verifiedBusinessContext: input.verifiedBusinessContext,
    execution: input.execution,
  });
  return {
    responseText,
    assistantMetadata: {
      transport: input.transport,
      ...(input.metadata?.release ? { release: input.metadata.release } : {}),
      ...(input.metadata?.responseProfile
        ? { responseProfile: input.metadata.responseProfile }
        : {}),
      ...(genUi ? { genUi } : {}),
    },
    ...(genUi ? { output: genUi } : {}),
  };
}
