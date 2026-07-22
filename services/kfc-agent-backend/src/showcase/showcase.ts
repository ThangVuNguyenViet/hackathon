import { Client } from 'langsmith';
import type { Example, Run } from 'langsmith/schemas';
import { z } from 'zod';
import type { ConversationStore } from '../persistence/memoryStore.js';
import {
  createSafeAgentTracer,
  type AgentTracer,
} from '../observability/agentTracing.js';
import type { AgentModelIdentity } from '../config/agentModelProfile.js';

export const showcaseModeSchema = z.enum(['genui', 'text']);
export type ShowcaseMode = z.infer<typeof showcaseModeSchema>;

const showcaseTurnSchema = z.object({
  index: z.number().int().positive(),
  text: z.string().min(1),
  useCases: z.array(z.string()).default([]),
});

export const showcaseScenarioSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  goal: z.string().default(''),
  useCases: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  turns: z.array(showcaseTurnSchema).min(1),
});

export type ShowcaseScenario = z.infer<typeof showcaseScenarioSchema>;

export interface ShowcaseResult {
  scenarioId: string;
  mode: ShowcaseMode;
  sessionId: string;
  generatedAt: string;
  releaseSha: string;
  agent: AgentModelIdentity;
  langsmithTraceUrl: string | null;
  transcript: Array<{
    role: 'user' | 'assistant';
    text: string;
    genUi?: Record<string, unknown>;
  }>;
}

export interface ShowcaseScenarioSource {
  listScenarios(): Promise<ShowcaseScenario[]>;
  traceUrlForSession(sessionId: string): Promise<string | null>;
}

export class LangSmithShowcaseScenarioSource implements ShowcaseScenarioSource {
  private readonly client: Client;

  constructor(
    private readonly options: {
      apiKey: string;
      apiUrl?: string;
      datasetName: string;
      projectName: string;
    },
  ) {
    this.client = new Client({
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
    });
  }

  async listScenarios(): Promise<ShowcaseScenario[]> {
    const scenarios: ShowcaseScenario[] = [];
    for await (const example of this.client.listExamples({
      datasetName: this.options.datasetName,
    })) {
      scenarios.push(showcaseScenarioFromExample(example));
    }
    return scenarios.sort((left, right) => left.id.localeCompare(right.id));
  }

  async traceUrlForSession(sessionId: string): Promise<string | null> {
    const filter = `and(eq(metadata_key, "session_id"), eq(metadata_value, ${JSON.stringify(sessionId)}))`;
    let fallback: Run | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      for await (const run of this.client.listRuns({
        projectName: this.options.projectName,
        isRoot: true,
        filter,
        order: 'desc',
        limit: 10,
      })) {
        fallback ??= run;
        if (run.name === 'showcase_replay')
          return this.client.getRunUrl({ run });
      }
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return fallback ? this.client.getRunUrl({ run: fallback }) : null;
  }
}

export function showcaseScenarioFromExample(
  example: Pick<Example, 'id' | 'inputs' | 'outputs' | 'metadata'>,
): ShowcaseScenario {
  const inputs = record(example.inputs);
  const outputs = record(example.outputs);
  const metadata = record(example.metadata);
  const rawTurns = Array.isArray(inputs.turns) ? inputs.turns : [];
  return showcaseScenarioSchema.parse({
    id:
      stringValue(inputs.scenarioId) ??
      stringValue(metadata.scenarioId) ??
      example.id,
    title:
      stringValue(inputs.title) ??
      stringValue(metadata.title) ??
      stringValue(inputs.scenarioId) ??
      example.id,
    goal: stringValue(inputs.goal) ?? stringValue(metadata.goal) ?? '',
    useCases: stringList(inputs.useCases ?? metadata.useCases),
    acceptanceCriteria: stringList(
      outputs.acceptanceCriteria ??
        outputs.expectations ??
        metadata.acceptanceCriteria,
    ),
    turns: rawTurns.map((raw, index) => {
      const turn = record(raw);
      return {
        index:
          numberValue(turn.index) ?? numberValue(turn.turnIndex) ?? index + 1,
        text: stringValue(turn.text) ?? '',
        useCases: stringList(turn.useCases),
      };
    }),
  });
}

const catalogSessionId = 'showcase:catalog';
const catalogEventType = 'showcase:catalog_cached';
const resultEventType = 'showcase:result_completed:v2';

export class ShowcaseService {
  constructor(
    private readonly options: {
      source: ShowcaseScenarioSource;
      store: ConversationStore;
      releaseSha: string;
      agent: AgentModelIdentity;
      tracer?: AgentTracer;
    },
  ) {}

  async catalog(): Promise<{
    scenarios: Array<
      ShowcaseScenario & {
        results: Partial<Record<ShowcaseMode, ShowcaseResult>>;
      }
    >;
  }> {
    const scenarios = await this.loadScenarios();
    return {
      scenarios: await Promise.all(
        scenarios.map(async (scenario) => ({
          ...scenario,
          results: {
            genui: await this.latestResult(scenario.id, 'genui'),
            text: await this.latestResult(scenario.id, 'text'),
          },
        })),
      ),
    };
  }

