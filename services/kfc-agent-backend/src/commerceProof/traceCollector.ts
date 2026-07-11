import Fastify, { type FastifyInstance } from "fastify";
import { safeTraceEventSchema, type SafeTraceEvent } from "./traceEvents.js";

export interface CommerceProofTraceCollectorOptions {
  token: string;
  runId: string;
}

const incomingEventSchema = safeTraceEventSchema.omit({ sequence: true });

export function buildCommerceProofTraceCollector(
  options: CommerceProofTraceCollectorOptions,
): FastifyInstance {
  const server = Fastify({ logger: false });
  const events: SafeTraceEvent[] = [];
  let sequence = 0;

  server.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health") return;
    if (request.headers.authorization !== `Bearer ${options.token}`) {
      return reply.code(401).send({
        ok: false,
        errorCode: "trace_collector_unauthorized",
        message: "Invalid trace collector token",
      });
    }
  });

  server.get("/health", async () => ({
    ok: true,
    service: "commerce-proof-trace-collector",
    dependencyClass: "simulated",
  }));

  server.post("/__proof/events", async (request, reply) => {
    const parsed = incomingEventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        errorCode: "invalid_trace_event",
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
    }
    if (parsed.data.runId !== options.runId) {
      return reply.code(409).send({
        ok: false,
        errorCode: "trace_run_mismatch",
        message: "Trace event runId does not match the active proof run",
      });
    }
    const accepted = safeTraceEventSchema.parse({
      ...parsed.data,
      sequence: ++sequence,
    });
    events.push(accepted);
    return reply.code(202).send({ accepted: true, sequence: accepted.sequence });
  });

  server.get("/__proof/traces/:traceId", async (request) => {
    const { traceId } = request.params as { traceId: string };
    return {
      runId: options.runId,
      traceId,
      events: events.filter((event) => event.traceId === traceId),
    };
  });

  return server;
}
