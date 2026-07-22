import { z } from 'zod';
import { opaqueProviderIdSchema } from '../domain/opaqueProviderId.js';
import { commerceContractVersion } from './contracts.js';

const identifierSchema = opaqueProviderIdSchema;
const providerRuntimeSchema = {
  contractVersion: z.literal(commerceContractVersion),
  traceId: identifierSchema,
  scenarioId: identifierSchema,
  commerceOrderId: identifierSchema,
  commerceEnvironment: z.literal('sandbox'),
  providerImplementation: z.literal('http-adapter'),
};

export const gatewayOmsCreateEvidenceSchema = z
  .object({
    ...providerRuntimeSchema,
    omsOrderId: identifierSchema,
    omsStatus: z.literal('created'),
  })
  .strict();

export const gatewayOmsCreateFailureEvidenceSchema = z
  .object({
    operation: z.literal('oms_create'),
    traceId: identifierSchema,
    scenarioId: identifierSchema,
    commerceOrderId: identifierSchema,
    statusCode: z.number().int().min(300).max(499).safe(),
    errorCode: identifierSchema,
  })
  .strict();

export const gatewayPosSubmitEvidenceSchema = z
  .object({
    ...providerRuntimeSchema,
    omsOrderId: identifierSchema,
    posTicketId: identifierSchema,
    posStatus: z.literal('accepted'),
  })
  .strict();

export const gatewayPosRejectionEvidenceSchema = z
  .object({
    traceId: identifierSchema,
    scenarioId: identifierSchema,
    commerceOrderId: identifierSchema,
    omsOrderId: identifierSchema,
    errorCode: z.literal('pos_order_rejected'),
    posStatus: z.literal('rejected'),
    statusCode: z.literal(409),
  })
  .strict();

export const gatewayOmsCancellationEvidenceSchema = z
  .object({
    ...providerRuntimeSchema,
    omsOrderId: identifierSchema,
    omsStatus: z.literal('cancelled'),
  })
  .strict();

export const gatewayOmsCancellationFailureEvidenceSchema = z
  .object({
    operation: z.enum(['oms_compensate', 'oms_cancel']),
    traceId: identifierSchema,
    scenarioId: identifierSchema,
    commerceOrderId: identifierSchema,
    omsOrderId: identifierSchema,
    statusCode: z.number().int().min(300).max(499).safe(),
    errorCode: identifierSchema,
    omsStatus: z.literal('cancellation_failed'),
  })
  .strict();

export const gatewayPosCancellationEvidenceSchema = z
  .object({
    ...providerRuntimeSchema,
    omsOrderId: identifierSchema,
    posTicketId: identifierSchema,
    posStatus: z.literal('cancelled'),
  })
  .strict();

export const gatewayPosCancellationFailureEvidenceSchema = z
  .object({
    operation: z.literal('pos_cancel'),
    traceId: identifierSchema,
    scenarioId: identifierSchema,
    commerceOrderId: identifierSchema,
    omsOrderId: identifierSchema,
    posTicketId: identifierSchema,
    statusCode: z.number().int().min(300).max(499).safe(),
    errorCode: identifierSchema,
    posStatus: z.literal('cancellation_failed'),
  })
  .strict();

export type GatewayOmsCreateEvidence = z.infer<
  typeof gatewayOmsCreateEvidenceSchema
>;
export type GatewayOmsCreateFailureEvidence = z.infer<
  typeof gatewayOmsCreateFailureEvidenceSchema
>;
export type GatewayPosSubmitEvidence = z.infer<
  typeof gatewayPosSubmitEvidenceSchema
>;
export type GatewayPosRejectionEvidence = z.infer<
  typeof gatewayPosRejectionEvidenceSchema
>;
export type GatewayOmsCancellationEvidence = z.infer<
  typeof gatewayOmsCancellationEvidenceSchema
>;
export type GatewayOmsCancellationFailureEvidence = z.infer<
  typeof gatewayOmsCancellationFailureEvidenceSchema
>;
export type GatewayPosCancellationEvidence = z.infer<
  typeof gatewayPosCancellationEvidenceSchema
>;
export type GatewayPosCancellationFailureEvidence = z.infer<
  typeof gatewayPosCancellationFailureEvidenceSchema
>;
