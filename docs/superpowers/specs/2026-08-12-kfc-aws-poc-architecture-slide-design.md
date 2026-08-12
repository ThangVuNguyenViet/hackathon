# KFC AWS POC Architecture Slide Design

## Objective

Redraw slide 12 as a solution-architect-quality AWS diagram while limiting the content to the approved proof-of-concept scope. The diagram must remain readable in a presentation and must not imply production controls or services that are outside the POC.

## Audience and communication job

The audience is KFC and AWS stakeholders reviewing the POC. The slide should make four things immediately clear:

1. where recommendation requests enter;
2. which services perform online recommendation and business-rule execution;
3. how data and model assets are prepared; and
4. how runtime services publish operational telemetry to CloudWatch.

## Selected composition

Use a three-zone diagram inside a single AWS Cloud boundary:

- **Online serving:** Amazon API Gateway, AWS Lambda, Amazon Personalize, Amazon SageMaker, Amazon DynamoDB, and AWS Secrets Manager.
- **Data and model preparation:** Amazon S3, Amazon Athena, and Amazon ECR.
- **Observability:** Amazon CloudWatch as a spanning support layer for the monitored runtime services.

KFC channels remain outside the AWS boundary as a compact source node. A second small external source represents KFC-approved POC data entering S3. Both sources must be visibly subordinate to the AWS system.

## Flow semantics

The customer request path is the dominant visual path:

- KFC channels -> API Gateway: recommendation request
- API Gateway -> Lambda: invokes
- Lambda -> API Gateway -> KFC channels: recommendation response, represented as a concise return path or a bidirectional request/response connector

Online recommendation and serving flows:

- Lambda <-> DynamoDB: reads current menu, price, availability, and serving state
- Lambda <-> Amazon Personalize: sends current context and interaction events, and receives relevance candidates and scores
- Lambda <-> SageMaker real-time endpoint: sends candidates plus business context and receives the final business-ranked list
- Lambda -> Secrets Manager: retrieves KFC API credentials

Data and model preparation flows:

- KFC-approved POC data -> S3: lands approved batch data
- S3 <-> Athena: validates and transforms raw data into curated datasets
- S3 -> Personalize: imports historical datasets used to train/update recommendation resources
- S3 -> SageMaker: supplies training data and model artifacts
- ECR -> SageMaker: supplies the custom inference container image

Observability flows:

- API Gateway -> CloudWatch: access and execution metrics/logs
- Lambda -> CloudWatch: invocation metrics and application logs
- Personalize -> CloudWatch: service and event metrics
- SageMaker -> CloudWatch: endpoint metrics and logs

The architecture is governed by the approved POC scope and current AWS service behavior. The Mermaid block in `docs/recommendations/kfc-aws-poc-scope-executive.md` is background context, not an arrow contract; update its semantics after the architecture is finalized so it does not contradict the slide.

## Visual system

- Use official AWS architecture icons and recognizable AWS service colors.
- Use zone labels and restrained containers instead of a dense collection of equal-weight cards.
- Emphasize the request path in KFC red.
- Use numbered dark-neutral arrows for online recommendation steps, green for data and model preparation, purple for serving-state access, and dashed pink telemetry lines into CloudWatch.
- Keep labels short, avoid crossing connectors, and place arrow labels so they do not collide with cards or other edges.
- Preserve the deck's existing title, typography, margins, and footer treatment.
- Do not shrink the complete architecture merely to accommodate the KFC channels node.

## Explicit exclusions

Do not add VPCs, subnets, availability zones, load balancers, Cognito, IAM detail, KMS, private endpoints, disaster recovery, multi-region topology, production autoscaling, or other production-only controls. These may be valid future architecture concerns but are outside this slide's approved POC scope.

## Verification

Before updating Google Slides:

1. compare every drawn arrow against the Markdown Mermaid source;
2. render the diagram and inspect it at full-slide size;
3. verify that no label, connector, icon, or boundary overlaps or clips;
4. replace slide 12 in place without changing adjacent slides; and
5. export the live deck and inspect slide 12 again at high resolution.
