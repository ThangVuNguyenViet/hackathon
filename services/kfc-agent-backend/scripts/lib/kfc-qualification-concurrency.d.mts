import type {
  LiveAgentProvider,
} from './kfc-live-text-qualification.mjs';

export interface QualificationConcurrency {
  maximum: number;
  providerMaximum: Readonly<Record<LiveAgentProvider, number>>;
}

export interface QualificationJob {
  provider: LiveAgentProvider;
}

export function resolveQualificationConcurrency(
  environment: Record<string, string | undefined>,
  totalExecutions: number,
): QualificationConcurrency;

export function runQualificationJobs<Job extends QualificationJob, Result>(
  jobs: readonly Job[],
  concurrency: QualificationConcurrency,
  execute: (job: Job) => Promise<Result> | Result,
): Promise<Result[]>;
