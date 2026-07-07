import type { BuildServerOptions } from './server.js';
import type { AppEnv } from '../config/env.js';

function optionalValue(value: string): string | undefined {
  return value.length > 0 ? value : undefined;
}

export function buildServerOptionsFromEnv(env: AppEnv): BuildServerOptions {
  return {
    messengerVerifyToken: optionalValue(env.MESSENGER_VERIFY_TOKEN),
    metaPageId: optionalValue(env.META_PAGE_ID),
    messengerPageAccessToken: optionalValue(env.META_PAGE_ACCESS_TOKEN),
    messengerGraphApiBaseUrl: optionalValue(env.MESSENGER_GRAPH_API_BASE_URL),
    zaloOaId: optionalValue(env.ZALO_OA_ID),
    zaloAccessToken: optionalValue(env.ZALO_ACCESS_TOKEN),
    zaloApiBaseUrl: optionalValue(env.ZALO_API_BASE_URL),
  };
}
