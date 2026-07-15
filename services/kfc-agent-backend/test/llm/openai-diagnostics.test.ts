import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertOpenAiResponseOk,
  createOpenAiRequestMetadata,
  openAiRequestHeaders,
  OpenAiHttpError,
} from '../../src/llm/openAiDiagnostics.js';

afterEach(() => vi.restoreAllMocks());

describe('OpenAI diagnostics', () => {
  it('retains request correlation and placement metadata without logging sensitive content', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const request = createOpenAiRequestMetadata('tool planning', 'gpt-test', {
      workerRelease: 'version-123',
      executionColo: 'SIN',
      placement: 'remote-SIN',
    });
    const headers = openAiRequestHeaders('secret-api-key', request);
    const response = new Response(null, {
      status: 403,
      headers: { 'x-request-id': 'req_openai_123' },
    });
    const body = {
      error: {
        message: 'Country, region, or territory not supported: private customer text',
        type: 'invalid_request_error',
        code: 'unsupported_country_region_territory',
      },
      prompt: 'private customer text',
      apiKey: 'secret-api-key',
    };

    expect(() => assertOpenAiResponseOk(response, body, request)).toThrow(OpenAiHttpError);
    expect(headers['X-Client-Request-Id']).toBe(request.clientRequestId);
    const logged = String(info.mock.calls[0]?.[0]);
    expect(JSON.parse(logged)).toMatchObject({
      event: 'openai_api_response',
      outcome: 'failure',
      httpStatus: 403,
      apiErrorType: 'invalid_request_error',
      apiErrorCode: 'unsupported_country_region_territory',
      openAiRequestId: 'req_openai_123',
      clientRequestId: request.clientRequestId,
      workerRelease: 'version-123',
      executionColo: 'SIN',
      placement: 'remote-SIN',
      model: 'gpt-test',
      component: 'tool planning',
    });
    expect(logged).not.toContain('private customer text');
    expect(logged).not.toContain('secret-api-key');
  });
});
