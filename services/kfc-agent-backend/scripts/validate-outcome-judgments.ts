import { readFile } from "node:fs/promises";
import { validateOutcomeJudgmentArtifact } from "../src/evaluation/outcomeJudgmentArtifact.js";

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`${label} was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function validateOutcomeJudgmentFiles(
  artifactPath: string,
  releaseMetadataPath: string,
): Promise<void> {
  const [artifactRaw, releaseRaw] = await Promise.all([
    readFile(artifactPath, "utf8"),
    readFile(releaseMetadataPath, "utf8"),
  ]);
  validateOutcomeJudgmentArtifact(
    parseJson(artifactRaw, "Outcome judgments"),
    parseJson(releaseRaw, "Release metadata"),
  );
}

if (process.argv[1]?.endsWith("validate-outcome-judgments.ts")) {
  validateOutcomeJudgmentFiles(arg("--artifact"), arg("--release-metadata")).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
