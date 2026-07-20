import { z } from 'zod';
import type { CustomerAccessContext } from '../domain/types.js';
import {
  digestCommerceAction,
} from '../ordering/approvalReceipt.js';
import {
  approvalCapabilityScopes,
  approvalCapabilitySupportsGuestCheckout,
} from '../ordering/toolBoundaries.js';
import {
  confirmationPauseIdentityDigest,
  parseConfirmationPauseRecord,
} from '../persistence/confirmationPause.js';
import type {
  ConfirmationPauseStorageSnapshot,
} from '../persistence/confirmationPause.js';
import {
  guestPrincipalMatchesAuthority,
  isAuthenticatedCommerceApprovalPrincipal,
  isGuestCheckoutPrincipal,
} from '../ordering/commerceApprovalPrincipal.js';
import type {
  CommerceApprovalPrincipal,
  VerifiedGuestApprovalResumeAuthority,
} from '../ordering/types.js';
import { authorizeCustomerAccess } from '../security/customerAccessContext.js';
import {
  guestCheckoutAuthorityIsIssued,
  type GuestCheckoutAuthority,
} from '../security/guestCheckoutAuthority.js';
import {
  markVerifiedGuestApprovalAuthorityIssued,
  verifiedGuestApprovalAuthorityIsIssued,
} from '../security/verifiedGuestApprovalAuthority.js';

const approvalCapabilitySchemaVersion =
  'kfc-approval-capability-v2' as const;
const defaultApprovalCapabilityTtlMs = 10 * 60_000;
const maximumApprovalCapabilityTtlMs = 10 * 60_000;
const maximumApprovalCapabilityLength = 8_192;
const minimumSigningSecretBytes = 32;

const canonicalTimestampSchema = z.string().datetime().refine(
  (value) => new Date(value).toISOString() === value,
  'Timestamp must use canonical UTC millisecond precision',
);

const commonCapabilityPayloadFields = {
  schemaVersion: z.literal(approvalCapabilitySchemaVersion),
  keyId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/u),
  requestId: z.string().uuid(),
  sessionId: z.string().min(1).max(256),
  customerId: z.string().min(1).max(256),
  channel: z.enum([
    'messenger',
    'zalo',
    'kfc',
    'messenger_mock',
    'zalo_mock',
  ]),
  toolName: z.string().min(1).max(128),
  actionDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  approvalBindingDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  checkpointThreadId: z.string().min(1).max(1_024),
  checkpointNamespace: z.string().max(512),
  checkpointId: z.string().min(1).max(1_024),
  sessionGeneration: z.number().int().nonnegative(),
  sessionAuthorityGeneration: z.number().int().nonnegative(),
  pauseIdentityDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  issuedAt: canonicalTimestampSchema,
  expiresAt: canonicalTimestampSchema,
} as const;

const authenticatedCapabilityPayloadSchema = z.object({
  ...commonCapabilityPayloadFields,
  principalKind: z.literal('authenticated_customer'),
  authenticatedSubject: z.string().min(1).max(512),
  authenticationEvidenceRef: z.string().min(1).max(1_024),
}).strict();

