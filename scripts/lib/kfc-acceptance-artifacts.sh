#!/usr/bin/env bash

atomic_write_json_file() {
  local path="$1"
  local content="$2"
  node - "$path" "$content" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
const content = process.argv[3];
const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
try {
  fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(temporaryPath, path);
} finally {
  try { fs.unlinkSync(temporaryPath); } catch {}
}
NODE
}

finalize_acceptance_failure() {
  local manifest="$1"
  local output_dir="$2"
  local run_id="$3"
  local phase="$4"
  local status="$5"
  local content

  rm -f -- "$output_dir/SHA256SUMS" "$output_dir/proof-bundle.tar.gz"
  content="$(node - "$manifest" "$run_id" "$phase" "$status" <<'NODE'
const fs = require('node:fs');
const [path, runId, phase, status] = process.argv.slice(2);
let prior = {};
try { prior = JSON.parse(fs.readFileSync(path, 'utf8')); } catch {}
process.stdout.write(JSON.stringify({
  ...prior,
  runId,
  passed: false,
  acceptanceStatus: 'failed',
  failedPhase: phase,
  exitCode: Number(status),
  finalizedAt: new Date().toISOString(),
}, null, 2) + '\n');
NODE
)"
  atomic_write_json_file "$manifest" "$content"
}
