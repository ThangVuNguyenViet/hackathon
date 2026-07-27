import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('protected trace qualification integration', () => {
  it('exposes a real live qualification command', async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts['test:live:protected-trace']).toContain(
      'run-protected-trace-qualification.ts',
    );
  });

  it('wires required proof into the current V2 replay flow and six-slot assembler', async () => {
    const replaySource = await readFile(
      join(process.cwd(), 'test/scenarios/live-ai-scenario-replay.test.ts'),
      'utf8',
    );
    const campaignSource = await readFile(
      join(process.cwd(), 'scripts/run-protected-trace-qualification.ts'),
      'utf8',
    );

    expect(replaySource).toContain('resolveProtectedTraceQualificationConfig');
    expect(replaySource).toContain('protectedTraceApplicabilityForTurn');
    expect(replaySource).toContain('requiredProof:');
    expect(replaySource).toContain('requiredProofReceipt()');
    expect(replaySource).toContain('writeVerifiedAgentTraceReceipt');
    expect(campaignSource).toContain('live-ai-scenario-replay.test.ts');
    expect(campaignSource).toContain('reverifyAgentTraceReceiptPayload');
    expect(campaignSource).toContain('verifyProtectedProofArtifacts');
    expect(campaignSource).toContain('createProtectedCommandProofManifest');
  });
});
