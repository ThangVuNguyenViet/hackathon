import { CfnParameter } from "aws-cdk-lib";
import { Construct } from "constructs";

export interface PlatformParameters {
  readonly certificateArn: CfnParameter;
  readonly internalAlbServerName: CfnParameter;
}

export const createPlatformParameters = (scope: Construct): PlatformParameters => ({
  certificateArn: new CfnParameter(scope, "InternalAlbCertificateArn", {
    type: "String",
    allowedPattern: "^arn:aws:acm:ap-southeast-1:[0-9]{12}:certificate/[a-f0-9-]+$",
    description: "Existing ACM certificate for the private ALB HTTPS listener",
  }),
  internalAlbServerName: new CfnParameter(scope, "InternalAlbServerName", {
    type: "String",
    allowedPattern: "^(?=.{1,253}$)([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,63}$",
    description: "Private DNS name covered by the ACM certificate and used for API Gateway TLS SNI verification",
  }),
});
