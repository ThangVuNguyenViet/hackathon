export type DemoAdminAuthorization =
  | { ok: true }
  | { ok: false; status: 401 | 503; errorCode: 'demo_admin_unauthorized' | 'demo_admin_token_not_configured' };

function tokenMatches(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export function authorizeDemoAdminHeaders(input: {
  expectedToken?: string;
  authorizationHeader?: string;
  tokenHeader?: string;
}): DemoAdminAuthorization {
  const expected = input.expectedToken?.trim();
  if (!expected) {
    return { ok: false, status: 503, errorCode: 'demo_admin_token_not_configured' };
  }
  const bearer = input.authorizationHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const headerToken = input.tokenHeader?.trim();
  if ((bearer && tokenMatches(bearer, expected)) || (headerToken && tokenMatches(headerToken, expected))) {
    return { ok: true };
  }
  return { ok: false, status: 401, errorCode: 'demo_admin_unauthorized' };
}
