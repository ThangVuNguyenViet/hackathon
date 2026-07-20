const providers = Object.freeze(['openai', 'google']);

function positiveInteger(environment, name, fallback, maximum) {
  const raw = environment[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

export function resolveQualificationConcurrency(
  environment,
  totalExecutions,
) {
  if (!Number.isInteger(totalExecutions) || totalExecutions < 1) {
    throw new Error('qualification execution count must be a positive integer');
  }
  const maximum = Math.min(totalExecutions, 6);
  return Object.freeze({
    maximum: positiveInteger(
      environment,
      'KFC_LIVE_TEXT_QUALIFICATION_MAX_CONCURRENCY',
      Math.min(2, maximum),
      maximum,
    ),
    providerMaximum: Object.freeze(Object.fromEntries(
      providers.map((provider) => [
        provider,
        positiveInteger(
          environment,
          `KFC_LIVE_TEXT_QUALIFICATION_${provider.toUpperCase()}_MAX_CONCURRENCY`,
          1,
          maximum,
        ),
      ]),
    )),
  });
}

export function runQualificationJobs(jobs, concurrency, execute) {
  const results = new Array(jobs.length);
  const pending = jobs.map((job, index) => ({ job, index }));
  const activeByProvider = Object.fromEntries(
    providers.map((provider) => [provider, 0]),
  );
  let active = 0;
  let firstFailure;

  return new Promise((resolvePromise, rejectPromise) => {
    const schedule = () => {
      if (firstFailure && active === 0) {
        rejectPromise(firstFailure);
        return;
      }
      if (pending.length === 0 && active === 0) {
        resolvePromise(results);
        return;
      }
      if (firstFailure) return;

      while (active < concurrency.maximum) {
        const pendingIndex = pending.findIndex(({ job }) =>
          activeByProvider[job.provider] <
          concurrency.providerMaximum[job.provider]);
        if (pendingIndex < 0) break;
        const [{ job, index }] = pending.splice(pendingIndex, 1);
        active += 1;
        activeByProvider[job.provider] += 1;
        Promise.resolve()
          .then(() => execute(job))
          .then((result) => {
            results[index] = result;
          })
          .catch((error) => {
            firstFailure ??= error;
          })
          .finally(() => {
            active -= 1;
            activeByProvider[job.provider] -= 1;
            schedule();
          });
      }
    };
    schedule();
  });
}
