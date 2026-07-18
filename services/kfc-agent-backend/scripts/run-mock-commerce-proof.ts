import { resolve } from "node:path";
import { runMockCommerceProof } from "../src/commerceProof/proofRunner.js";
import type { ResponseComposer } from "../src/llm/responseComposer.js";

const args = process.argv.slice(2);
const requireLangSmith = args.includes("--require-langsmith");
const artifactRootArg = valueAfter(args, "--artifact-root");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const artifactRoot = resolve(
  artifactRootArg ?? `../../artifacts/mock-commerce-proof/${runId}`,
);
const proofResponseComposer: ResponseComposer = {
  async composeResponse() {
    return "Mock commerce proof response.";
  },
};

const manifest = await runMockCommerceProof({
  artifactRoot,
  requireLangSmith,
  responseComposer: proofResponseComposer,
});

console.log(
  JSON.stringify(
    {
      ok: manifest.passed,
      artifactRoot,
      runId: manifest.runId,
      scenarioCount: manifest.scenarioCount,
      passedScenarios: manifest.scenarios.filter((scenario) => scenario.passed).length,
      langsmith: manifest.langsmith,
    },
    null,
    2,
  ),
);

if (!manifest.passed) process.exitCode = 1;

function valueAfter(values: string[], flag: string): string | undefined {
  const index = values.indexOf(flag);
  if (index < 0) return undefined;
  const value = values[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}
