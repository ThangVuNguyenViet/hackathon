import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { resolveLiveScenarioPaths } from '../src/config/liveScenarioPaths.js';
import { loadOptionalEnvFile } from '../src/config/optionalEnvFile.js';
import {
  configuredSecretValues,
  parseLiveScenarioCliArgs,
} from '../src/liveEvidence/liveScenarioCli.js';
import {
  createEvidenceSanitizer,
  serializeEvidenceJsonLine,
} from '../src/liveEvidence/evidenceRedaction.js';
import { createLiveScenarioHttpClient } from '../src/liveEvidence/liveScenarioHttpClient.js';
import { runLiveScenarioCommandStream } from '../src/liveEvidence/liveScenarioProtocol.js';
import { startLiveScenarioSession } from '../src/liveEvidence/liveScenarioSession.js';
import { createJsonLineWriter } from '../src/liveEvidence/jsonLineWriter.js';

const execFileAsync = promisify(execFile);
const { repoRoot } = resolveLiveScenarioPaths(import.meta.url);
loadOptionalEnvFile(resolve(repoRoot, '.env'));

const configuredSecrets = configuredSecretValues(process.env);
const sanitizeOutput = createEvidenceSanitizer(configuredSecrets);

async function main(): Promise<void> {
  const args = parseLiveScenarioCliArgs(
    process.argv.slice(2),
    repoRoot,
    process.env,
  );
  const gateway = createLiveScenarioHttpClient({
    baseUrl: args.backendUrl,
    adminToken: args.adminToken,
  });
  const session = await startLiveScenarioSession({
    artifactsRoot: args.artifactsRoot,
    runId: args.runId,
    attempt: args.attempt,
    correlation: {
      sessionId: `kfc:${args.customerId}`,
      customerId: args.customerId,
    },
    scenarioPath: args.scenarioPath,
    expectedCandidateId: args.candidateId,
    backendUrl: args.backendUrl,
    source: await localSourceState(repoRoot),
    configuredSecrets,
    gateway,
  });
  const writeOutputLine = createJsonLineWriter(process.stdout);

  let protocolStarted = false;
  try {
    await writeOutputLine(
      serializeEvidenceJsonLine(
        {
          type: 'session_ready',
          runId: args.runId,
          attempt: args.attempt,
          runDirectory: session.runDirectory,
          sessionId: `kfc:${args.customerId}`,
          scenario: session.scenario,
          environment: session.environment,
          protocol: {
            user: { type: 'user', text: '<improvised customer message>' },
            action: {
              type: 'action',
              assistantTurnId: '<observed assistant turn ID>',
              attachmentId: '<observed attachment ID>',
              actionId: '<observed action ID>',
              payload:
                '<optional exact client-generated payload for this action>',
            },
            finish: { type: 'finish', note: '<optional reviewer note>' },
          },
        },
        sanitizeOutput,
      ),
    );

    const lines = createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });
    protocolStarted = true;
    await runLiveScenarioCommandStream({
      session,
      lines,
      sanitize: sanitizeOutput,
      writeLine: writeOutputLine,
    });
  } catch (error) {
    if (!protocolStarted) {
      await session.recordProtocolError('control_error', safeErrorClass(error));
    }
    await session.interrupt('control_error');
    await session.finalizeTerminal();
    throw error;
  } finally {
    await session.interrupt('stdin_eof');
    await session.finalizeTerminal();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${serializeEvidenceJsonLine(
      {
        type: 'fatal_error',
        errorClass: safeErrorClass(error),
      },
      sanitizeOutput,
    )}\n`,
  );
  process.exitCode = 1;
});

async function localSourceState(
  cwd: string,
): Promise<{ gitSha: string; dirty: boolean }> {
  const [{ stdout: gitSha }, { stdout: status }] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd }),
    execFileAsync('git', ['status', '--porcelain'], { cwd }),
  ]);
  return {
    gitSha: gitSha.trim(),
    dirty: status.trim().length > 0,
  };
}

function safeErrorClass(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(name) ? name : 'UnknownError';
}
