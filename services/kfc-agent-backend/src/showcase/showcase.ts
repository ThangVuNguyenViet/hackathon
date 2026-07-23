import { Client } from 'langsmith';
import type { Example, Run } from 'langsmith/schemas';
import { z } from 'zod';
import type { ConversationStore } from '../persistence/memoryStore.js';
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
  preconditions: z.array(z.string()).default([]),
  useCases: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
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
    preconditions: stringList(inputs.preconditions ?? metadata.preconditions),
    useCases: stringList(inputs.useCases ?? metadata.useCases),
    risks: stringList(
      outputs.risks ??
        outputs.acceptanceCriteria ??
        outputs.expectations ??
        metadata.risks ??
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

// Retained as a compatibility export for route modules that share generated
// error-handling imports. The showcase no longer accepts result mutations.
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
