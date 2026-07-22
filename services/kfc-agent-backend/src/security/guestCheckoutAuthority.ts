import type { ConversationEvent } from '../channels/conversationEvent.js';
import { normalizeMessengerWebhook } from '../channels/messenger.js';
import type { RunCommitFence } from '../persistence/contracts.js';
import { verifyMetaWebhookSignature } from './webhookAuthenticity.js';

export const GUEST_CHECKOUT_AUTHORITY_SCHEMA_VERSION =
  'kfc-guest-checkout-authority-v1' as const;

const maximumGuestCheckoutAuthorityTtlMs = 15 * 60_000;
const issuedGuestCheckoutAuthorities = new WeakSet<object>();
const issuedMessengerIngressAttestations = new WeakSet<object>();

export interface VerifiedMessengerGuestCheckoutIngress {
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
export interface GuestCheckoutAuthority {
  readonly schemaVersion: typeof GUEST_CHECKOUT_AUTHORITY_SCHEMA_VERSION;
  readonly authoritySource:
    'verified_messenger_ingress' | 'controlled_messenger_mock';
  readonly tenantScope: 'kfc-vietnam';
  readonly channel: 'messenger' | 'messenger_mock';
  readonly sessionId: string;
  readonly customerId: string;
  readonly surfaceSubjectRef: string;
  readonly externalThreadRef: string;
  readonly externalMessageId: string;
  readonly ingressEvidenceRef: string;
  readonly ingressEvidenceDigest: string;
  readonly sourceRunKind: RunCommitFence['kind'];
  readonly sourceRunRef: string;
  readonly sourceRunGeneration: number;
  readonly sourceRunFenceDigest: string;
  readonly sessionAuthorityGeneration: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly authorityDigest: string;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.entries(record)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function sourceRunBinding(fence: RunCommitFence): {
  kind: RunCommitFence['kind'];
  ref: string;
  generation: number;
} {
  switch (fence.kind) {
    case 'agent_run':
      return {
        kind: fence.kind,
        ref: fence.runId,
        generation: fence.generation,
      };
    case 'customer_run':
      return { kind: fence.kind, ref: fence.runId, generation: 0 };
    case 'operation_lease':
      return {
        kind: fence.kind,
        ref: `${fence.requestId}:${fence.operation}`,
        generation: fence.attempt,
      };
  }
}

function assertCanonicalTimestamp(value: string, field: string): number {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    throw new Error(`guest_checkout_${field}_invalid`);
  }
  return timestamp;
}

function assertBoundedText(
  value: string,
  field: string,
  maximum = 1_024,
): void {
  if (value.length === 0 || value.length > maximum || value.trim() !== value) {
    throw new Error(`guest_checkout_${field}_invalid`);
  }
}

function exactMessengerSessionId(event: ConversationEvent): string {
  return `messenger:${event.externalThreadId}`;
}

/**
 * Verifies Meta's raw-body HMAC and returns branded, event-specific ingress
 * attestations. Callers cannot mint a production guest authority from a parsed
 * request body or a plain ConversationEvent.
 */
export async function verifyMessengerGuestCheckoutIngress(input: {
  rawBody: Uint8Array;
  signatureHeader: string | null;
  appSecret: string;
  pageId: string;
}): Promise<readonly VerifiedMessengerGuestCheckoutIngress[]> {
  if (
    !(await verifyMetaWebhookSignature({
      rawBody: input.rawBody,
      signatureHeader: input.signatureHeader,
      appSecret: input.appSecret,
    }))
  ) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(input.rawBody));
  } catch {
    return [];
  }
  let events: ConversationEvent[];
  try {
    events = normalizeMessengerWebhook(parsed, input.pageId);
  } catch {
    return [];
  }
  const attestations: VerifiedMessengerGuestCheckoutIngress[] = [];
  for (const event of events) {
    const binding = {
      schemaVersion: 'kfc-verified-messenger-ingress-v1' as const,
      tenantScope: 'kfc-vietnam' as const,
      channel: 'messenger' as const,
      sessionId: exactMessengerSessionId(event),
      customerId: event.externalUserId,
      surfaceSubjectRef: event.externalUserId,
      externalThreadRef: event.externalThreadId,
      externalMessageId: event.rawEventId,
      receivedAt: event.receivedAt,
      evidenceRef: `meta-webhook:${event.rawEventId}`,
    };
    const attestation = Object.freeze({
      ...binding,
      evidenceDigest: await sha256(binding),
    });
    issuedMessengerIngressAttestations.add(attestation);
    attestations.push(attestation);
  }
  return Object.freeze(attestations);
}

