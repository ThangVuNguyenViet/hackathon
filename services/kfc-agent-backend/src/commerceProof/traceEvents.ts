import { z } from "zod";

export const commerceTraceEventTypes = [
  "user_message",
  "planner_decision",
  "tool_call",
  "gateway_request",
  "mock_oms_request",
  "mock_oms_response",
  "mock_pos_request",
  "mock_pos_response",
  "tool_result",
  "assistant_response",
  "genui_rendered",
] as const;

const unsafeKeyPattern =
  /authorization|token|secret|password|address|phone|email|transcript|messageText/i;

const safeSummarySchema = z.record(z.unknown()).superRefine((value, context) => {
  inspectValue(value, [], context);
});

export const safeTraceEventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  runId: z.string().trim().min(1),
  scenarioId: z.string().trim().min(1),
  traceId: z.string().trim().min(1),
  service: z.string().trim().min(1),
  eventType: z.enum(commerceTraceEventTypes),
  status: z.enum(["started", "ok", "failed"]),
  durationMs: z.number().nonnegative(),
  simulated: z.boolean(),
  identifiers: z.record(z.string()),
  statuses: z.record(z.string()),
  inputSummary: safeSummarySchema,
  outputSummary: safeSummarySchema,
});

export type SafeTraceEvent = z.infer<typeof safeTraceEventSchema>;

function inspectValue(
  value: unknown,
  path: Array<string | number>,
  context: z.RefinementCtx,
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectValue(entry, [...path, index], context));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, entry] of Object.entries(value)) {
    if (unsafeKeyPattern.test(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, key],
        message: `Unsafe trace field: ${key}`,
      });
    }
    inspectValue(entry, [...path, key], context);
  }
}
