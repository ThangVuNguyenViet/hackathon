import { validateBusinessWebUrl } from '../../web/businessWebEvidence.js';

export const KFC_WEB_ALLOWED_HOSTNAMES = Object.freeze([
  'kfcvietnam.com.vn',
  'www.kfcvietnam.com.vn',
  'membership.kfcvietnam.com.vn',
] as const);

export const KFC_WEB_OPERATION_TIMEOUT_MS = 4_000;
export const KFC_WEB_FETCH_TIMEOUT_MS = 3_000;
export const KFC_WEB_TURN_BUDGET_MS = 12_000;

const blockedPathNamespace =
  /^(?:api|newapi|invoice|static|uploads?|assets?|images?|img)(?:$|[-_.])/u;
const blockedStaticOrBinaryExtension =
  /\.(?:avif|bmp|css|csv|docx?|exe|gif|gz|ico|jpe?g|js|json|map|mov|mp3|mp4|otf|pdf|png|pptx?|rar|svg|tar|tiff?|ttf|wav|webm|webp|woff2?|xlsx?|xml|zip)$/u;

export function validateKfcPublicWebUrl(candidate: string): string {
  const normalized = validateBusinessWebUrl(
    candidate,
    KFC_WEB_ALLOWED_HOSTNAMES,
  );
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(normalized).pathname)
      .normalize('NFKC')
      .toLowerCase();
  } catch {
    throw new Error('kfc_web_path_not_allowed');
  }
  const segments = pathname.split('/').filter(Boolean);
  if (
    segments.some((segment) => blockedPathNamespace.test(segment)) ||
    blockedStaticOrBinaryExtension.test(segments.at(-1) ?? '')
  ) {
    throw new Error('kfc_web_path_not_allowed');
  }
  return normalized;
}

const inventoryCandidates = [
  'https://www.kfcvietnam.com.vn/',
  'https://www.kfcvietnam.com.vn/about-kfc',
  'https://www.kfcvietnam.com.vn/allergen-chart',
  'https://www.kfcvietnam.com.vn/big-order',
  'https://www.kfcvietnam.com.vn/book-party',
  'https://www.kfcvietnam.com.vn/contacta-con-kfc',
  'https://www.kfcvietnam.com.vn/he-thong-nha-hang-kfc',
  'https://www.kfcvietnam.com.vn/policy-information-confidentiality',
  'https://www.kfcvietnam.com.vn/privacy-policy',
  'https://www.kfcvietnam.com.vn/terms-condition',
  'https://membership.kfcvietnam.com.vn/',
] as const;

export const KFC_WEB_INVENTORY_URLS = Object.freeze(
  inventoryCandidates.map(validateKfcPublicWebUrl),
);
