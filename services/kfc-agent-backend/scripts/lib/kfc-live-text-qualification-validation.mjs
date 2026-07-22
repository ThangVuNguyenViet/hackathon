const credentialLikeText = new RegExp(
  String.raw`(?:\bsk-(?:proj-)?[a-z0-9_-]{6,}\b|\bbearer\s+[a-z0-9._~+/=-]+|\b(?:authorization|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|password|secret|(?:customer|user|order|session|conversation|message|external)[ _-]?(?:id|identifier)|private[ _-]?args)\b["']?\s*(?:(?::|=)\s*|\s+is\s+)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+))`,
  'iu',
);

export function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

export function assertExactKeys(value, expected, label) {
  const keys = Object.keys(value).sort();
  const required = [...expected].sort();
  if (JSON.stringify(keys) !== JSON.stringify(required)) {
    throw new Error(`${label} has an invalid shape`);
  }
}

export function assertIsoTimestamp(value, label) {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return Date.parse(value);
}

export function assertSafeText(value, label) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    credentialLikeText.test(value)
  ) {
    throw new Error(`${label} must be non-empty redacted text`);
  }
}

export function assertIdentity(value, expected, label) {
  const identity = assertObject(value, label);
  assertExactKeys(identity, ['model', 'profile', 'provider'], label);
  if (
    identity.provider !== expected.provider ||
    identity.model !== expected.model ||
    identity.profile !== expected.profile
  ) {
    throw new Error(`${label} does not match the repository-pinned profile`);
  }
}

export function assertInventory(value, label) {
  const inventory = assertObject(value, label);
  assertExactKeys(
    inventory,
    ['digest', 'scenarioCount', 'turnCount', 'version'],
    label,
  );
  if (
    typeof inventory.version !== 'string' ||
    !inventory.version ||
    typeof inventory.digest !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(inventory.digest) ||
    !Number.isInteger(inventory.scenarioCount) ||
    inventory.scenarioCount < 1 ||
    !Number.isInteger(inventory.turnCount) ||
    inventory.turnCount < 1
  ) {
    throw new Error(`${label} is invalid`);
  }
  return inventory;
}
