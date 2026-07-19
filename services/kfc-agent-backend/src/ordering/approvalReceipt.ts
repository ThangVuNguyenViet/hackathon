import { z } from 'zod';
import type {
  CommerceApprovalBinding,
  CommerceApprovalCapability,
  CommerceApprovalPrincipal,
  CommerceApprovalReceipt,
  CommerceAuthorityRevisions,
} from './types.js';

const approvalPrincipalSchema = z.object({
  sessionId: z.string().min(1),
  customerId: z.string().min(1),
  channel: z.enum(['messenger', 'zalo', 'kfc', 'messenger_mock', 'zalo_mock']),
  authenticatedSubject: z.string().min(1),
  authenticationEvidenceRef: z.string().min(1),
}).strict();

const authorityRevisionsSchema = z.object({
  cartRevision: z.string().min(1),
  fulfillmentRevision: z.string().min(1),
  paymentRevision: z.string().min(1),
  collectionRevision: z.string().min(1),
  providerRevision: z.string().min(1),
}).strict();

export const commerceApprovalBindingSchema = z.object({
  schemaVersion: z.literal('kfc-commerce-approval-v1'),
  capability: z.enum([
    'placeOrder',
    'createPaymentLink',
    'acquireVoucher',
    'redeemReward',
    'handoff',
  ]),
  principal: approvalPrincipalSchema,
  actionDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  revisions: authorityRevisionsSchema,
}).strict();

export const commerceApprovalReceiptSchema = z.object({
  receiptId: z.string().uuid(),
  binding: commerceApprovalBindingSchema,
  decision: z.enum(['approve', 'reject']),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  signature: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

type ApprovalSecret = string | Uint8Array;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function secretBytes(secret: ApprovalSecret): Uint8Array {
  const bytes = typeof secret === 'string' ? new TextEncoder().encode(secret) : secret;
  if (bytes.byteLength < 32) {
    throw new Error('Commerce approval signing secret must contain at least 32 bytes');
  }
  return bytes;
}

async function hmacKey(secret: ApprovalSecret, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    secretBytes(secret) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usage,
  );
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(value: string): Uint8Array {
  return new Uint8Array(value.match(/.{2}/gu)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
}

function signedReceiptPayload(receipt: Omit<CommerceApprovalReceipt, 'signature'>): string {
  return canonicalJson(receipt);
}

export async function digestCommerceAction(action: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson(action)),
  );
  return hex(digest);
}

export async function buildCommerceApprovalBinding(input: {
  capability: CommerceApprovalCapability;
  principal: CommerceApprovalPrincipal;
  revisions: CommerceAuthorityRevisions;
  action: unknown;
}): Promise<CommerceApprovalBinding> {
  return commerceApprovalBindingSchema.parse({
    schemaVersion: 'kfc-commerce-approval-v1',
    capability: input.capability,
    principal: input.principal,
    actionDigest: await digestCommerceAction(input.action),
    revisions: input.revisions,
  });
}

export async function createCommerceApprovalReceipt(input: {
  binding: CommerceApprovalBinding;
  secret: ApprovalSecret;
  decision?: CommerceApprovalReceipt['decision'];
  receiptId?: string;
  issuedAt?: Date;
  ttlMs?: number;
}): Promise<CommerceApprovalReceipt> {
  const issuedAt = input.issuedAt ?? new Date();
  const ttlMs = input.ttlMs ?? 5 * 60_000;
  if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > 15 * 60_000) {
    throw new Error('Commerce approval receipt TTL must be between 1 ms and 15 minutes');
  }
  const unsigned = {
    receiptId: input.receiptId ?? crypto.randomUUID(),
    binding: commerceApprovalBindingSchema.parse(input.binding),
    decision: input.decision ?? 'approve',
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + ttlMs).toISOString(),
  };
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(input.secret, ['sign']),
    new TextEncoder().encode(signedReceiptPayload(unsigned)),
  );
  return commerceApprovalReceiptSchema.parse({ ...unsigned, signature: hex(signature) });
}

export type CommerceApprovalVerification =
  | { ok: true; receipt: CommerceApprovalReceipt }
  | {
      ok: false;
      errorCode:
        | 'invalid_approval_receipt'
        | 'approval_binding_mismatch'
        | 'approval_receipt_expired'
        | 'approval_receipt_not_yet_valid';
    };

export async function verifyCommerceApprovalReceipt(input: {
  receipt: unknown;
  expectedBinding: CommerceApprovalBinding;
  secret: ApprovalSecret;
  now?: Date;
}): Promise<CommerceApprovalVerification> {
  const parsed = commerceApprovalReceiptSchema.safeParse(input.receipt);
  if (!parsed.success) return { ok: false, errorCode: 'invalid_approval_receipt' };

  const receipt = parsed.data;
  const unsigned = {
    receiptId: receipt.receiptId,
    binding: receipt.binding,
    decision: receipt.decision,
    issuedAt: receipt.issuedAt,
    expiresAt: receipt.expiresAt,
  };
  const signatureValid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(input.secret, ['verify']),
    fromHex(receipt.signature) as BufferSource,
    new TextEncoder().encode(signedReceiptPayload(unsigned)),
  );
  if (!signatureValid) return { ok: false, errorCode: 'invalid_approval_receipt' };
  if (canonicalJson(receipt.binding) !== canonicalJson(input.expectedBinding)) {
    return { ok: false, errorCode: 'approval_binding_mismatch' };
  }

  const now = (input.now ?? new Date()).getTime();
  if (Date.parse(receipt.expiresAt) <= now) {
    return { ok: false, errorCode: 'approval_receipt_expired' };
  }
  if (Date.parse(receipt.issuedAt) > now + 60_000) {
    return { ok: false, errorCode: 'approval_receipt_not_yet_valid' };
  }
  return { ok: true, receipt };
}
