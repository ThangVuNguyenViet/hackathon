import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  runOutcomeJudgments,
  type OutcomeJudgmentArtifact,
} from "../../scripts/run-outcome-judgments.js";
import { OpenAIOutcomeJudgeClient } from "../../src/evaluation/outcomeJudge.js";
import type {
  OutcomeEvidenceBundle,
  OutcomeJudgeClient,
} from "../../src/evaluation/outcomeJudge.js";

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

describe("runOutcomeJudgments", () => {
  it("uses the Responses API JSON output mode and returns model text", async () => {
    let request: RequestInit | undefined;
    const client = new OpenAIOutcomeJudgeClient({
      apiKey: "test-key",
      baseUrl: "https://openai.local/v1/",
      fetchImpl: async (_input, init) => {
        request = init;
        return new Response(JSON.stringify({ output_text: judgment }), { status: 200 });
      },
    });

    await expect(client.complete({ model: "judge-model", system: "system", user: "evidence" })).resolves.toBe(judgment);
    expect(request?.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      model: "judge-model",
      text: { format: { type: "json_object" } },
    });
  });

  it("judges all nine bundles and writes a provenance-bearing redacted artifact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outcome-judgments-"));
    try {
      const evidencePath = join(directory, "evidence.json");
      const outputPath = join(directory, "judgments.json");
      const releasePath = join(directory, "release.json");
      await writeFile(evidencePath, JSON.stringify({ scenarios: Array.from({ length: 9 }, (_, i) => evidence(`scenario-${i + 1}`)) }));
      await writeFile(releasePath, JSON.stringify({ gitSha: "abc123", releaseBuiltAt: "2026-07-11T08:30:00Z", dirty: false }));

      const calls: string[] = [];
      const client: OutcomeJudgeClient = {
        async complete(input) {
          calls.push(input.model);
          expect(input.user).not.toContain("customer-secret");
          return judgment;
        },
      };

      await runOutcomeJudgments({
        evidencePath,
        outputPath,
        releaseMetadataPath: releasePath,
        model: "test-outcome-model",
        client,
        judgedAt: "2026-07-11T09:00:00Z",
      });

      const artifact = JSON.parse(await readFile(outputPath, "utf8")) as OutcomeJudgmentArtifact;
      expect(calls).toHaveLength(9);
      expect(calls).toEqual(Array(9).fill("test-outcome-model"));
      expect(artifact).toMatchObject({
        gitSha: "abc123",
        releaseBuiltAt: "2026-07-11T08:30:00Z",
        dirty: false,
        model: "test-outcome-model",
        judgedAt: "2026-07-11T09:00:00Z",
      });
      expect(artifact.scenarios).toHaveLength(9);
      expect(JSON.stringify(artifact)).not.toContain("customerId");
      expect(JSON.stringify(artifact)).not.toContain("customer-secret");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not leave an output artifact when any model judgment is malformed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outcome-judgments-"));
    try {
      const evidencePath = join(directory, "evidence.json");
      const outputPath = join(directory, "judgments.json");
      const releasePath = join(directory, "release.json");
      await writeFile(evidencePath, JSON.stringify({ scenarios: Array.from({ length: 9 }, (_, i) => evidence(`scenario-${i + 1}`)) }));
      await writeFile(releasePath, JSON.stringify({ gitSha: "abc123", releaseBuiltAt: "2026-07-11T08:30:00Z", dirty: false }));

      let calls = 0;
      const client: OutcomeJudgeClient = {
        async complete() {
          calls += 1;
          return calls === 4 ? "not-json" : judgment;
        },
      };

      await expect(runOutcomeJudgments({ evidencePath, outputPath, releaseMetadataPath: releasePath, client })).rejects.toThrow(
        "Outcome judgment was not valid JSON",
      );
      await expect(readFile(outputPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
