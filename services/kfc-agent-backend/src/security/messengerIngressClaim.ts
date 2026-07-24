import type { ConversationEvent } from '../channels/conversationEvent.js';

export const MESSENGER_INGRESS_CLAIM_SCHEMA_VERSION =
  'kfc-messenger-ingress-claim-v1' as const;
const MESSENGER_INGRESS_CLAIM_DOMAIN = 'kfc/messenger-ingress-claim/v1\u0000';
const MESSENGER_INGRESS_EVIDENCE_DOMAIN =
  'kfc/messenger-ingress-evidence/v1\u0000';
const maximumClaimTtlMs = 15 * 60_000;
const defaultClaimTtlMs = 10 * 60_000;
const maximumIdentifierLength = 1_024;
const maximumEventTextLength = 32_000;

export type MessengerIngressQueueBinding =
  | {
      readonly kind: 'agent_run_wakeup';
      readonly generation: number;
    }
  | {
      readonly kind: 'messenger_control_event';
    };

export interface MessengerIngressClaim {
  readonly schemaVersion: typeof MESSENGER_INGRESS_CLAIM_SCHEMA_VERSION;
  readonly tenantScope: 'kfc-vietnam';
  readonly channel: 'messenger';
  readonly sessionId: string;
  readonly customerId: string;
  readonly surfaceSubjectRef: string;
  readonly externalThreadRef: string;
  readonly externalMessageId: string;
  readonly receivedAt: string;
  readonly evidenceRef: string;
  readonly evidenceDigest: string;
  readonly queueBinding: MessengerIngressQueueBinding;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly authenticationTag: string;
}

export interface VerifiedMessengerIngressClaimFields {
  readonly schemaVersion: 'kfc-verified-messenger-ingress-v1';
  readonly tenantScope: 'kfc-vietnam';
  readonly channel: 'messenger';
  readonly sessionId: string;
  readonly customerId: string;
  readonly surfaceSubjectRef: string;
  readonly externalThreadRef: string;
  readonly externalMessageId: string;
  readonly receivedAt: string;
  readonly evidenceRef: string;
  readonly evidenceDigest: string;
}

export interface VerifyMessengerIngressClaimEvidenceInput {
  claim: unknown;
  expectedEvent: ConversationEvent;
  expectedSessionId: string;
  expectedQueueBinding: MessengerIngressQueueBinding;
  appSecret: string;
  now?: Date;
}

export async function issueMessengerIngressClaim(input: {
  event: ConversationEvent;
  sessionId: string;
  queueBinding: MessengerIngressQueueBinding;
  appSecret: string;
  issuedAt?: Date;
  ttlMs?: number;
}): Promise<MessengerIngressClaim> {
  assertExpectedEvent(input.event, input.sessionId);
  assertQueueBinding(input.queueBinding);
  if (input.appSecret.length === 0)
    throw new Error('messenger_ingress_app_secret_invalid');
  const issuedAt = input.issuedAt ?? new Date();
  const ttlMs = input.ttlMs ?? defaultClaimTtlMs;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > maximumClaimTtlMs) {
    throw new Error('messenger_ingress_expiry_invalid');
  }
  const unsigned = {
    schemaVersion: MESSENGER_INGRESS_CLAIM_SCHEMA_VERSION,
    tenantScope: 'kfc-vietnam' as const,
    channel: 'messenger' as const,
    sessionId: input.sessionId,
    customerId: input.event.externalUserId,
    surfaceSubjectRef: input.event.externalUserId,
    externalThreadRef: input.event.externalThreadId,
    externalMessageId: input.event.rawEventId,
    receivedAt: input.event.receivedAt,
    evidenceRef: `meta-webhook:${input.event.rawEventId}`,
    evidenceDigest: await eventEvidenceDigest(input.event, input.sessionId),
    queueBinding: input.queueBinding,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + ttlMs).toISOString(),
  };
  return Object.freeze({
    ...unsigned,
    authenticationTag: await hmac(input.appSecret, unsigned),
  });
}

export async function verifyMessengerIngressClaimEvidence(
  input: VerifyMessengerIngressClaimEvidenceInput,
): Promise<VerifiedMessengerIngressClaimFields | undefined> {
  try {
    const claim = parseClaim(input.claim);
    assertExpectedEvent(input.expectedEvent, input.expectedSessionId);
    assertQueueBinding(input.expectedQueueBinding);
    if (input.appSecret.length === 0) return undefined;
    const now = (input.now ?? new Date()).getTime();
    const issuedAt = canonicalTimestamp(claim.issuedAt, 'issued_at');
    const expiresAt = canonicalTimestamp(claim.expiresAt, 'expires_at');
    if (
      expiresAt <= issuedAt ||
      expiresAt - issuedAt > maximumClaimTtlMs ||
      issuedAt > now + 60_000 ||
      expiresAt <= now
    ) {
      return undefined;
    }
    const { authenticationTag, ...unsigned } = claim;
    if (
      !constantTimeHexEqual(
        authenticationTag,
        await hmac(input.appSecret, unsigned),
      )
    ) {
      return undefined;
    }
    const expectedDigest = await eventEvidenceDigest(
      input.expectedEvent,
      input.expectedSessionId,
    );
    if (
      claim.sessionId !== input.expectedSessionId ||
      claim.customerId !== input.expectedEvent.externalUserId ||
      claim.surfaceSubjectRef !== input.expectedEvent.externalUserId ||
      claim.externalThreadRef !== input.expectedEvent.externalThreadId ||
      claim.externalMessageId !== input.expectedEvent.rawEventId ||
      claim.receivedAt !== input.expectedEvent.receivedAt ||
      claim.evidenceRef !== `meta-webhook:${input.expectedEvent.rawEventId}` ||
      claim.evidenceDigest !== expectedDigest ||
      canonicalJson(claim.queueBinding) !==
        canonicalJson(input.expectedQueueBinding)
    ) {
      return undefined;
    }
    return Object.freeze({
      schemaVersion: 'kfc-verified-messenger-ingress-v1',
      tenantScope: 'kfc-vietnam',
      channel: 'messenger',
      sessionId: claim.sessionId,
      customerId: claim.customerId,
      surfaceSubjectRef: claim.surfaceSubjectRef,
      externalThreadRef: claim.externalThreadRef,
      externalMessageId: claim.externalMessageId,
      receivedAt: claim.receivedAt,
      evidenceRef: claim.evidenceRef,
      evidenceDigest: claim.evidenceDigest,
    });
  } catch {
    return undefined;
  }
}