const guestCapabilityPayloadSchema = z.object({
  ...commonCapabilityPayloadFields,
  channel: z.enum(['messenger', 'messenger_mock']),
  toolName: z.enum(['placeOrder', 'createPaymentLink']),
  principalKind: z.literal('guest_checkout'),
  guestPrincipalDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  guestAuthorityDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  guestSessionAuthorityGeneration: z.number().int().nonnegative(),
  sourceRunKind: z.enum([
    'agent_run',
    'customer_run',
    'operation_lease',
  ]),
  sourceRunRefDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceRunGeneration: z.number().int().nonnegative(),
  sourceRunFenceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  externalMessageIdDigest: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

const confirmationApprovalCapabilityPayloadSchema = z.discriminatedUnion(
  'principalKind',
  [
    authenticatedCapabilityPayloadSchema,
    guestCapabilityPayloadSchema,
  ],
).superRefine((payload, context) => {
  if (Date.parse(payload.issuedAt) >= Date.parse(payload.expiresAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expiresAt'],
      message: 'Approval capability must expire after it is issued',
    });
  }
});

export type ConfirmationApprovalCapabilityPayload = z.infer<
  typeof confirmationApprovalCapabilityPayloadSchema
>;

export interface ConfirmationApprovalSigningKey {
  keyId: string;
  secret: string | Uint8Array;
}

export interface ConfirmationApprovalKeyRing {
  activeKeyId: string;
  keys: ReadonlyMap<string, string | Uint8Array>;
}

export interface IssuedConfirmationApprovalCapability {
  approvalCapability: string;
  expiresAt: string;
}

export type VerifiedGuestConfirmationApprovalAuthority =
  VerifiedGuestApprovalResumeAuthority;

export type VerifyConfirmationApprovalCapabilityResult =
  | {
      ok: true;
      payload: ConfirmationApprovalCapabilityPayload;
      signingSecret: string | Uint8Array;
      guestAuthority?: VerifiedGuestConfirmationApprovalAuthority;
    }
  | {
      ok: false;
      errorCode:
        | 'approval_capability_expired'
        | 'approval_capability_invalid';
    };

function secretBytes(secret: string | Uint8Array): Uint8Array {
  return typeof secret === 'string'
    ? new TextEncoder().encode(secret)
    : new Uint8Array(secret);
}

function assertSigningSecret(secret: string | Uint8Array): void {
  if (secretBytes(secret).byteLength < minimumSigningSecretBytes) {
    throw new Error('confirmation_approval_signing_secret_too_short');
  }
}

export function createConfirmationApprovalKeyRing(input: {
  active: ConfirmationApprovalSigningKey;
  previous?: readonly ConfirmationApprovalSigningKey[];
}): ConfirmationApprovalKeyRing {
  const keys = new Map<string, string | Uint8Array>();
  for (const key of [input.active, ...(input.previous ?? [])]) {
    if (!/^[A-Za-z0-9._-]{1,64}$/u.test(key.keyId)) {
      throw new Error('confirmation_approval_signing_key_id_invalid');
    }
    assertSigningSecret(key.secret);
    if (keys.has(key.keyId)) {
      throw new Error('confirmation_approval_signing_key_id_duplicate');
    }
    keys.set(key.keyId, key.secret);
  }
  return Object.freeze({
    activeKeyId: input.active.keyId,
    keys,
  });
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)),
    );
  }
  return btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '');
}

function decodeBase64Url(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return undefined;
  const remainder = value.length % 4;
  if (remainder === 1) return undefined;
  const padded = value
    .replace(/-/gu, '+')
    .replace(/_/gu, '/') +
    (remainder === 0 ? '' : '='.repeat(4 - remainder));
  try {
    const decoded = Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0)
    );
    return encodeBase64Url(decoded) === value
      ? decoded
      : undefined;
  } catch {
    return undefined;
  }
}

async function hmacKey(
  secret: string | Uint8Array,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const source = secretBytes(secret);
  const keyBytes = new Uint8Array(source.byteLength);
  keyBytes.set(source);
  return crypto.subtle.importKey(
    'raw',
    keyBytes.buffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  );
}

async function signPayload(
  encodedPayload: string,
  secret: string | Uint8Array,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret, ['sign']),
    new TextEncoder().encode(encodedPayload),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

async function signatureIsValid(input: {
  encodedPayload: string;
  encodedSignature: string;
  secret: string | Uint8Array;
}): Promise<boolean> {
  const signature = decodeBase64Url(input.encodedSignature);
  if (!signature) return false;
  return crypto.subtle.verify(
    'HMAC',
    await hmacKey(input.secret, ['verify']),
    new Uint8Array(signature).buffer,
    new TextEncoder().encode(input.encodedPayload),
  );
}

function exactAccessContext(input: {
  accessContext: CustomerAccessContext | undefined;
  snapshot: ConfirmationPauseStorageSnapshot;
  now: number;
}): boolean {
  const pause = input.snapshot.record;
  if (!isAuthenticatedCommerceApprovalPrincipal(pause.principal)) {
    return false;
  }
  const access = authorizeCustomerAccess(input.accessContext, {
    channel: pause.channel,
    sessionId: pause.sessionId,
    customerId: pause.customerId,
    scope: approvalCapabilityScopes[pause.approvalBinding.capability],
  }, input.now);
  const evidence = input.accessContext?.authenticationEvidence;
  return (
    access.allowed &&
    input.accessContext?.authenticationState === 'authenticated' &&
    input.accessContext.kfcSubjectRef ===
      pause.principal.authenticatedSubject &&
    evidence?.state === 'verified' &&
    evidence.evidenceRef ===
      pause.principal.authenticationEvidenceRef
  );
}

