import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface OutcomeJudgeEnvResolution {
  envFile?: string;
  missingExplicitEnvFile?: string;
  source: "explicit" | "root" | "main" | "none";
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function resolveGitCommonDir(rootDir: string): Promise<string | undefined> {
  const dotGitPath = join(rootDir, ".git");
  try {
    const dotGitStat = await stat(dotGitPath);
    if (dotGitStat.isDirectory()) return dotGitPath;
    if (!dotGitStat.isFile()) return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  const gitPointer = (await readFile(dotGitPath, "utf8")).trim();
  const gitDir = /^gitdir:\s*(.+)$/.exec(gitPointer)?.[1]?.trim();
  if (!gitDir) return undefined;

  const resolvedGitDir = resolve(rootDir, gitDir);
  const commonDirPath = join(resolvedGitDir, "commondir");
  let commonDirRaw: string;
  try {
    commonDirRaw = (await readFile(commonDirPath, "utf8")).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (!commonDirRaw) return undefined;

  return resolve(resolvedGitDir, commonDirRaw);
}

export async function resolveOutcomeJudgeEnv(rootDir: string, environment: NodeJS.ProcessEnv = process.env): Promise<OutcomeJudgeEnvResolution> {
  const explicit = environment.KFC_OUTCOME_JUDGE_ENV_FILE?.trim();
  if (explicit) {
    return await fileExists(explicit)
      ? { envFile: explicit, source: "explicit" }
      : { missingExplicitEnvFile: explicit, source: "none" };
  }

  const rootEnvFile = join(rootDir, ".env");
  if (await fileExists(rootEnvFile)) return { envFile: rootEnvFile, source: "root" };

  const commonDir = await resolveGitCommonDir(rootDir);
  if (!commonDir) return { source: "none" };

  const mainCheckoutEnvFile = join(dirname(commonDir), ".env");
  if (await fileExists(mainCheckoutEnvFile)) return { envFile: mainCheckoutEnvFile, source: "main" };

  return { source: "none" };
}
