import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { D1Store } from '../../src/persistence/d1Store.js';
import {
  buildWorkerRouteOptions,
  type WorkerRouteSurface,
} from '../../src/workerRouteOptions.js';
import type { WorkerEnv } from '../../src/worker.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

function typescriptFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return typescriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

function callExpressionsNamed(
  sourceFile: ts.SourceFile,
  functionName: string,
): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === functionName
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

function expectObjectArgumentForwardsResponseVerifier(input: {
  call: ts.CallExpression;
  file: string;
  sourceFile: ts.SourceFile;
}): void {
  const argument = input.call.arguments[0];
  expect(
    argument && ts.isObjectLiteralExpression(argument),
    input.file,
  ).toBe(true);
  if (!argument || !ts.isObjectLiteralExpression(argument)) return;
  const verifierProperty = argument.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      property.name.getText(input.sourceFile) === 'responseVerifierModel',
  );
  expect(verifierProperty, input.file).toBeDefined();
  expect(
    verifierProperty?.initializer.getText(input.sourceFile).trim(),
    input.file,
  ).not.toBe('');
}

describe('response verifier configuration', () => {
  it('forwards the configured verifier through every maintained route call', () => {
    let runAgentTurnCallCount = 0;
    let productionResumeFactoryCallCount = 0;
    for (const file of typescriptFiles('src/api')) {
      const source = readFileSync(file, 'utf8');
      const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const runAgentTurnCalls = callExpressionsNamed(
        sourceFile,
        'runAgentTurn',
      );
      runAgentTurnCallCount += runAgentTurnCalls.length;
      for (const call of runAgentTurnCalls) {
        expectObjectArgumentForwardsResponseVerifier({
          call,
          file,
          sourceFile,
        });
      }
      const productionResumeFactoryCalls = callExpressionsNamed(
        sourceFile,
        'createProductionConfirmationResumeHandler',
      );
      productionResumeFactoryCallCount +=
        productionResumeFactoryCalls.length;
      for (const call of productionResumeFactoryCalls) {
        expectObjectArgumentForwardsResponseVerifier({
          call,
          file,
          sourceFile,
        });
      }
    }
    expect(runAgentTurnCallCount).toBeGreaterThan(0);
    expect(productionResumeFactoryCallCount).toBeGreaterThan(0);
  });

  it('uses the opposite live provider as the canonical scenario verifier', () => {
    const source = readFileSync(
      'test/scenarios/live-ai-scenario-replay.test.ts',
      'utf8',
    );
    expect(source).toContain(
      'const verifierProvider = oppositeAgentProvider(agentProvider);',
    );
    expect(source).toContain(
      'expect(verifierProvider).toBe(oppositeAgentProvider(agentProvider));',
    );
  });

  it.each([
    {
      name: 'Google agent with OpenAI verifier',
      env: {
        KFC_AGENT_PROVIDER: 'google',
        KFC_AGENT_MODEL: 'gemini-3.1-flash-lite',
        GOOGLE_API_KEY: 'google_agent_test_key',
        KFC_RESPONSE_VERIFIER_PROVIDER: 'openai',
        KFC_RESPONSE_VERIFIER_MODEL: 'gpt-4.1-mini',
        OPENAI_API_KEY: 'openai_verifier_test_key',
      },
      expectedAgent: {
        provider: 'google',
        model: 'gemini-3.1-flash-lite',
      },
      expectedVerifier: {
        provider: 'openai',
        model: 'gpt-4.1-mini',
      },
    },
    {
      name: 'OpenAI agent with Google verifier',
      env: {
        KFC_AGENT_PROVIDER: 'openai',
        KFC_AGENT_MODEL: 'gpt-4.1-mini',
        OPENAI_API_KEY: 'openai_agent_test_key',
        KFC_RESPONSE_VERIFIER_PROVIDER: 'google',
        KFC_RESPONSE_VERIFIER_MODEL: 'gemini-3.1-flash-lite',
        GOOGLE_API_KEY: 'google_verifier_test_key',
      },
      expectedAgent: {
        provider: 'openai',
        model: 'gpt-4.1-mini',
      },
      expectedVerifier: {
        provider: 'google',
        model: 'gemini-3.1-flash-lite',
      },
    },
  ] as const)(
    'shares the $name configuration across every Worker entry point',
    ({ env, expectedAgent, expectedVerifier }) => {
      const surfaces: WorkerRouteSurface[] = [
        {
          kind: 'fetch',
          request: new Request('https://worker.test/chat/kfc/message'),
          customerRunPaceMs: 0,
          customerRunMaxTextEvents: 3,
        },
        { kind: 'queue' },
        { kind: 'scheduled' },
      ];

      for (const surface of surfaces) {
        const db = new FakeD1Database();
        const { routeOptions } = buildWorkerRouteOptions({
          env: {
            DB: db,
            KFC_AGENT_PROFILE_MODE: 'production',
            KFC_COMMERCE_MODE: 'fixture',
            ...env,
          } satisfies WorkerEnv,
          store: new D1Store(db),
          dashboard: new DashboardEventBus(),
          surface,
        });

        expect(routeOptions.agent?.identity, surface.kind).toMatchObject(
          expectedAgent,
        );
        expect(
          routeOptions.responseVerifier?.identity,
          surface.kind,
        ).toMatchObject(expectedVerifier);
        expect(
          routeOptions.readiness?.responseVerifierConfigured,
          surface.kind,
        ).toBe(true);
      }
    },
  );

  it.each(['fetch', 'queue', 'scheduled'] as const)(
    'fails closed for a same-provider verifier on the %s Worker entry point',
    (kind) => {
      const db = new FakeD1Database();
      const surface: WorkerRouteSurface =
        kind === 'fetch'
          ? {
              kind,
              request: new Request(
                'https://worker.test/chat/kfc/message',
              ),
              customerRunPaceMs: 0,
              customerRunMaxTextEvents: 3,
            }
          : { kind };

      expect(() =>
        buildWorkerRouteOptions({
          env: {
            DB: db,
            KFC_AGENT_PROFILE_MODE: 'production',
            KFC_AGENT_PROVIDER: 'google',
            GOOGLE_API_KEY: 'google_agent_test_key',
            KFC_RESPONSE_VERIFIER_PROVIDER: 'google',
          },
          store: new D1Store(db),
          dashboard: new DashboardEventBus(),
          surface,
        }),
      ).toThrow(
        'KFC response verifier provider must differ from KFC agent provider',
      );
    },
  );

  it('forwards the configured verifier through the Studio graph entry point', () => {
    const source = readFileSync('src/graph/studioAgent.ts', 'utf8');
    expect(source).toContain(
      'verifierModel: options.responseVerifier?.model,',
    );
  });
});