async function principalDigest(
  snapshot: ConfirmationPauseStorageSnapshot,
): Promise<string> {
  return digestCommerceAction(snapshot.record.principal);
}

async function guestAuthorityMatchesSnapshot(input: {
  authority: GuestCheckoutAuthority | undefined;
  snapshot: ConfirmationPauseStorageSnapshot;
  now: number;
}): Promise<boolean> {
  const pause = input.snapshot.record;
  const principal = pause.principal;
  return (
    isGuestCheckoutPrincipal(principal) &&
    approvalCapabilitySupportsGuestCheckout(
      pause.approvalBinding.capability,
    ) &&
    guestCheckoutAuthorityIsIssued(input.authority) &&
    guestPrincipalMatchesAuthority(principal, input.authority) &&
    input.snapshot.sessionAuthorityGeneration ===
      principal.sessionAuthorityGeneration &&
    Date.parse(principal.expiresAt) > input.now &&
    Date.parse(input.authority.expiresAt) > input.now &&
    await principalDigest(input.snapshot) ===
      await digestCommerceAction(principal)
  );
}

export async function verifiedGuestApprovalAuthorityMatches(
  authority: VerifiedGuestConfirmationApprovalAuthority | undefined,
  snapshot: ConfirmationPauseStorageSnapshot,
  now = Date.now(),
): Promise<boolean> {
  return (
    await verifiedGuestApprovalAuthorityMatchesPrincipal(authority, {
      principal: snapshot.record.principal,
      sessionId: snapshot.record.sessionId,
      customerId: snapshot.record.customerId,
      channel: snapshot.record.channel,
      sessionGeneration: snapshot.sessionAuthorityGeneration,
      checkpointThreadId: snapshot.record.checkpointThreadId,
      checkpointNamespace: snapshot.record.checkpointNamespace,
      now,
    }) &&
    authority?.requestId === snapshot.record.requestId &&
    authority.checkpointId === snapshot.record.checkpointId &&
    authority.toolName === snapshot.record.action.toolName &&
    authority.actionDigest === snapshot.record.actionDigest &&
    authority.approvalBindingDigest ===
      snapshot.record.approvalBindingDigest &&
    authority.pauseIdentityDigest === snapshot.identityDigest
  );
}

export async function verifiedGuestApprovalAuthorityMatchesPrincipal(
  authority: VerifiedGuestConfirmationApprovalAuthority | undefined,
  input: {
    principal: CommerceApprovalPrincipal;
    sessionId: string;
    customerId: string;
    channel: ConfirmationApprovalCapabilityPayload['channel'];
    sessionGeneration: number;
    checkpointThreadId: string;
    checkpointNamespace: string;
    now?: number;
  },
): Promise<boolean> {
  if (
    !authority ||
    !verifiedGuestApprovalAuthorityIsIssued(authority) ||
    !isGuestCheckoutPrincipal(input.principal)
  ) {
    return false;
  }
  return (
    authority.sessionId === input.sessionId &&
    authority.customerId === input.customerId &&
    authority.channel === input.channel &&
    authority.sessionGeneration === input.sessionGeneration &&
    authority.checkpointThreadId ===
      input.checkpointThreadId &&
    authority.checkpointNamespace ===
      input.checkpointNamespace &&
    Date.parse(authority.expiresAt) > (input.now ?? Date.now()) &&
    authority.principalDigest ===
      await digestCommerceAction(input.principal)
  );
}

export async function verifiedGuestApprovalAuthorityAllowsContinuation(
  authority: VerifiedGuestConfirmationApprovalAuthority | undefined,
  input: {
    principal: CommerceApprovalPrincipal;
    sessionId: string;
    customerId: string;
    channel: ConfirmationApprovalCapabilityPayload['channel'];
    sessionGeneration: number;
    checkpointThreadId: string;
    checkpointNamespace: string;
    checkpointId: string;
    toolName: string;
    now?: number;
  },
): Promise<boolean> {
  return (
    await verifiedGuestApprovalAuthorityMatchesPrincipal(
      authority,
      input,
    ) &&
    authority?.toolName === 'placeOrder' &&
    input.toolName === 'createPaymentLink' &&
    authority.checkpointId !== input.checkpointId
  );
}