async function eventEvidenceDigest(
  event: ConversationEvent,
  sessionId: string,
): Promise<string> {
  return sha256({
    domain: MESSENGER_INGRESS_EVIDENCE_DOMAIN,
    tenantScope: 'kfc-vietnam',
    channel: 'messenger',
    sessionId,
    customerId: event.externalUserId,
    surfaceSubjectRef: event.externalUserId,
    externalThreadRef: event.externalThreadId,
    externalMessageId: event.rawEventId,
    receivedAt: event.receivedAt,
    eventType: event.eventType,
    text: event.text,
    shouldRunAgent: event.shouldRunAgent,
  });
}

function assertExpectedEvent(
  event: ConversationEvent,
  sessionId: string,
): void {
  if (event.channel !== 'messenger')
    throw new Error('messenger_ingress_channel_invalid');
  for (const [field, value] of Object.entries({
    session_id: sessionId,
    customer_id: event.externalUserId,
    external_thread_ref: event.externalThreadId,
    external_message_id: event.rawEventId,
  })) {
    assertBoundedText(value, field);
  }
  if (sessionId !== `messenger:${event.externalThreadId}`) {
    throw new Error('messenger_ingress_session_id_invalid');
  }
  if (
    event.text.length === 0 ||
    event.text.length > maximumEventTextLength ||
    event.text.trim() !== event.text
  ) {
    throw new Error('messenger_ingress_event_text_invalid');
  }
  canonicalTimestamp(event.receivedAt, 'received_at');
}

function assertBoundedText(value: string, field: string): void {
  if (
    value.length === 0 ||
    value.length > maximumIdentifierLength ||
    value.trim() !== value
  ) {
    throw new Error(`messenger_ingress_${field}_invalid`);
  }
}

function assertQueueBinding(binding: MessengerIngressQueueBinding): void {
  if (binding.kind === 'messenger_control_event') return;
  if (
    binding.kind !== 'agent_run_wakeup' ||
    !Number.isSafeInteger(binding.generation) ||
    binding.generation < 0
  ) {
    throw new Error('messenger_ingress_queue_binding_invalid');
  }
}

function parseClaim(value: unknown): MessengerIngressClaim {
  if (!isRecord(value)) throw new Error('messenger_ingress_claim_invalid');
  const exactKeys = [
    'authenticationTag',
    'channel',
    'customerId',
    'evidenceDigest',
    'evidenceRef',
    'expiresAt',
    'externalMessageId',
    'externalThreadRef',
    'issuedAt',
    'queueBinding',
    'receivedAt',
    'schemaVersion',
    'sessionId',
    'surfaceSubjectRef',
    'tenantScope',
  ];
  if (
    Object.keys(value).sort().join('\u0000') !== exactKeys.join('\u0000') ||
    value.schemaVersion !== MESSENGER_INGRESS_CLAIM_SCHEMA_VERSION ||
    value.tenantScope !== 'kfc-vietnam' ||
    value.channel !== 'messenger'
  ) {
    throw new Error('messenger_ingress_claim_invalid');
  }
  for (const key of [
    'sessionId',
    'customerId',
    'surfaceSubjectRef',
    'externalThreadRef',
    'externalMessageId',
    'receivedAt',
    'evidenceRef',
    'evidenceDigest',
    'issuedAt',
    'expiresAt',
    'authenticationTag',
  ] as const) {
    if (typeof value[key] !== 'string')
      throw new Error('messenger_ingress_claim_invalid');
  }
  const claim = value as unknown as MessengerIngressClaim;
  assertBoundedText(claim.sessionId, 'session_id');
  assertBoundedText(claim.customerId, 'customer_id');
  assertBoundedText(claim.surfaceSubjectRef, 'surface_subject_ref');
  assertBoundedText(claim.externalThreadRef, 'external_thread_ref');
  assertBoundedText(claim.externalMessageId, 'external_message_id');
  assertBoundedText(claim.evidenceRef, 'evidence_ref');
  if (
    !/^[a-f0-9]{64}$/u.test(claim.evidenceDigest) ||
    !/^[a-f0-9]{64}$/u.test(claim.authenticationTag)
  ) {
    throw new Error('messenger_ingress_claim_invalid');
  }
  assertQueueBinding(claim.queueBinding);
  return claim;
}

function canonicalTimestamp(value: string, field: string): number {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    throw new Error(`messenger_ingress_${field}_invalid`);
  }
  return timestamp;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function hmac(secret: string, value: unknown): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = new TextEncoder().encode(
    `${MESSENGER_INGRESS_CLAIM_DOMAIN}${canonicalJson(value)}`,
  );
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes)));
}

async function sha256(value: unknown): Promise<string> {
  return hex(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(canonicalJson(value)),
      ),
    ),
  );
}

function hex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/u.test(left) || !/^[a-f0-9]{64}$/u.test(right)) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
