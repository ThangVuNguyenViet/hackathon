import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

type BindTools = NonNullable<BaseChatModel['bindTools']>;
type BoundChatModel = ReturnType<BindTools>;

export function controlledRetryCanaryRequested(input: {
  forceFirstRetry: string | undefined;
  liveRequested: boolean;
  qualificationRequested: boolean;
}): boolean {
  const requested = input.forceFirstRetry === '1';
  if (requested && input.qualificationRequested) {
    throw new Error(
      'KFC_LIVE_FORCE_FIRST_RETRY is forbidden during live qualification',
    );
  }
  return requested && input.liveRequested;
}

function boundProperty<Target extends object>(
  target: Target,
  property: string | symbol,
): unknown {
  const value: unknown = Reflect.get(target, property, target);
  return typeof value === 'function'
    ? value.bind(target)
    : value;
}

export function forceFirstBoundInvokeRetryableFailure(
  model: BaseChatModel,
): BaseChatModel {
  let firstBoundInvocationPending = true;

  return new Proxy(model, {
    get(target, property) {
      if (property !== 'bindTools') {
        return boundProperty(target, property);
      }
      const bindTools = target.bindTools;
      if (!bindTools) return undefined;
      const wrappedBindTools: BindTools = (...arguments_) => {
        const bound = bindTools.apply(target, arguments_);
        return new Proxy(bound, {
          get(boundTarget, boundPropertyName) {
            if (boundPropertyName !== 'invoke') {
              return boundProperty(boundTarget, boundPropertyName);
            }
            const wrappedInvoke: BoundChatModel['invoke'] = async (
              input,
              options,
            ) => {
              if (firstBoundInvocationPending) {
                firstBoundInvocationPending = false;
                throw Object.assign(
                  new Error('controlled_retry_canary_first_invoke'),
                  { status: 503 as const },
                );
              }
              return boundTarget.invoke(input, options);
            };
            return wrappedInvoke;
          },
        });
      };
      return wrappedBindTools;
    },
  });
}
