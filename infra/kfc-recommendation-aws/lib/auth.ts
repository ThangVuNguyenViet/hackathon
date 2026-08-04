import {
  OAuthScope,
  UserPool,
  UserPoolClient,
  UserPoolClientIdentityProvider,
  UserPoolResourceServer,
  ResourceServerScope,
} from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";

export interface AuthResources {
  readonly userPool: UserPool;
  readonly client: UserPoolClient;
  readonly issuer: string;
  readonly scopes: readonly string[];
}

export const createAuth = (scope: Construct): AuthResources => {
  const userPool = new UserPool(scope, "MachineUserPool", {
    userPoolName: "kfc-recommendation-sandbox-m2m",
    selfSignUpEnabled: false,
    signInCaseSensitive: true,
    deletionProtection: true,
  });
  userPool.addDomain("MachineTokenDomain", {
    cognitoDomain: { domainPrefix: `kfc-recommendation-${userPool.stack.account}` },
  });
  const decide = new ResourceServerScope({
    scopeName: "decide",
    scopeDescription: "Call one of the four exact recommendation decision APIs",
  });
  const events = new ResourceServerScope({
    scopeName: "events",
    scopeDescription: "Record trusted recommendation outcomes",
  });
  const resourceServer = new UserPoolResourceServer(scope, "ResourceServer", {
    userPool,
    identifier: "recommendations",
    scopes: [decide, events],
  });
  const client = userPool.addClient("MachineClient", {
    userPoolClientName: "trusted-recommendation-backends",
    generateSecret: true,
    authFlows: { userSrp: false, adminUserPassword: false, custom: false },
    supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
    oAuth: {
      flows: { clientCredentials: true },
      scopes: [OAuthScope.resourceServer(resourceServer, decide), OAuthScope.resourceServer(resourceServer, events)],
    },
    enableTokenRevocation: true,
    preventUserExistenceErrors: true,
  });
  client.node.addDependency(resourceServer);
  return {
    userPool,
    client,
    issuer: `https://cognito-idp.${userPool.stack.region}.amazonaws.com/${userPool.userPoolId}`,
    scopes: ["recommendations/decide", "recommendations/events"],
  };
};