async function payloadMatchesSnapshot(
  payload: ConfirmationApprovalCapabilityPayload,
  snapshot: ConfirmationPauseStorageSnapshot,
): Promise<boolean> {
  const pause = snapshot.record;
  const commonMatches =
    payload.requestId === pause.requestId &&
    payload.sessionId === pause.sessionId &&
    payload.customerId === pause.customerId &&
    payload.channel === pause.channel &&
    payload.toolName === pause.action.toolName &&
    payload.actionDigest === pause.actionDigest &&
    payload.approvalBindingDigest === pause.approvalBindingDigest &&
    payload.checkpointThreadId === pause.checkpointThreadId &&
    payload.checkpointNamespace === pause.checkpointNamespace &&
    payload.checkpointId === pause.checkpointId &&
    payload.sessionGeneration === snapshot.sessionGeneration &&
    payload.sessionAuthorityGeneration ===
      snapshot.sessionAuthorityGeneration &&
    payload.pauseIdentityDigest === snapshot.identityDigest &&
    Date.parse(payload.expiresAt) <= Date.parse(pause.expiresAt);
  if (!commonMatches) return false;
  if (payload.principalKind === 'authenticated_customer') {
    return (
      isAuthenticatedCommerceApprovalPrincipal(pause.principal) &&
      payload.authenticatedSubject ===
        pause.principal.authenticatedSubject &&
      payload.authenticationEvidenceRef ===
        pause.principal.authenticationEvidenceRef
    );
  }
  if (!isGuestCheckoutPrincipal(pause.principal)) return false;
  return (
    payload.guestAuthorityDigest ===
      pause.principal.guestAuthorityDigest &&
    payload.guestSessionAuthorityGeneration ===
      pause.principal.sessionAuthorityGeneration &&
    payload.sourceRunKind === pause.principal.sourceRunKind &&
    payload.sourceRunGeneration ===
      pause.principal.sourceRunGeneration &&
    payload.sourceRunFenceDigest ===
      pause.principal.sourceRunFenceDigest &&
    payload.guestPrincipalDigest ===
      await principalDigest(snapshot) &&
    payload.sourceRunRefDigest ===
      await digestCommerceAction(pause.principal.sourceRunRef) &&
    payload.externalMessageIdDigest ===
      await digestCommerceAction(pause.principal.externalMessageId)
  );
}

