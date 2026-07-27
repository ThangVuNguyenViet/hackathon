import { getCliClient } from 'sanity/cli';
import {
  seedSanityRecommendationPolicies,
  verifySanityRecommendationPolicies,
} from '../../kfc-agent-backend/scripts/seed-sanity-recommendation-policies';

const client = getCliClient({
  apiVersion: '2026-07-27',
  perspective: 'published',
});

if (process.argv.includes('--check')) {
  await verifySanityRecommendationPolicies(client);
  console.log('Verified 5 public published Sanity recommendation policies');
} else {
  const result = await seedSanityRecommendationPolicies(client);
  console.log(
    `Seeded ${result.replaced} Sanity recommendation policies; removed ${result.deleted} obsolete policies`,
  );
}
