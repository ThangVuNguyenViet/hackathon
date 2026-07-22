import type { ToolResult } from '../domain/types.js';

export const mockProviderProvenance = [
  {
    fixtureMode: 'provider_runtime' as const,
    sourceFile: 'src/mock/createMockClients.ts',
    sourceApi: 'mock-commerce-provider',
  },
];

export function mockSuccess<T>(value: T, message = 'ok'): ToolResult<T> {
  return { ok: true, value, message, provenance: mockProviderProvenance };
}

export function mockFailure<T>(
  errorCode: string,
  message: string,
): ToolResult<T> {
  return { ok: false, errorCode, message, provenance: mockProviderProvenance };
}

export function withMockProvenance<T>(result: ToolResult<T>): ToolResult<T> {
  return {
    ...result,
    provenance: result.provenance?.length
      ? result.provenance
      : mockProviderProvenance,
  };
}