export async function issueConfirmationApprovalCapability(input: {
  snapshot: ConfirmationPauseStorageSnapshot;
  accessContext: CustomerAccessContext | undefined;
  keyRing: ConfirmationApprovalKeyRing;
  guestCheckoutAuthority?: GuestCheckoutAuthority;
  verifiedGuestAuthority?: VerifiedGuestConfirmationApprovalAuthority;
  verifiedGuestContinuationAuthority?:
    VerifiedGuestConfirmationApprovalAuthority;
  now?: Date;
  ttlMs?: number;
}): Promise<IssuedConfirmationApprovalCapability> {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const ttlMs = input.ttlMs ?? defaultApprovalCapabilityTtlMs;
  if (
    !Number.isInteger(ttlMs) ||
    ttlMs < 1 ||
    ttlMs > maximumApprovalCapabilityTtlMs
  ) {
    throw new Error('confirmation_approval_capability_ttl_invalid');
  }
  const pause = await parseConfirmationPauseRecord(
    input.snapshot.record,
  );
  const authenticated =
    isAuthenticatedCommerceApprovalPrincipal(pause.principal);
  const guest =
    isGuestCheckoutPrincipal(pause.principal);
  if (
    pause.status !== 'pending' ||
    Date.parse(pause.expiresAt) <= nowMs ||
    input.snapshot.identityDigest !==
      await confirmationPauseIdentityDigest(pause) ||
    !(
      authenticated
        ? exactAccessContext({
            accessContext: input.accessContext,
            snapshot: input.snapshot,
            now: nowMs,
          })
        : guest && (
          await guestAuthorityMatchesSnapshot({
            authority: input.guestCheckoutAuthority,
            snapshot: input.snapshot,
            now: nowMs,
          }) ||
          await verifiedGuestApprovalAuthorityMatches(
            input.verifiedGuestAuthority,
            input.snapshot,
            nowMs,
          ) ||
          await verifiedGuestApprovalAuthorityAllowsContinuation(
            input.verifiedGuestContinuationAuthority,
            {
              principal: input.snapshot.record.principal,
              sessionId: input.snapshot.record.sessionId,
              customerId: input.snapshot.record.customerId,
              channel: input.snapshot.record.channel,
              sessionGeneration:
                input.snapshot.sessionAuthorityGeneration,
              checkpointThreadId:
                input.snapshot.record.checkpointThreadId,
              checkpointNamespace:
                input.snapshot.record.checkpointNamespace,
              checkpointId:
                input.snapshot.record.checkpointId,
              toolName: input.snapshot.record.action.toolName,
              now: nowMs,
            },
          )
        )
    )
  ) {
    throw new Error('confirmation_approval_capability_authority_invalid');
  }
  const expiresAt = new Date(Math.min(
    Date.parse(pause.expiresAt),
    nowMs + ttlMs,
    isGuestCheckoutPrincipal(pause.principal)
      ? Date.parse(pause.principal.expiresAt)
      : Number.POSITIVE_INFINITY,
    input.guestCheckoutAuthority
      ? Date.parse(input.guestCheckoutAuthority.expiresAt)
      : Number.POSITIVE_INFINITY,
    input.verifiedGuestAuthority
      ? Date.parse(input.verifiedGuestAuthority.expiresAt)
      : Number.POSITIVE_INFINITY,
    input.verifiedGuestContinuationAuthority
      ? Date.parse(
          input.verifiedGuestContinuationAuthority.expiresAt,
        )
      : Number.POSITIVE_INFINITY,
  )).toISOString();
  if (Date.parse(expiresAt) <= nowMs) {
    throw new Error('confirmation_approval_capability_expired');
  }
  const secret = input.keyRing.keys.get(input.keyRing.activeKeyId);
  if (!secret) {
    throw new Error('confirmation_approval_active_signing_key_missing');
  }
  const commonPayload = {
    schemaVersion: approvalCapabilitySchemaVersion,
    keyId: input.keyRing.activeKeyId,
    requestId: pause.requestId,
    sessionId: pause.sessionId,
    customerId: pause.customerId,
    channel: pause.channel,
    toolName: pause.action.toolName,
    actionDigest: pause.actionDigest,
    approvalBindingDigest: pause.approvalBindingDigest,
    checkpointThreadId: pause.checkpointThreadId,
    checkpointNamespace: pause.checkpointNamespace,
    checkpointId: pause.checkpointId,
    sessionGeneration: input.snapshot.sessionGeneration,
    sessionAuthorityGeneration:
      input.snapshot.sessionAuthorityGeneration,
    pauseIdentityDigest: input.snapshot.identityDigest,
    issuedAt: now.toISOString(),
    expiresAt,
  } as const;
  const payload = isAuthenticatedCommerceApprovalPrincipal(
    pause.principal,
  )
    ? confirmationApprovalCapabilityPayloadSchema.parse({
          ...commonPayload,
          principalKind: 'authenticated_customer',
          authenticatedSubject:
            pause.principal.authenticatedSubject,
          authenticationEvidenceRef:
            pause.principal.authenticationEvidenceRef,
        })
    : confirmationApprovalCapabilityPayloadSchema.parse({
          ...commonPayload,
          principalKind: 'guest_checkout',
          guestPrincipalDigest: await principalDigest(input.snapshot),
          guestAuthorityDigest:
            pause.principal.guestAuthorityDigest,
          guestSessionAuthorityGeneration:
            pause.principal.sessionAuthorityGeneration,
          sourceRunKind: pause.principal.sourceRunKind,
          sourceRunRefDigest:
            await digestCommerceAction(pause.principal.sourceRunRef),
          sourceRunGeneration:
            pause.principal.sourceRunGeneration,
          sourceRunFenceDigest:
            pause.principal.sourceRunFenceDigest,
          externalMessageIdDigest:
            await digestCommerceAction(
              pause.principal.externalMessageId,
            ),
        });
  const encodedPayload = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return {
    approvalCapability:
      `${encodedPayload}.${await signPayload(encodedPayload, secret)}`,
    expiresAt,
  };
}

