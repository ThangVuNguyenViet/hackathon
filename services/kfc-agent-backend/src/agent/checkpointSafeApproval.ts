import { z } from 'zod';
import {
  digestCommerceAction,
} from '../ordering/approvalReceipt.js';
import {
  agentToolCallDisposition,
} from '../ordering/toolCallDisposition.js';
import type {
  ToolCallRequest,
  ToolName,
} from '../ordering/types.js';
import type { PendingToolCall } from './singleAgentRuntime.js';

export const CHECKPOINT_SAFE_APPROVAL_SCHEMA_VERSION =
  'kfc-checkpoint-safe-approval-v1' as const;

export const checkpointSafeApprovalSchema = z.object({
  schemaVersion: z.literal(CHECKPOINT_SAFE_APPROVAL_SCHEMA_VERSION),
  requestId: z.string().min(1),
  toolName: z.enum([
    'placeOrder',
    'createPaymentLink',
    'acquireVoucher',
    'redeemReward',
    'handoff',
    'resolveHandoff',
  ]),
  actionDigest: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

export type CheckpointSafeApproval = z.infer<
  typeof checkpointSafeApprovalSchema
>;

const checkpointSafeInterruptSchema = z.object({
  actionRequests: z.array(z.object({
    name: checkpointSafeApprovalSchema.shape.toolName,
    args: z.object({
      schemaVersion: z.literal(CHECKPOINT_SAFE_APPROVAL_SCHEMA_VERSION),
      requestId: z.string().min(1),
      actionDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    }).strict(),
  }).strict()).length(1),
}).strict();

function canonicalApprovalAction(
  value: Pick<PendingToolCall, 'toolName' | 'arguments'> | ToolCallRequest,
): ToolCallRequest | null {
  const disposition = agentToolCallDisposition(
    value.toolName,
    value.arguments,
  );
  if (
    !disposition.success ||
    disposition.data.effect !== 'irreversible_mutation'
  ) {
    return null;
  }
  return {
    toolName: disposition.data.toolName,
    arguments: disposition.data.arguments,
  };
}

export async function createCheckpointSafeApproval(input: {
  requestId: string;
  call: Pick<PendingToolCall, 'toolName' | 'arguments'>;
}): Promise<CheckpointSafeApproval> {
  const action = canonicalApprovalAction(input.call);
  if (!input.requestId.trim() || !action) {
    throw new Error('agent_approval_interrupt_invalid');
  }
  return Object.freeze(checkpointSafeApprovalSchema.parse({
    schemaVersion: CHECKPOINT_SAFE_APPROVAL_SCHEMA_VERSION,
    requestId: input.requestId,
    toolName: action.toolName,
    actionDigest: await digestCommerceAction(action),
  }));
}

export function checkpointSafeApprovalInterrupt(
  approval: CheckpointSafeApproval,
): {
  actionRequests: [{
    name: ToolName;
    args: {
      schemaVersion: typeof CHECKPOINT_SAFE_APPROVAL_SCHEMA_VERSION;
      requestId: string;
      actionDigest: string;
    };
  }];
} {
  const parsed = checkpointSafeApprovalSchema.parse(approval);
  return {
    actionRequests: [{
      name: parsed.toolName,
      args: {
        schemaVersion: parsed.schemaVersion,
        requestId: parsed.requestId,
        actionDigest: parsed.actionDigest,
      },
    }],
  };
}

export function parseCheckpointSafeApprovalInterrupt(
  value: unknown,
): CheckpointSafeApproval {
  const parsed = checkpointSafeInterruptSchema.safeParse(value);
  if (!parsed.success) throw new Error('agent_approval_interrupt_invalid');
  const action = parsed.data.actionRequests[0]!;
  return {
    schemaVersion: action.args.schemaVersion,
    requestId: action.args.requestId,
    toolName: action.name,
    actionDigest: action.args.actionDigest,
  };
}

export async function checkpointSafeApprovalMatchesCall(input: {
  approval: CheckpointSafeApproval;
  call: Pick<PendingToolCall, 'toolName' | 'arguments'> | ToolCallRequest;
}): Promise<boolean> {
  const approval = checkpointSafeApprovalSchema.safeParse(input.approval);
  const action = canonicalApprovalAction(input.call);
  return Boolean(
    approval.success &&
    action &&
    action.toolName === approval.data.toolName &&
    await digestCommerceAction(action) === approval.data.actionDigest,
  );
}

export async function rehydrateCheckpointSafeApprovalCall(input: {
  approval: CheckpointSafeApproval;
  action: ToolCallRequest;
}): Promise<PendingToolCall> {
  if (!(await checkpointSafeApprovalMatchesCall({
    approval: input.approval,
    call: input.action,
  }))) {
    throw new Error('agent_confirmation_action_mismatch');
  }
  const action = canonicalApprovalAction(input.action);
  if (!action) throw new Error('agent_confirmation_action_mismatch');
  return {
    id: `approval:${input.approval.requestId}`,
    toolName: action.toolName,
    arguments: action.arguments,
  };
}
