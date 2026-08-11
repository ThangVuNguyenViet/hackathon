import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const forbidden = [
  {
    label: 'raw Responses execution',
    pattern: /\bresponses\s*\.\s*create\s*\(/u,
  },
  {
    label: 'manual function-call output assembly',
    pattern: /\bfunction_call_output\b/u,
  },
  {
    label: 'forced semantic tool choice',
    pattern: /\btool_choice\s*:\s*['"]required['"]/u,
  },
  {
    label: 'custom generic model/tool loop',
    pattern: /\brunResponsesToolLoop\b/u,
  },
];

export function directAgentSdkBoundaryViolations(source) {
  return forbidden
    .filter(({ pattern }) => pattern.test(source))
    .map(({ label }) => label);
}

async function main() {
  const runtimeUrl = new URL(
    '../src/agent/openAiResponsesExecutor.ts',
    import.meta.url,
  );
  const violations = directAgentSdkBoundaryViolations(
    await readFile(runtimeUrl, 'utf8'),
  );
  if (violations.length === 0) return;
  for (const violation of violations) {
    console.error(`Direct agent SDK boundary violation: ${violation}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
