import {
  OAuthScope,
  UserPool,
  UserPoolClient,
  UserPoolClientIdentityProvider,
  UserPoolResourceServer,
  ResourceServerScope,
} from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";

import { cognitoScopeFor } from "./scope-aliases.js";

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
    scopeName: "decision.write",
    scopeDescription: "Call one of the four exact recommendation decision APIs",
  });
  const events = new ResourceServerScope({
    scopeName: "event.write",
    scopeDescription: "Record trusted recommendation outcomes",
  });
  const inspection = new ResourceServerScope({
    scopeName: "inspection.read",
    scopeDescription: "Read protected technical recommendation evidence",
  });
  const resourceServer = new UserPoolResourceServer(scope, "ResourceServer", {
    userPool,
    identifier: "recommendations",
    scopes: [decide, events, inspection],
  });
  const client = userPool.addClient("MachineClient", {
    userPoolClientName: "trusted-recommendation-backends",
    generateSecret: true,
    authFlows: { userSrp: false, adminUserPassword: false, custom: false },
    supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
    oAuth: {
      flows: { clientCredentials: true },
      scopes: [
        OAuthScope.resourceServer(resourceServer, decide),
        OAuthScope.resourceServer(resourceServer, events),
        OAuthScope.resourceServer(resourceServer, inspection),
      ],
    },
    enableTokenRevocation: true,
    preventUserExistenceErrors: true,
  });
  client.node.addDependency(resourceServer);
  return {
    userPool,
    client,
    issuer: `https://cognito-idp.${userPool.stack.region}.amazonaws.com/${userPool.userPoolId}`,
    scopes: [
      cognitoScopeFor("recommendations.decision:write"),
      cognitoScopeFor("recommendations.event:write"),
      cognitoScopeFor("recommendations.inspection:read"),
    ],
  };
};
