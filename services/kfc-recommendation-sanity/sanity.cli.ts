import { defineCliConfig } from 'sanity/cli';

const projectId = requiredEnvironment('SANITY_PROJECT_ID');
const dataset = requiredEnvironment('SANITY_DATASET');

export default defineCliConfig({
  api: {
    projectId,
    dataset,
  },
});

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
