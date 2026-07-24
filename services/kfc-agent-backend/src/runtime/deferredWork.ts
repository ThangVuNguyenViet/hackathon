export type DeferredWork = () => Promise<void>;

export function startDeferredWork(task: DeferredWork): Promise<void> {
  return Promise.resolve().then(task);
}

export function runDetachedWork(
  task: DeferredWork,
  onError: (error: unknown) => void = () => undefined,
): void {
  void startDeferredWork(task).catch(onError);
}
