export type EvidenceSanitizer = (value: unknown, key?: string) => unknown;

export function createEvidenceSanitizer(
  configuredSecrets: readonly string[] = [],
): EvidenceSanitizer {
  const exactSecrets = [
    ...new Set(
      configuredSecrets
        .map((value) => value.trim())
        .filter((value) => value.length >= 8),
    ),
  ].sort((left, right) => right.length - left.length);

  const sanitize = (value: unknown, key = ''): unknown => {
    if (sensitiveKey(key)) return '[REDACTED]';
    if (value instanceof Error) {
      return sanitize({ name: value.name, message: value.message });
    }
    if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
    if (isRecord(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([entryKey, entry]) => [
          entryKey,
          sanitize(entry, entryKey),
        ]),
      );
    }
    if (typeof value !== 'string') return value;
    let sanitized = value;
    for (const secret of exactSecrets) {
      sanitized = sanitized.split(secret).join('[REDACTED]');
    }
    return sanitized
      .replace(/\bBearer\s+[^\s"',}]+/giu, 'Bearer [REDACTED]')
      .replace(
        /\b((?:password|api[_-]?key|access[_-]?token|page[_-]?access[_-]?token|meta[_-]?(?:app[_-]?secret|page[_-]?access[_-]?token|token)|authorization|x-api-key|x-meta-token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s;,}\]]+)/giu,
        '$1[REDACTED]',
      )
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, '[REDACTED]');
  };
  return sanitize;
}

function sensitiveKey(key: string): boolean {
  return /(?:authorization|api[-_]?key|access[-_]?token|secret|password|cookie|signature)/iu.test(
    key,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
