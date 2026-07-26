import type { PotentialRecommendationCandidate } from '../eligibility/types.js';
import type { RankingStatisticsSnapshot } from '../snapshots/types.js';
import type { PlacementRanker, RankedCandidate, RankerInput } from './types.js';

type Daypart = 'breakfast' | 'lunch' | 'afternoon' | 'dinner' | 'late_night';

interface ContextualPopularityFeature {
  dayType: 'weekday' | 'weekend';
  daypart: Daypart;
  score: number;
  segment: string;
}

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const countForKey = (counts: object, key: string): number => {
  const entry = Object.entries(counts).find(([entryKey]) => entryKey === key);
  return typeof entry?.[1] === 'number' ? entry[1] : 0;
};

function localCalendarContext(
  decisionTime: string,
  timezone: string,
): Pick<ContextualPopularityFeature, 'dayType' | 'daypart'> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(decisionTime));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  const hour = Number(part('hour'));
  const minute = Number(part('minute'));
  const localMinutes = hour * 60 + minute;
  const daypart: Daypart =
    localMinutes >= 5 * 60 && localMinutes < 10 * 60
      ? 'breakfast'
      : localMinutes >= 10 * 60 && localMinutes < 14 * 60
        ? 'lunch'
        : localMinutes >= 14 * 60 && localMinutes < 17 * 60
          ? 'afternoon'
          : localMinutes >= 17 * 60 && localMinutes < 22 * 60
            ? 'dinner'
            : 'late_night';
  return {
    dayType: ['Sat', 'Sun'].includes(part('weekday')) ? 'weekend' : 'weekday',
    daypart,
  };
}

function sortRankedCandidates(
  candidates: RankedCandidate[],
): RankedCandidate[] {
  return candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.candidate.action.actionId.localeCompare(
        right.candidate.action.actionId,
      ),
  );
}

export function assertEligibleCandidates(input: RankerInput): void {
  for (const candidate of input.candidates) {
    const decision = input.eligibilityDecisions.find(
      (entry) => entry.actionId === candidate.action.actionId,
    );
    if (!decision?.eligible) {
      throw new Error(
        `Candidate ${candidate.action.actionId} lacks an eligible decision`,
      );
    }
  }
}

export function contextualPopularityForCandidate(
  candidate: PotentialRecommendationCandidate,
  input: Pick<RankerInput, 'context' | 'rankingStatistics'>,
): ContextualPopularityFeature {
  const { dayType, daypart } = localCalendarContext(
    input.context.request.decisionTime,
    input.context.storeTimezone,
  );
  const storeId = input.context.request.storeId;
  const fullKey = `${storeId}:${dayType}:${daypart}`;
  const daypartKey = `${storeId}:${daypart}`;
  const statistics = input.rankingStatistics.productStatistics;
  const globalTotal = statistics.reduce(
    (total, entry) => total + entry.globalOrderCount,
    0,
  );
  const candidateStatistics = statistics.find(
    (entry) => entry.sellableItemId === candidate.sellableItemId,
  );
  const globalItemCount = candidateStatistics?.globalOrderCount ?? 0;
  const globalShare = globalTotal === 0 ? 0 : globalItemCount / globalTotal;
  const segment = [
    {
      key: fullKey,
      label: fullKey,
      count: (entry: RankingStatisticsSnapshot['productStatistics'][number]) =>
        entry.storeCalendarDayTypeDaypartOrderCounts[fullKey] ?? 0,
      present: (
        entry: RankingStatisticsSnapshot['productStatistics'][number],
      ) => hasOwn(entry.storeCalendarDayTypeDaypartOrderCounts, fullKey),
    },
    {
      key: daypartKey,
      label: daypartKey,
      count: (entry: RankingStatisticsSnapshot['productStatistics'][number]) =>
        entry.storeDaypartOrderCounts[daypartKey] ?? 0,
      present: (
        entry: RankingStatisticsSnapshot['productStatistics'][number],
      ) => hasOwn(entry.storeDaypartOrderCounts, daypartKey),
    },
    {
      key: storeId,
      label: storeId,
      count: (entry: RankingStatisticsSnapshot['productStatistics'][number]) =>
        countForKey(entry.storeOrderCounts, storeId),
      present: (
        entry: RankingStatisticsSnapshot['productStatistics'][number],
      ) => hasOwn(entry.storeOrderCounts, storeId),
    },
  ].find((entry) => statistics.some(entry.present));

  if (!segment) {
    return { dayType, daypart, score: globalShare, segment: 'global' };
  }

  const segmentTotal = statistics.reduce(
    (total, entry) => total + segment.count(entry),
    0,
  );
  const segmentItemCount = candidateStatistics
    ? segment.count(candidateStatistics)
    : 0;
  const priorStrength = input.rankingStatistics.priorStrength;
  return {
    dayType,
    daypart,
    score:
      (segmentItemCount + priorStrength * globalShare) /
      (segmentTotal + priorStrength),
    segment: segment.label,
  };
}

export class ContextualPopularityRanker implements PlacementRanker {
  readonly version = 'contextual-popularity-v1';

  rank(input: RankerInput): RankedCandidate[] {
    assertEligibleCandidates(input);
    return sortRankedCandidates(
      input.candidates.map((candidate) => {
        const feature = contextualPopularityForCandidate(candidate, input);
        return {
          candidate,
          score: feature.score,
          reasonCodes: ['popular_here'],
          featureSummary: {
            segment: feature.segment,
            dayType: feature.dayType,
            daypart: feature.daypart,
            contextualPopularity: feature.score,
          },
        };
      }),
    );
  }
}
