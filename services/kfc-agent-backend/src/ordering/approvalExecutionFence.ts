import { z } from 'zod';
import { digestCommerceAction } from './approvalReceipt.js';
import type {
  CommerceApprovalBinding,
  CommerceApprovalReceipt,
} from './types.js';

const commerceApprovalExecutionFenceClaimSchema = z.object({
  schemaVersion: z.literal('kfc-commerce-approval-execution-v1'),
  operation: z.literal('confirmation_resume'),
  requestId: z.string().uuid(),
  expectedSessionGeneration: z.number().int().nonnegative(),
  sessionAuthorityGeneration: z.number().int().nonnegative(),
  sourceTurnId: z.string().min(1),
  actionScope: z.string(),
  actionId: z.string().min(1),
  bindingFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  approvalBindingDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  providerIdempotencyKey: z.string().min(1).max(512),
  attempt: z.number().int().positive(),
  leaseToken: z.string().uuid(),
}).strict();

export const commerceApprovalExecutionFenceSchema =
  commerceApprovalExecutionFenceClaimSchema.extend({
    signature: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict();

export type CommerceApprovalExecutionFenceClaim = z.infer<
  typeof commerceApprovalExecutionFenceClaimSchema
>;

export type CommerceApprovalExecutionFence = z.infer<
  typeof commerceApprovalExecutionFenceSchema
>;

type ApprovalSecret = string | Uint8Array;
const executionFenceSignatureDomain =
  'kfc-commerce-approval-execution-fence-v1';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
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
  const bytes =
    typeof secret === 'string' ? new TextEncoder().encode(secret) : secret;
  if (bytes.byteLength < 32) {
    throw new Error(
      'Commerce approval signing secret must contain at least 32 bytes',
    );
  }
  return bytes;
}

async function hmacKey(
  secret: ApprovalSecret,
  usage: KeyUsage[],
): Promise<CryptoKey> {
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
  return new Uint8Array(
    value.match(/.{2}/gu)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );
}

function signedFencePayload(
  claim: CommerceApprovalExecutionFenceClaim,
): string {
  return `${executionFenceSignatureDomain}\0${canonicalJson(claim)}`;
}

function unsignedFence(
  fence: CommerceApprovalExecutionFence,
): CommerceApprovalExecutionFenceClaim {
  const { signature: _signature, ...claim } = fence;
  return claim;
}

export async function createCommerceApprovalExecutionFence(input: {
  claim: CommerceApprovalExecutionFenceClaim;
  secret: ApprovalSecret;
}): Promise<CommerceApprovalExecutionFence> {
  const claim = commerceApprovalExecutionFenceClaimSchema.parse(input.claim);
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(input.secret, ['sign']),
    new TextEncoder().encode(signedFencePayload(claim)),
  );
  return commerceApprovalExecutionFenceSchema.parse({
    ...claim,
    signature: hex(signature),
  });
}

/**
 * Proves that the durable confirmation coordinator already owns the exact
 * irreversible operation lease. This does not replace receipt verification or
 * current-authority recomputation; it only prevents a second claim of the same
 * one-use approval boundary inside the provider executor.
 */
export async function verifyCommerceApprovalExecutionFence(input: {
  fence: unknown;
  receipt: CommerceApprovalReceipt;
  binding: CommerceApprovalBinding;
  secret: ApprovalSecret;
}): Promise<CommerceApprovalExecutionFence | undefined> {
  const parsed = commerceApprovalExecutionFenceSchema.safeParse(input.fence);
  if (!parsed.success) return undefined;
  const claim = unsignedFence(parsed.data);
  const signatureValid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(input.secret, ['verify']),
    fromHex(parsed.data.signature) as BufferSource,
    new TextEncoder().encode(signedFencePayload(claim)),
  );
  if (!signatureValid) return undefined;
  if (
    parsed.data.requestId !== input.receipt.receiptId ||
    parsed.data.approvalBindingDigest !==
      await digestCommerceAction(input.binding)
  ) {
    return undefined;
  }
  return parsed.data;
}