async function issueGuestCheckoutAuthority(input: {
  authoritySource: GuestCheckoutAuthority['authoritySource'];
  tenantScope: 'kfc-vietnam';
  channel: GuestCheckoutAuthority['channel'];
  sessionId: string;
  customerId: string;
  surfaceSubjectRef: string;
  externalThreadRef: string;
  externalMessageId: string;
  ingressEvidenceRef: string;
  ingressEvidenceDigest: string;
  runFence: RunCommitFence;
  issuedAt: string;
  expiresAt: string;
}): Promise<GuestCheckoutAuthority> {
  for (const [field, value] of Object.entries({
    session_id: input.sessionId,
    customer_id: input.customerId,
    surface_subject: input.surfaceSubjectRef,
    external_thread: input.externalThreadRef,
    external_message: input.externalMessageId,
    ingress_evidence_ref: input.ingressEvidenceRef,
  })) {
    assertBoundedText(value, field);
  }
  if (!/^[a-f0-9]{64}$/u.test(input.ingressEvidenceDigest)) {
    throw new Error('guest_checkout_ingress_evidence_digest_invalid');
  }
  const issuedAt = assertCanonicalTimestamp(input.issuedAt, 'issued_at');
  const expiresAt = assertCanonicalTimestamp(input.expiresAt, 'expires_at');
  if (
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > maximumGuestCheckoutAuthorityTtlMs
  ) {
    throw new Error('guest_checkout_expiry_invalid');
  }
  const run = sourceRunBinding(input.runFence);
  const sourceRunFenceDigest = await sha256(input.runFence);
  const unsigned = {
    schemaVersion: GUEST_CHECKOUT_AUTHORITY_SCHEMA_VERSION,
    authoritySource: input.authoritySource,
    tenantScope: input.tenantScope,
    channel: input.channel,
    sessionId: input.sessionId,
    customerId: input.customerId,
    surfaceSubjectRef: input.surfaceSubjectRef,
    externalThreadRef: input.externalThreadRef,
    externalMessageId: input.externalMessageId,
    ingressEvidenceRef: input.ingressEvidenceRef,
    ingressEvidenceDigest: input.ingressEvidenceDigest,
    sourceRunKind: run.kind,
    sourceRunRef: run.ref,
    sourceRunGeneration: run.generation,
    sourceRunFenceDigest,
    sessionAuthorityGeneration: input.runFence.sessionAuthorityGeneration,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
  } as const;
  const authority = Object.freeze({
    ...unsigned,
    authorityDigest: await sha256(unsigned),
  });
  issuedGuestCheckoutAuthorities.add(authority);
  return authority;
}

export async function issueVerifiedMessengerGuestCheckoutAuthority(input: {
  ingress: VerifiedMessengerGuestCheckoutIngress;
  runFence: RunCommitFence;
  issuedAt?: Date;
  ttlMs?: number;
}): Promise<GuestCheckoutAuthority> {
  if (!issuedMessengerIngressAttestations.has(input.ingress)) {
    throw new Error('guest_checkout_verified_ingress_required');
  }
  const issuedAt = input.issuedAt ?? new Date();
  const ttlMs = input.ttlMs ?? 10 * 60_000;
  return issueGuestCheckoutAuthority({
    authoritySource: 'verified_messenger_ingress',
    tenantScope: input.ingress.tenantScope,
    channel: input.ingress.channel,
    sessionId: input.ingress.sessionId,
    customerId: input.ingress.customerId,
    surfaceSubjectRef: input.ingress.surfaceSubjectRef,
    externalThreadRef: input.ingress.externalThreadRef,
    externalMessageId: input.ingress.externalMessageId,
    ingressEvidenceRef: input.ingress.evidenceRef,
    ingressEvidenceDigest: input.ingress.evidenceDigest,
    runFence: input.runFence,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + ttlMs).toISOString(),
  });
}

/**
 * Explicit deterministic-fixture issuer. It cannot mint authority for KFC,
 * Zalo, or a real Messenger channel.
 */
export async function issueControlledMessengerMockGuestCheckoutAuthority(input: {
  sessionId: string;
  customerId: string;
  externalMessageId: string;
  runFence: RunCommitFence;
  issuedAt?: Date;
  ttlMs?: number;
}): Promise<GuestCheckoutAuthority> {
  const issuedAt = input.issuedAt ?? new Date();
  const ttlMs = input.ttlMs ?? 10 * 60_000;
  const evidence = {
    schemaVersion: 'kfc-controlled-guest-checkout-fixture-v1',
    channel: 'messenger_mock',
    sessionId: input.sessionId,
    customerId: input.customerId,
    externalMessageId: input.externalMessageId,
  } as const;
  return issueGuestCheckoutAuthority({
    authoritySource: 'controlled_messenger_mock',
    tenantScope: 'kfc-vietnam',
    channel: 'messenger_mock',
    sessionId: input.sessionId,
    customerId: input.customerId,
    surfaceSubjectRef: input.customerId,
    externalThreadRef: input.customerId,
    externalMessageId: input.externalMessageId,
    ingressEvidenceRef: `controlled-messenger-mock:${input.externalMessageId}`,
    ingressEvidenceDigest: await sha256(evidence),
    runFence: input.runFence,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + ttlMs).toISOString(),
  });
}

export function guestCheckoutAuthorityIsIssued(
  authority: GuestCheckoutAuthority | undefined,
): authority is GuestCheckoutAuthority {
  return Boolean(
    authority &&
    issuedGuestCheckoutAuthorities.has(authority) &&
    authority.schemaVersion === GUEST_CHECKOUT_AUTHORITY_SCHEMA_VERSION,
  );
}