  async complete(input: unknown): Promise<ShowcaseResult> {
    const parsed = z
      .object({
        scenarioId: z.string().min(1),
        mode: showcaseModeSchema,
        sessionId: z.string().startsWith('kfc:showcase_'),
      })
      .strict()
      .parse(input);
    const scenario = (await this.loadScenarios()).find(
      (candidate) => candidate.id === parsed.scenarioId,
    );
    if (!scenario)
      throw new ShowcaseValidationError('showcase_scenario_not_found');
    const turns = (await this.options.store.listTurns(parsed.sessionId)).filter(
      (turn) => turn.role === 'user' || turn.role === 'assistant',
    );
    if (turns.length !== scenario.turns.length * 2) {
      throw new ShowcaseValidationError('showcase_replay_incomplete');
    }
    for (const [index, expected] of scenario.turns.entries()) {
      const user = turns[index * 2];
      const assistant = turns[index * 2 + 1];
      if (
        user?.role !== 'user' ||
        user.text !== expected.text ||
        assistant?.role !== 'assistant'
      ) {
        throw new ShowcaseValidationError('showcase_replay_mismatch');
      }
      const actualProfile =
        assistant.metadata?.responseProfile ??
        (assistant.metadata?.genUi ? 'genui' : 'social');
      if (actualProfile !== (parsed.mode === 'genui' ? 'genui' : 'social')) {
        throw new ShowcaseValidationError('showcase_replay_mode_mismatch');
      }
    }
    await this.recordReplayTrace(
      scenario,
      parsed.mode,
      parsed.sessionId,
      turns,
    );
    const result: ShowcaseResult = {
      scenarioId: scenario.id,
      mode: parsed.mode,
      sessionId: parsed.sessionId,
      generatedAt: new Date().toISOString(),
      releaseSha: this.options.releaseSha,
      agent: {
        provider: this.options.agent.provider,
        model: this.options.agent.model,
        profile: this.options.agent.profile,
      },
      langsmithTraceUrl: await this.options.source
        .traceUrlForSession(parsed.sessionId)
        .catch(() => null),
      transcript: turns.map((turn) => ({
        role: turn.role as 'user' | 'assistant',
        text: turn.text,
        ...(turn.metadata?.genUi
          ? { genUi: turn.metadata.genUi as unknown as Record<string, unknown> }
          : {}),
      })),
    };
    await this.options.store.appendEvent(
      resultSessionId(scenario.id, parsed.mode),
      resultEventType,
      result as unknown as Record<string, unknown>,
    );
    return result;
  }

  private async recordReplayTrace(
    scenario: ShowcaseScenario,
    mode: ShowcaseMode,
    sessionId: string,
    turns: Awaited<ReturnType<ConversationStore['listTurns']>>,
  ): Promise<void> {
    if (!this.options.tracer) return;
    const tracer = createSafeAgentTracer(this.options.tracer, (code, error) => {
      void this.options.store
        .appendEvent(sessionId, code, {
          message: error instanceof Error ? error.message : String(error),
        })
        .catch(() => undefined);
    });
    const replay = await tracer.startTurn({
      name: 'showcase_replay',
      inputs: {
        scenarioId: scenario.id,
        mode,
        sessionId,
        fixedTurns: scenario.turns,
        acceptanceCriteria: scenario.acceptanceCriteria,
      },
      metadata: {
        session_id: sessionId,
        scenarioId: scenario.id,
        showcaseMode: mode,
        releaseSha: this.options.releaseSha,
        agentProvider: this.options.agent.provider,
        agentModel: this.options.agent.model,
        agentProfile: this.options.agent.profile,
      },
      tags: [
        'kfc-showcase-replay',
        `scenario:${scenario.id}`,
        `mode:${mode}`,
        `session:${sessionId}`,
      ],
    });
    for (const [index, expected] of scenario.turns.entries()) {
      const assistant = turns[index * 2 + 1]!;
      const turn = await replay.startSpan({
        name: 'showcase_turn',
        runType: 'chain',
        inputs: {
          index: expected.index,
          text: expected.text,
          useCases: expected.useCases,
        },
        metadata: { turn_index: expected.index },
      });
      await turn.end({
        text: assistant.text,
        genUi: assistant.metadata?.genUi ?? null,
      });
    }
    await replay.end({
      status: 'completed',
      turnCount: scenario.turns.length,
      transcript: turns.map((turn) => ({
        role: turn.role,
        text: turn.text,
        genUi: turn.metadata?.genUi ?? null,
      })),
    });
    await tracer.flush();
  }

  private async loadScenarios(): Promise<ShowcaseScenario[]> {
    try {
      const scenarios = await this.options.source.listScenarios();
      if (scenarios.length === 0) throw new Error('showcase_dataset_empty');
      const events = await this.options.store.listEvents(catalogSessionId);
      const previous = events
        .filter((event) => event.sourceType === catalogEventType)
        .at(-1)?.payload.scenarios;
      if (JSON.stringify(previous) !== JSON.stringify(scenarios)) {
        await this.options.store.appendEvent(
          catalogSessionId,
          catalogEventType,
          { scenarios },
        );
      }
      return scenarios;
    } catch (error) {
      const events = await this.options.store.listEvents(catalogSessionId);
      const cached = events
        .filter((event) => event.sourceType === catalogEventType)
        .at(-1)?.payload.scenarios;
      if (!Array.isArray(cached)) throw error;
      return z.array(showcaseScenarioSchema).parse(cached);
    }
  }

  private async latestResult(
    scenarioId: string,
    mode: ShowcaseMode,
  ): Promise<ShowcaseResult | undefined> {
    const event = (
      await this.options.store.listEvents(resultSessionId(scenarioId, mode))
    )
      .filter((candidate) => candidate.sourceType === resultEventType)
      .at(-1);
    return event?.payload as unknown as ShowcaseResult | undefined;
  }
}

export class ShowcaseValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function resultSessionId(scenarioId: string, mode: ShowcaseMode): string {
  return `showcase:result:${encodeURIComponent(scenarioId)}:${mode}`;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value)
    ? value
    : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
