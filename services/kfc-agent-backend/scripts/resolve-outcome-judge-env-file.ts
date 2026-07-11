import { resolve } from "node:path";
import { resolveOutcomeJudgeEnv } from "../src/config/outcomeJudgeEnvResolution.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const rootDir = resolve(arg("--root") ?? process.cwd());

resolveOutcomeJudgeEnv(rootDir).then((resolution) => {
  if (resolution.missingExplicitEnvFile) {
    console.error(
      `WARN: KFC_OUTCOME_JUDGE_ENV_FILE does not exist: ${resolution.missingExplicitEnvFile}. Continuing with already-exported environment only.`,
    );
  }
  if (resolution.envFile) process.stdout.write(`${resolution.envFile}\n`);
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
