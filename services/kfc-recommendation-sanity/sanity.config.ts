import { defineConfig } from 'sanity';
import { recommendationPolicySanitySchema } from '../kfc-agent-backend/src/recommendations/merchandising/sanity-schema';

const projectId = requiredEnvironment('SANITY_PROJECT_ID');
const dataset = requiredEnvironment('SANITY_DATASET');

export default defineConfig({
  name: 'default',
  title: 'KFC Vietnam recommendation policies',
  projectId,
  dataset,
  schema: {
    types: [recommendationPolicySanitySchema],
  },
});

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