export async function verifyConfirmationApprovalCapability(input: {
  approvalCapability: string;
  snapshot: ConfirmationPauseStorageSnapshot;
  keyRing: ConfirmationApprovalKeyRing;
  now?: Date;
}): Promise<VerifyConfirmationApprovalCapabilityResult> {
  if (
    input.approvalCapability.length < 1 ||
    input.approvalCapability.length > maximumApprovalCapabilityLength
  ) {
    return { ok: false, errorCode: 'approval_capability_invalid' };
  }
  const segments = input.approvalCapability.split('.');
  if (segments.length !== 2) {
    return { ok: false, errorCode: 'approval_capability_invalid' };
  }
  const [encodedPayload, encodedSignature] = segments;
  const payloadBytes = encodedPayload
    ? decodeBase64Url(encodedPayload)
    : undefined;
  if (!payloadBytes || !encodedSignature) {
    return { ok: false, errorCode: 'approval_capability_invalid' };
  }
  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes),
    ) as unknown;
  } catch {
    return { ok: false, errorCode: 'approval_capability_invalid' };
  }
  const parsed = confirmationApprovalCapabilityPayloadSchema.safeParse(
    rawPayload,
  );
  if (!parsed.success) {
    return { ok: false, errorCode: 'approval_capability_invalid' };
  }
  const secret = input.keyRing.keys.get(parsed.data.keyId);
  if (
    !secret ||
    !await signatureIsValid({
      encodedPayload,
      encodedSignature,
      secret,
    })
  ) {
    return { ok: false, errorCode: 'approval_capability_invalid' };
  }
  const nowMs = (input.now ?? new Date()).getTime();
  if (
    Date.parse(parsed.data.issuedAt) > nowMs + 60_000 ||
    Date.parse(parsed.data.expiresAt) <= nowMs
  ) {
    return { ok: false, errorCode: 'approval_capability_expired' };
  }
  const pause = await parseConfirmationPauseRecord(
    input.snapshot.record,
  );
  if (
    pause.status !== 'pending' ||
    input.snapshot.identityDigest !==
      await confirmationPauseIdentityDigest(pause) ||
    !await payloadMatchesSnapshot(parsed.data, input.snapshot)
  ) {
    return { ok: false, errorCode: 'approval_capability_invalid' };
  }
  const guestPrincipal = isGuestCheckoutPrincipal(pause.principal)
    ? pause.principal
    : undefined;
  const guestAuthority =
    parsed.data.principalKind === 'guest_checkout' && guestPrincipal
      ? Object.freeze({
          requestId: parsed.data.requestId,
          principalDigest: parsed.data.guestPrincipalDigest,
          principal: guestPrincipal,
          guestAuthorityDigest:
            guestPrincipal.guestAuthorityDigest,
          tenantScope: guestPrincipal.tenantScope,
          surfaceSubjectRef: guestPrincipal.surfaceSubjectRef,
          externalThreadRef: guestPrincipal.externalThreadRef,
          externalMessageId: guestPrincipal.externalMessageId,
          ingressEvidenceRef: guestPrincipal.ingressEvidenceRef,
          ingressEvidenceDigest:
            guestPrincipal.ingressEvidenceDigest,
          sourceRunFenceDigest:
            guestPrincipal.sourceRunFenceDigest,
          sessionId: parsed.data.sessionId,
          customerId: parsed.data.customerId,
          channel: parsed.data.channel,
          sessionGeneration:
            parsed.data.sessionAuthorityGeneration,
          checkpointThreadId: parsed.data.checkpointThreadId,
          checkpointNamespace: parsed.data.checkpointNamespace,
          checkpointId: parsed.data.checkpointId,
          toolName: parsed.data.toolName,
          actionDigest: parsed.data.actionDigest,
          approvalBindingDigest:
            parsed.data.approvalBindingDigest,
          pauseIdentityDigest: parsed.data.pauseIdentityDigest,
          expiresAt: parsed.data.expiresAt,
        })
      : undefined;
  if (guestAuthority) {
    markVerifiedGuestApprovalAuthorityIssued(guestAuthority);
  }
  return {
    ok: true,
    payload: parsed.data,
    signingSecret: secret,
    ...(guestAuthority ? { guestAuthority } : {}),
  };
}
