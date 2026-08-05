import {
  createAwsRecommendationMainServer,
  awsRecommendationMainPort,
} from './aws-main-server.js';

const server = createAwsRecommendationMainServer(process.env);
await server.listen({
  host: '0.0.0.0',
  port: awsRecommendationMainPort(process.env),
});
