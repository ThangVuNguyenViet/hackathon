import { Duration } from "aws-cdk-lib";
import { CfnOIDCProvider, FederatedPrincipal, PolicyStatement, Role } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export const createDeploymentIdentity = (
  scope: Construct,
  cdkDeploymentRoleArn: string,
  githubRepository: string,
): Role => {
  const provider = new CfnOIDCProvider(scope, "GitHubOidc", {
    url: "https://token.actions.githubusercontent.com",
    clientIdList: ["sts.amazonaws.com"],
  });
  const principal = new FederatedPrincipal(
    provider.attrArn,
    {
      StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      StringLike: {
        "token.actions.githubusercontent.com:sub": `repo:${githubRepository}:ref:refs/heads/main`,
      },
    },
    "sts:AssumeRoleWithWebIdentity",
  );
  const role = new Role(scope, "GitHubDeploymentRole", {
    roleName: "kfc-recommendation-github-deploy",
    assumedBy: principal,
    description: "GitHub OIDC may assume only the pre-existing scoped CDK deploy role",
    maxSessionDuration: Duration.hours(1),
  });
  role.addToPolicy(
    new PolicyStatement({
      actions: ["sts:AssumeRole"],
      resources: [cdkDeploymentRoleArn],
    }),
  );
  return role;
};
