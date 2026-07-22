import { z } from 'zod';

/**
 * Provider identifiers are opaque protocol values, not names or aliases.
 * Accepted values are preserved byte-for-byte throughout the application.
 */
export const OPAQUE_PROVIDER_ID_MAX_LENGTH = 2_048;

function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
  }
  return true;
}

function isProtocolWhitespace(codePoint: number): boolean {
  return (
    (codePoint >= 0x0009 && codePoint <= 0x000d) ||
    codePoint === 0x0020 ||
    codePoint === 0x0085 ||
    codePoint === 0x00a0 ||
    codePoint === 0x1680 ||
    (codePoint >= 0x2000 && codePoint <= 0x200a) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    codePoint === 0x202f ||
    codePoint === 0x205f ||
    codePoint === 0x3000 ||
    codePoint === 0xfeff
  );
}

function containsProtocolNonWhitespace(value: string): boolean {
  return [...value].some(
    (character) => !isProtocolWhitespace(character.codePointAt(0)!),
  );
}

function hasProtocolCanonicalEdges(value: string): boolean {
  const characters = [...value];
  const first = characters[0]?.codePointAt(0);
  const last = characters.at(-1)?.codePointAt(0);
  return (
    first !== undefined &&
    last !== undefined &&
    !isProtocolWhitespace(first) &&
    !isProtocolWhitespace(last)
  );
}

export const opaqueProviderIdSchema = z
  .string()
  .min(1)
  .max(OPAQUE_PROVIDER_ID_MAX_LENGTH)
  .refine(isWellFormedUtf16, {
    message: 'Provider identifier must contain well-formed UTF-16',
  })
  .refine(containsProtocolNonWhitespace, {
    message: 'Provider identifier must contain a non-whitespace character',
  })
  .refine(hasProtocolCanonicalEdges, {
    message: 'Provider identifier must not require normalization',
  });

const authorityRevisionSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine(isWellFormedUtf16, {
    message: 'Authority token must contain well-formed UTF-16',
  })
  .refine(containsProtocolNonWhitespace, {
    message: 'Authority token must contain a non-whitespace character',
  })
  .refine(hasProtocolCanonicalEdges, {
    message: 'Authority token must not require normalization',
  });

export const paymentMethodCollectionAuthoritySchema = z
  .object({
    collectionKey: authorityRevisionSchema,
    collectionRevision: authorityRevisionSchema,
    providerRevision: authorityRevisionSchema,
  })
  .strict();

export const selectedPaymentMethodAuthoritySchema =
  paymentMethodCollectionAuthoritySchema
    .extend({
      methodId: opaqueProviderIdSchema,
    })
    .strict();

export type PaymentMethodCollectionAuthority = z.infer<
  typeof paymentMethodCollectionAuthoritySchema
>;

export type SelectedPaymentMethodAuthority = z.infer<
  typeof selectedPaymentMethodAuthoritySchema
>;
