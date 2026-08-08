#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { deriveReleaseSourceBindings } from "../lib/artifact-verification.js";

const inputPath = process.env.RELEASE_MANIFEST_INPUT_PATH;
const templatePath = process.env.SYNTHESIZED_SERVICE_TEMPLATE_PATH ??
  "cdk.out/KfcRecommendationProduction.template.json";
if (inputPath === undefined) throw new Error("RELEASE_MANIFEST_INPUT_PATH is required");
const input = JSON.parse(readFileSync(inputPath, "utf8")) as Record<string, unknown>;
if ("sourceRevision" in input || "cdkRevision" in input) {
  throw new Error("source bindings are build-owned and must not be caller supplied");
}
const gitHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const bindings = deriveReleaseSourceBindings(gitHead, readFileSync(templatePath));
process.stdout.write(`${JSON.stringify({ ...input, ...bindings }, null, 2)}\n`);
