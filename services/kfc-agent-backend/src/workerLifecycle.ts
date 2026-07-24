import {
  D1LifecycleRepository,
  SandboxLifecycleControls,
  lifecycleBinding,
} from './commerce/lifecycleProvider.js';
import type { WorkerEnv } from './worker.js';

export function workerSessionResetHook(env: WorkerEnv) {
  return async (sessionId: string) => {
    const repository = new D1LifecycleRepository(env.DB);
    const controls = new SandboxLifecycleControls(repository);
    const sessionBinding = await workerBindingHash(`session:${sessionId}`);
    for (const instance of await repository.activeBySessionBinding(
      'sandbox',
      sessionBinding,
    )) {
      await controls.seal(lifecycleBinding(instance), {
        expectedRevision: instance.revision,
        idempotencyKey: `session-reset:${sessionId}:${instance.instanceId}:${instance.revision}`,
        requestFingerprint: await workerBindingHash(
          `session-reset:${sessionId}:${instance.instanceId}:${instance.revision}`,
        ),
        actor: 'session-reset',
      });
    }
  };
}

export async function workerBindingHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
