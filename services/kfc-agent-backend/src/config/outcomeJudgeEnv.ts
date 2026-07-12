import { readFile } from "node:fs/promises";

export const SUPPORTED_OUTCOME_JUDGE_ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OUTCOME_JUDGE_MODEL",
  "OUTCOME_JUDGE_TIMEOUT_MS",
] as const;

type SupportedOutcomeJudgeEnvKey = typeof SUPPORTED_OUTCOME_JUDGE_ENV_KEYS[number];

const supportedKeys: ReadonlySet<string> = new Set(SUPPORTED_OUTCOME_JUDGE_ENV_KEYS);

function parseValue(rawValue: string, key: SupportedOutcomeJudgeEnvKey, lineNumber: number): string {
  const value = rawValue.trim();
  if (!value.startsWith("\"") && !value.startsWith("'")) {
    return value.replace(/\s+#.*$/, "").trim();
  }

  const quote = value[0];
  if (value.length < 2 || value.at(-1) !== quote) {
    throw new Error(`Malformed ${key} assignment on .env line ${lineNumber}`);
  }
  return value.slice(1, -1);
}

export function applySupportedOutcomeJudgeEnv(
  contents: string,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const assignment = line.replace(/^export\s+/, "").match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=([\s\S]*)$/);
    if (!assignment) {
      const possibleKey = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
      if (possibleKey && supportedKeys.has(possibleKey)) {
        throw new Error(`Malformed ${possibleKey} assignment on .env line ${index + 1}`);
      }
      continue;
    }

    const key = assignment[1];
    const rawValue = assignment[2];
    if (!key || rawValue === undefined) continue;
    if (!supportedKeys.has(key) || Object.prototype.hasOwnProperty.call(environment, key)) continue;
    environment[key] = parseValue(
      rawValue,
      key as SupportedOutcomeJudgeEnvKey,
      index + 1,
    );
  }
}

export async function loadSupportedOutcomeJudgeEnvFile(
  path: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  try {
    applySupportedOutcomeJudgeEnv(await readFile(path, "utf8"), environment);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}
