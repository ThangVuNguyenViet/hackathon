const IPV4_LITERAL = /^(?:\d{1,3}\.){3}\d{1,3}$/u;
const MAX_BUSINESS_WEB_URL_LENGTH = 2_048;

export class BusinessWebEvidenceError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'BusinessWebEvidenceError';
    this.code = code;
  }
}

function isIpLiteral(hostname: string): boolean {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return true;
  }
  if (!IPV4_LITERAL.test(hostname)) {
    return false;
  }
  return hostname
    .split('.')
    .every((part) => Number(part) >= 0 && Number(part) <= 255);
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/u, '');
}

export function normalizeAllowedHostnames(
  allowedHostnames: readonly string[],
): readonly string[] {
  if (allowedHostnames.length === 0) {
    throw new BusinessWebEvidenceError('web_allowlist_required');
  }

  const normalized = allowedHostnames.map((candidate) => {
    const trimmed = candidate.trim();
    if (
      trimmed.length === 0 ||
      trimmed.includes('/') ||
      trimmed.includes('@') ||
      trimmed.includes('?') ||
      trimmed.includes('#') ||
      trimmed.includes(':')
    ) {
      throw new BusinessWebEvidenceError('web_allowlist_hostname_invalid');
    }

    let parsed: URL;
    try {
      parsed = new URL(`https://${trimmed}`);
    } catch {
      throw new BusinessWebEvidenceError('web_allowlist_hostname_invalid');
    }
    const hostname = normalizeHostname(parsed.hostname);
    if (hostname.length === 0 || parsed.pathname !== '/') {
      throw new BusinessWebEvidenceError('web_allowlist_hostname_invalid');
    }
    if (isIpLiteral(hostname)) {
      throw new BusinessWebEvidenceError(
        'web_allowlist_ip_literal_not_allowed',
      );
    }
    return hostname;
  });

  return [...new Set(normalized)];
}

export function validateBusinessWebUrl(
  candidate: string,
  allowedHostnames: readonly string[],
): string {
  const normalizedAllowlist = normalizeAllowedHostnames(allowedHostnames);
  if (candidate.length > MAX_BUSINESS_WEB_URL_LENGTH) {
    throw new BusinessWebEvidenceError('web_url_too_long');
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new BusinessWebEvidenceError('web_url_invalid');
  }

  if (url.protocol !== 'https:') {
    throw new BusinessWebEvidenceError('web_url_https_required');
  }
  // WHATWG URL canonicalization removes an explicit default `:443`, while
  // preserving every non-default port here.
  if (url.port.length > 0) {
    throw new BusinessWebEvidenceError('web_url_port_not_allowed');
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new BusinessWebEvidenceError('web_url_credentials_not_allowed');
  }
  if (url.hash.length > 0) {
    throw new BusinessWebEvidenceError('web_url_fragment_not_allowed');
  }

  const hostname = normalizeHostname(url.hostname);
  if (isIpLiteral(hostname)) {
    throw new BusinessWebEvidenceError('web_url_ip_literal_not_allowed');
  }
  if (!normalizedAllowlist.includes(hostname)) {
    throw new BusinessWebEvidenceError('web_url_host_not_allowed');
  }

  url.hostname = hostname;
  const normalized = url.toString();
  if (normalized.length > MAX_BUSINESS_WEB_URL_LENGTH) {
    throw new BusinessWebEvidenceError('web_url_too_long');
  }
  return normalized;
}

export function boundEvidenceText(
  value: unknown,
  maximumLength: number,
): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.slice(0, maximumLength);
}

export function optionalBoundedEvidenceText(
  value: unknown,
  maximumLength: number,
): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  return value.slice(0, maximumLength);
}
