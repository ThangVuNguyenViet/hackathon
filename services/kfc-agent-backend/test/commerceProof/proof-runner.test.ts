import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMockCommerceProof } from "../../src/commerceProof/proofRunner.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("mock commerce proof runner", () => {
  it("fails the presentation gate when LangSmith credentials are absent", async () => {
    const previous = process.env.LANGSMITH_API_KEY;
    delete process.env.LANGSMITH_API_KEY;
    const artifactRoot = await mkdtemp(join(tmpdir(), "kfc-commerce-proof-langsmith-"));
    roots.push(artifactRoot);
    try {
      await expect(
        runMockCommerceProof({ artifactRoot, requireLangSmith: true }),
      ).rejects.toThrow(/LANGSMITH_API_KEY/);
    } finally {
      if (previous === undefined) delete process.env.LANGSMITH_API_KEY;
      else process.env.LANGSMITH_API_KEY = previous;
    }
  });

  it("runs eight scenarios through real HTTP services and writes an honest manifest", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "kfc-commerce-proof-"));
    roots.push(artifactRoot);

    const manifest = await runMockCommerceProof({
      artifactRoot,
      requireLangSmith: false,
      timeoutMs: 30,
      timeoutScenarioDelayMs: 75,
    });

    expect(manifest.passed).toBe(true);
    expect(manifest.scenarioCount).toBe(8);
    expect(manifest.scenarios.every((scenario) => scenario.passed)).toBe(true);
    expect(manifest.scenarios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scenarioId: "successful-placement",
          entryPath: "kfc-agent-backend",
          outcome: "accepted",
        }),
        expect.objectContaining({
          scenarioId: "pos-timeout",
          entryPath: "kfc-agent-backend",
          outcome: "ambiguous_pos_submission",
        }),
        expect.objectContaining({
          scenarioId: "successful-cancellation",
          entryPath: "gateway-api",
          outcome: "cancelled",
          limitation: "cancelOrder is not currently exposed in the agent tool catalog",
        }),
      ]),
    );
    expect(manifest.readiness).toMatchObject({
      agent: "ready",
      gateway: "ready",
      oms: "ready",
      pos: "ready",
    });
    expect(manifest.shutdown).toEqual({ complete: true, openServices: [] });

    const manifestJson = await readFile(join(artifactRoot, "manifest.json"), "utf8");
    expect(manifestJson).not.toContain("gateway-token");
    expect(manifestJson).not.toContain("oms-token");
    expect(manifestJson).not.toContain("pos-token");
    for (const scenario of manifest.scenarios) {
      const evaluation = JSON.parse(
        await readFile(join(artifactRoot, "scenarios", scenario.scenarioId, "evaluator-results.json"), "utf8"),
      ) as { passed: boolean };
      expect(evaluation.passed).toBe(true);
    }
  }, 20_000);
});
