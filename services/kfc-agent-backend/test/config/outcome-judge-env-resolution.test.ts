import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveOutcomeJudgeEnv } from "../../src/config/outcomeJudgeEnvResolution.js";

describe("resolveOutcomeJudgeEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses KFC_OUTCOME_JUDGE_ENV_FILE when explicitly set to an existing file", async () => {
    const root = await mkdtemp(join(tmpdir(), "outcome-judge-explicit-"));
    try {
      const envFile = join(root, "explicit.env");
      await writeFile(envFile, "OPENAI_API_KEY=explicit-key\n");
      vi.stubEnv("KFC_OUTCOME_JUDGE_ENV_FILE", envFile);

      await expect(resolveOutcomeJudgeEnv("/workspace/root")).resolves.toEqual({
        envFile,
        source: "explicit",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the worktree root .env when it exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "outcome-judge-root-"));
    try {
      const envFile = join(root, ".env");
      await writeFile(envFile, "OPENAI_API_KEY=worktree-key\n");

      await expect(resolveOutcomeJudgeEnv(root)).resolves.toEqual({
        envFile,
        source: "root",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to the main checkout .env derived from worktree git metadata", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "outcome-judge-worktree-"));
    try {
      const mainCheckout = join(sandbox, "hackathon");
      const worktreeRoot = join(mainCheckout, ".worktrees", "judge");
      const gitDir = join(mainCheckout, ".git", "worktrees", "judge");
      await mkdir(gitDir, { recursive: true });
      await mkdir(worktreeRoot, { recursive: true });
      await writeFile(join(mainCheckout, ".env"), "OPENAI_API_KEY=main-key\n");
      await writeFile(join(worktreeRoot, ".git"), `gitdir: ${gitDir}\n`);
      await writeFile(join(gitDir, "commondir"), "../..");

      await expect(resolveOutcomeJudgeEnv(worktreeRoot)).resolves.toEqual({
        envFile: join(mainCheckout, ".env"),
        source: "main",
      });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("returns undefined when no supported env file exists and no explicit override is set", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "outcome-judge-missing-env-"));
    try {
      const mainCheckout = join(sandbox, "hackathon");
      const worktreeRoot = join(mainCheckout, ".worktrees", "judge");
      const gitDir = join(mainCheckout, ".git", "worktrees", "judge");
      await mkdir(gitDir, { recursive: true });
      await mkdir(worktreeRoot, { recursive: true });
      await writeFile(join(worktreeRoot, ".git"), `gitdir: ${gitDir}\n`);
      await writeFile(join(gitDir, "commondir"), "../..");

      await expect(resolveOutcomeJudgeEnv(worktreeRoot)).resolves.toEqual({ source: "none" });
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("does not fall back when an explicit env file is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "outcome-judge-explicit-missing-"));
    try {
      await writeFile(join(root, ".env"), "OPENAI_API_KEY=root-key\n");
      vi.stubEnv("KFC_OUTCOME_JUDGE_ENV_FILE", join(root, "missing.env"));

      await expect(resolveOutcomeJudgeEnv(root)).resolves.toEqual({
        missingExplicitEnvFile: join(root, "missing.env"),
        source: "none",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores malformed worktree metadata instead of guessing", async () => {
    const root = await mkdtemp(join(tmpdir(), "outcome-judge-bad-git-"));
    try {
      await writeFile(join(root, ".git"), "not-a-gitdir\n");

      await expect(resolveOutcomeJudgeEnv(root)).resolves.toEqual({ source: "none" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
