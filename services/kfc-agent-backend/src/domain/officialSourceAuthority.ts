import { createHash } from 'node:crypto';
import { z } from 'zod';

export const OFFICIAL_SOURCE_AUTHORITY_ISSUER =
  'kfc-policy-ingestion-v1' as const;
export const OFFICIAL_SOURCE_PAYLOAD_SCHEMA_VERSION =
  'kfc-official-content-payload-v1' as const;
export const OFFICIAL_CONTENT_SNIPPET_MAX_CHARS = 1_334;

export const officialSourceAuthoritySchema = z.object({
  kind: z.literal('official_kfc'),
  issuer: z.literal(OFFICIAL_SOURCE_AUTHORITY_ISSUER),
  authorityRef: z.string().trim().min(1),
  subject: z.string().trim().min(1),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  attestedAt: z.string().trim().min(1),
}).strict();

export type OfficialSourceAuthority = z.infer<
  typeof officialSourceAuthoritySchema
>;

export interface OfficialSourcePayload {
  id: string;
  kind: 'policy' | 'allergen';
  title: string;
  snippet: string;
  sourceUrl: string;
  sourceFile: string;
  tags?: readonly string[];
  retrievedAt?: string;
  approvedAt: string;
  approvalStatus: 'approved';
  audience: 'customer_public';
}

/**
 * Reviewed release attestation for the exact governed-content inventory.
 *
 * A caller-controlled id/hash/date tuple is not an authority. A section is
 * official only when its recomputed canonical payload digest is pinned here.
 * Changes to source content or governed metadata therefore require review of
 * this manifest in the same change.
 */
const TRUSTED_OFFICIAL_SOURCE_REVISIONS: Readonly<Record<string, string>> = {
  'policy/allergens/cach-tra-cuu-bang-di-ung':
    '5115b462fe41b7b65a6341cffcc8b4de0ad53c39c814e55a5a204e518eaf2553',
  'policy/contact/kenh-lien-he':
    'ebdaac4e97f3f727429737b977817a89fa8b83233f90a679ca510d86ff1869ce',
  'policy/order-support/theo-doi-va-nhan-don':
    '5914b8dbad12c132a2171195817ff33131ebe8dcff31c957b086ad5dd4cc2dc7',
  'policy/ordering-and-delivery/dat-hang-va-thanh-toan':
    'd3ecf24bfb5ed451e7d17fe6555acd60dbcd12b9bef69e5755c0be69919e083c',
  'policy/ordering-and-delivery/gia-tri-don-toi-thieu-va-phi-giao-hang':
    '1605c65b8e6cc4d3519200e182d651c847f5fe555a3d2158737153a317a4a8e0',
  'policy/ordering-and-delivery/nhan-hang-va-hoa-don-vat':
    '6f13c84f8ddb916f9cc44f6a0fe9fcd14e43430309a9fc9e73161ef0d45c1cf5',
  'policy/ordering-and-delivery/thay-doi-don-va-chat-luong-mon':
    '5cd0f87fef37a636d90b422b6b1b5602e12ce78775c1804a33f5e4696dbeb40f',
  'policy/privacy/pham-vi-chinh-sach':
    '062605e25bf6d7c9f4495b857de1dc0a4959681ee68fe99e0d4369f21063e859',
  'policy/privacy/thu-thap-va-su-dung-thong-tin':
    '563d98a976d7b65df7fa8d8bb2a357ee28665f30bf76698fa4e2d0e7082b0916',
  'policy/privacy/bao-ve-va-lua-chon-cua-khach-hang':
    'a969dd331c2ef132329cfb4290831e9209daab674b7197fce9524fd818e0ab9f',
  'policy/terms/chap-thuan-va-thay-doi-dieu-khoan':
    '2302f22cd93038af5bbabfa36d304015894c8b0c67fe557acab4a6534c0b7031',
  'policy/terms/bao-mat-tai-khoan':
    '20d132c0296374b8f7d3f21e9f4b45002627ac50be46370e4d0f4066c2bb3d19',
  'policy/terms/su-dung-website':
    'f0779a4233b4aad8961161476fed48097efe1ca145af97d1ee1a21157dbe3b74',
};

function canonicalOfficialSourcePayload(input: OfficialSourcePayload): string {
  return JSON.stringify({
    schemaVersion: OFFICIAL_SOURCE_PAYLOAD_SCHEMA_VERSION,
    id: input.id,
    kind: input.kind,
    title: input.title,
    snippet: input.snippet,
    sourceUrl: input.sourceUrl,
    sourceFile: input.sourceFile,
    tags: [...(input.tags ?? [])],
    retrievedAt: input.retrievedAt ?? null,
    approvedAt: input.approvedAt,
    approvalStatus: input.approvalStatus,
    audience: input.audience,
  });
}

export function officialSourceRevisionFor(
  input: OfficialSourcePayload,
): string {
  return createHash('sha256')
    .update(canonicalOfficialSourcePayload(input))
    .digest('hex');
}

function trustedRevisionFor(
  input: OfficialSourcePayload,
): string | undefined {
  const revision = officialSourceRevisionFor(input);
  return TRUSTED_OFFICIAL_SOURCE_REVISIONS[input.id] === revision
    ? revision
    : undefined;
}

export function officialSourceAuthorityFor(
  input: OfficialSourcePayload,
): OfficialSourceAuthority {
  const revision = trustedRevisionFor(input);
  if (!revision) {
    throw new Error(
      `official source payload is not in the reviewed inventory: ${input.id}`,
    );
  }
  return {
    kind: 'official_kfc',
    issuer: OFFICIAL_SOURCE_AUTHORITY_ISSUER,
    authorityRef: `kfc-official-content:${input.id}`,
    subject: input.id,
    revision,
    attestedAt: input.approvedAt,
  };
}

export function isOfficialSourceAuthorityFor(
  raw: unknown,
  input: OfficialSourcePayload,
): raw is OfficialSourceAuthority {
  const parsed = officialSourceAuthoritySchema.safeParse(raw);
  const revision = trustedRevisionFor(input);
  if (!parsed.success || !revision) return false;
  return parsed.data.authorityRef ===
      `kfc-official-content:${input.id}` &&
    parsed.data.subject === input.id &&
    parsed.data.revision === revision &&
    parsed.data.attestedAt === input.approvedAt;
}

export function sameOfficialSourceAuthority(
  left: unknown,
  right: unknown,
): boolean {
  const parsedLeft = officialSourceAuthoritySchema.safeParse(left);
  const parsedRight = officialSourceAuthoritySchema.safeParse(right);
  return parsedLeft.success &&
    parsedRight.success &&
    parsedLeft.data.kind === parsedRight.data.kind &&
    parsedLeft.data.issuer === parsedRight.data.issuer &&
    parsedLeft.data.authorityRef === parsedRight.data.authorityRef &&
    parsedLeft.data.subject === parsedRight.data.subject &&
    parsedLeft.data.revision === parsedRight.data.revision &&
    parsedLeft.data.attestedAt === parsedRight.data.attestedAt;
}
