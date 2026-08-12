# KFC Product Recommendation POC — AWS Scope of Work and Credit Request

**Draft — For Discussion**  
**Estimate date:** 9 August 2026 | **Region:** Asia Pacific (Singapore), `ap-southeast-1` | **POC period:** four weeks

## 1. What are we building?

KFC is building a product recommendation engine that supports Local Favorite, For You, Modifier Upsell, and Smart Cross-sell.

## 2. What AWS services do we use?

| AWS service | Why we need it |
|---|---|
| [Amazon Personalize](https://aws.amazon.com/personalize/) | Generates personalized and related-item candidates from KFC order and interaction data. |
| [Amazon SageMaker](https://aws.amazon.com/sagemaker-ai/) | Trains and hosts the LightGBM ranking model. |
| [Amazon S3](https://aws.amazon.com/s3/) | Stores training data, model artifacts, and evaluation outputs. |
| [AWS Glue](https://aws.amazon.com/glue/) | Prepares and validates model training data. |
| [Amazon DynamoDB](https://aws.amazon.com/dynamodb/) | Stores a fast view of menu, price, and product availability. |
| [AWS Lambda](https://aws.amazon.com/lambda/) | Applies business rules and coordinates the recommendation flow. |
| [Amazon ECS/Fargate](https://aws.amazon.com/fargate/) | Runs the recommendation API and supporting workers. |
| [Amazon API Gateway](https://aws.amazon.com/api-gateway/) | Exposes the recommendation engine through a managed API. |
| [Amazon ECR](https://aws.amazon.com/ecr/) | Stores application and inference containers. |
| [AWS Secrets Manager](https://aws.amazon.com/secrets-manager/) | Protects credentials used to access KFC APIs. |
| [Amazon CloudWatch](https://aws.amazon.com/cloudwatch/) | Provides logs, metrics, and alerts. |

## 3. Credit request and three-year roadmap

We request **$5,000 in AWS promotional credits** for the four-week POC. The credits will support data preparation, Personalize and SageMaker model experiments, API and load testing, and operational evidence collection.

Planning assumption: each active store handles approximately **15,000 ordering journeys** and **60,000 recommendation requests per month**.

| Year | Stores | Expected journeys/month | Expected recommendation requests/month | Expected recommendation requests/year |
|---|---:|---:|---:|---:|
| **Year 1** | **100** | 1.5 million | 6 million | 72 million |
| **Year 2** | **300** | 4.5 million | 18 million | 216 million |
| **Year 3** | **500** | 7.5 million | 30 million | 360 million |

Actual production usage and cost will be updated from the 100-store rollout.
