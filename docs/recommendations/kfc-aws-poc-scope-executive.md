# KFC Product Recommendation POC — AWS Scope of Work and Credit Request

**Draft — For Discussion**  
**Estimate date:** 9 August 2026 | **Region:** Asia Pacific (Singapore), `ap-southeast-1`

1. **Purpose:** De-risk KFC’s production recommendation decision by selecting the best AWS-based approach through a four-week, real-data, non-customer-facing proof of concept.
2. **Product:** Evaluate Local Favorite, For You, Modifier Upsell, and Smart Cross-sell recommendations for kiosk-first ordering, with chat as a secondary channel.
3. **Current state:** A local four-decision workbench and custom scorer exist; AWS deployment, real KFC integration, measured capacity, and production release remain POC deliverables.
4. **Data:** KFC supplies approved menu/catalog, tokenized order history, interaction events, and store context through Amazon S3; AWS Glue validates and prepares the data, and controlled historical events are replayed through Amazon Personalize `PutEvents`.
5. **Comparison:** Retrain the custom model with Amazon SageMaker and compare it independently with every documented-fit Amazon Personalize recipe through an offline-screening and finalist-runtime funnel.
6. **Shared controls:** Both scorers use the same trusted context, deterministic eligibility experiment, evidence contract, holdout, candidate universe, and authenticated Amazon API Gateway/Cognito test path.
7. **AWS services:** Amazon Personalize, SageMaker, Glue, S3, DynamoDB, ECS/Fargate, ECR, API Gateway, Cognito, ALB/VPC Link, VPC endpoints, KMS, Secrets Manager, CloudWatch, X-Ray, CloudTrail, IAM, and AWS Budgets in a dedicated KFC POC account.
8. **Deliverables:** Terraform replacement for the full target topology, deployed POC subset with teardown proof, benchmark report, per-decision platform recommendation, cost model, security/evidence report, and production transition scope.
9. **Gates:** After every decision passes pre-start data sufficiency, require zero hard-policy violations, 100% durable evidence, end-to-end p95 ≤250 ms and p99 ≤500 ms under the 5/50/100 RPS profile, and NDCG@10 at or above the KFC-approved frozen-custom quality floor with 95% bootstrap intervals.
10. **Decision:** After hard gates, score quality 45%, operability 20%, AWS cost 15%, integration effort 10%, and evidence/explainability 10%; prefer Personalize on a statistical tie. A hybrid means different scorers by decision type, never a chained scorer.
11. **POC cost and request:** Base gross four-week AWS usage is **$208.50**; adding 20% gives **$250.20**; request **$300 in AWS promotional credits**. Low/high rounded sensitivities are $200/$500. Gross execution spend stops at $300 unless KFC reapproves a higher ceiling.
12. **Production:** A 30-day KFC-funded bridge retains only encrypted artifacts and audit records; runtime and billable network resources are removed. Custom and Personalize/hybrid production run-rates use measured workload inputs and require separate KFC and AWS account-team decisions.

## Sources

1. [AWS Promotional Credit Terms and Conditions](https://aws.amazon.com/awscredits/) — project-scoped credits, eligible-service limits, disbursement, and expiry.
2. [AWS Partner Central: Creating a fund request](https://docs.aws.amazon.com/partner-central/latest/getting-started/create-fund-request.html) — AWS review, technical approval, finance approval, and pre-approval stages for partner-led requests.
3. [Amazon Redshift proof-of-concept playbook](https://docs.aws.amazon.com/redshift/latest/dg/proof-of-concept-playbook.html) — work backward from requirements, measurable targets, and minimum test artifacts.
4. [Amazon Personalize pricing](https://aws.amazon.com/personalize/pricing/) — ingestion, training, inference, recommender-hour, metadata, and minimum active-campaign consumption.
5. [AWS Pricing Calculator assumptions](https://aws.amazon.com/calculator/calculator-assumptions/) — regional list-price estimates are approximations and exclude promotional credits and discounts.
