import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";
import {
  EXPECTED_OUTCOME_SCENARIO_IDS,
  runOutcomeJudgments,
  type OutcomeJudgmentArtifact,
} from "../../scripts/run-outcome-judgments.js";
import type { OutcomeEvidenceBundle } from "../../src/evaluation/outcomeJudge.js";

const execFile = promisify(execFileCallback);

function evidence(scenarioId: string): OutcomeEvidenceBundle {
  return {
    scenarioId,
    finalState: "cart_ready",
    useCases: ["order completion"],
    expectations: ["The requested order is ready for confirmation"],
    turns: [
      { role: "user", text: "Tôi muốn đặt món" },
      { role: "assistant", text: "Đơn hàng đã sẵn sàng xác nhận" },
    ],
    toolTrace: [{ toolName: "previewCart", status: "completed" }],
    genUiAttachments: [{ widgetKind: "orderSummary", actionIds: [], values: { customerId: "customer-secret" } }],
    monitorEvents: [{ type: "assistant_reply_sent" }],
  };
}

const judgment = JSON.stringify({
  passed: true,
  score: 100,
  achievedOutcome: "The order is ready for confirmation",
  missedExpectations: [],
  safetyIssues: [],
  rationale: "The evidence shows a completed cart preview and a confirmation-ready reply.",
});

function modelWithInvoke(invoke: ReturnType<typeof vi.fn>): BaseChatModel {
  return {
    withStructuredOutput: () => ({ invoke }),
  } as unknown as BaseChatModel;
}

describe("runOutcomeJudgments", () => {
  it("uses the TS CLI env-file loader instead of shell sourcing in eval:outcomes", async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["eval:outcomes"]).toBe(
      "tsx -- scripts/run-outcome-judgments.ts --env-file ../../.env",
    );
  });

  it("prints usage and exits cleanly when eval:outcomes has no required arguments", async () => {
    const result = await execFile("npm", ["run", "--silent", "eval:outcomes"], {
      cwd: process.cwd(),
      env: { ...process.env },
    });

    expect(result.stdout).toContain("Usage: tsx scripts/run-outcome-judgments.ts");
    expect(result.stdout).toContain("OUTCOME_JUDGE_TIMEOUT_MS");
    expect(result.stderr).toBe("");
  });

  it("judges all nine bundles and writes a provenance-bearing redacted artifact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outcome-judgments-"));
    try {
      const evidencePath = join(directory, "evidence.json");
      const outputPath = join(directory, "judgments.json");
      const releasePath = join(directory, "release.json");
      await writeFile(evidencePath, JSON.stringify({ scenarios: EXPECTED_OUTCOME_SCENARIO_IDS.map((scenarioId) => evidence(` ${scenarioId} `)) }));
      await writeFile(releasePath, JSON.stringify({ gitSha: "abc123", releaseBuiltAt: "2026-07-11T08:30:00Z", dirty: false }));
      await writeFile(outputPath, "old artifact\n");

      const calls: BaseMessage[][] = [];
      const invoke = vi.fn(async (messages: BaseMessage[]) => {
        calls.push(messages);
        expect(messages[1]?.content).not.toContain("customer-secret");
        return JSON.parse(judgment) as unknown;
      });

      await runOutcomeJudgments({
        evidencePath,
        outputPath,
        releaseMetadataPath: releasePath,
        model: "test-outcome-model",
        judgeModel: modelWithInvoke(invoke),
        judgedAt: "2026-07-11T09:00:00Z",
      });

      const artifact = JSON.parse(await readFile(outputPath, "utf8")) as OutcomeJudgmentArtifact;
      expect(calls).toHaveLength(9);
      expect(invoke).toHaveBeenCalledTimes(9);
      expect(artifact).toMatchObject({
        gitSha: "abc123",
        releaseBuiltAt: "2026-07-11T08:30:00Z",
        dirty: false,
        model: "test-outcome-model",
        judgedAt: "2026-07-11T09:00:00Z",
      });
      expect(artifact.scenarios).toHaveLength(9);
      expect(artifact.scenarios.map(({ scenarioId }) => scenarioId)).toEqual(EXPECTED_OUTCOME_SCENARIO_IDS);
      expect(JSON.stringify(artifact)).not.toContain("customerId");
      expect(JSON.stringify(artifact)).not.toContain("customer-secret");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves an existing artifact when any model judgment fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outcome-judgments-"));
    try {
      const evidencePath = join(directory, "evidence.json");
      const outputPath = join(directory, "judgments.json");
      const releasePath = join(directory, "release.json");
      await writeFile(evidencePath, JSON.stringify({ scenarios: EXPECTED_OUTCOME_SCENARIO_IDS.map(evidence) }));
      await writeFile(releasePath, JSON.stringify({ gitSha: "abc123", releaseBuiltAt: "2026-07-11T08:30:00Z", dirty: false }));
      await writeFile(outputPath, "existing artifact\n");

      let calls = 0;
      const judgeModel = modelWithInvoke(vi.fn(async () => {
        calls += 1;
        return calls === 4
          ? "not-json"
          : JSON.parse(judgment) as unknown;
      }));

      await expect(runOutcomeJudgments({
        evidencePath,
        outputPath,
        releaseMetadataPath: releasePath,
        judgeModel,
      })).rejects.toThrow(
        "Outcome judgment was not valid JSON",
      );
      await expect(readFile(outputPath, "utf8")).resolves.toBe("existing artifact\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["duplicate", [...EXPECTED_OUTCOME_SCENARIO_IDS.slice(0, -1), EXPECTED_OUTCOME_SCENARIO_IDS[0]]],
    ["missing", EXPECTED_OUTCOME_SCENARIO_IDS.slice(0, -1)],
    ["extra", [...EXPECTED_OUTCOME_SCENARIO_IDS.slice(0, -1), "10-extra-scenario"]],
  ])("rejects %s scenario IDs", async (_label, scenarioIds) => {
    const directory = await mkdtemp(join(tmpdir(), "outcome-judgments-"));
    try {
      const evidencePath = join(directory, "evidence.json");
      const releasePath = join(directory, "release.json");
      await writeFile(evidencePath, JSON.stringify({ scenarios: scenarioIds.map(evidence) }));
      await writeFile(releasePath, JSON.stringify({ gitSha: "abc123", releaseBuiltAt: "2026-07-11T08:30:00Z", dirty: false }));

      await expect(runOutcomeJudgments({
        evidencePath,
        outputPath: join(directory, "judgments.json"),
        releaseMetadataPath: releasePath,
        judgeModel: modelWithInvoke(
          vi.fn().mockResolvedValue(JSON.parse(judgment) as unknown),
        ),
      })).rejects.toThrow("Outcome evidence scenario IDs must exactly match the canonical nine scenarios");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects whitespace-only evidence strings and trims valid strings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outcome-judgments-"));
    try {
      const evidencePath = join(directory, "evidence.json");
      const releasePath = join(directory, "release.json");
      const outputPath = join(directory, "judgments.json");
      const invalid = evidence(EXPECTED_OUTCOME_SCENARIO_IDS[0]);
      invalid.turns[0].text = "   ";
      await writeFile(evidencePath, JSON.stringify({ scenarios: [invalid] }));
      await writeFile(releasePath, JSON.stringify({ gitSha: "abc123", releaseBuiltAt: "2026-07-11T08:30:00Z", dirty: false }));
      await expect(runOutcomeJudgments({
        evidencePath,
        outputPath,
        releaseMetadataPath: releasePath,
        judgeModel: modelWithInvoke(
          vi.fn().mockResolvedValue(JSON.parse(judgment) as unknown),
        ),
      })).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
