#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

function read(path) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Qualification gate must be a JSON object');
  return value;
}

const qualificationExact = new Set([
  'release.json', 'destructive-migration-findings.txt', 'worker-initial.json', 'worker-ready-initial.json',
  'worker-replacement.json', 'worker-ready-replacement.json', 'pages.json', 'runtime-binding.json', 'flutter-release.json',
  'durability-events-before.json', 'durability-events-after.json', 'durability-turns-before.json', 'durability-turns-after.json',
]);
const isQualificationPath = (path) => qualificationExact.has(path)
  || /^worker-ready-poll-[1-3]\.json$/.test(path)
  || /^[^/]+\.release(?:-poll-[1-3])?\.json$/.test(path)
  || ['catalog/', 'live-scenarios/', 'kfc/', 'messenger/', 'latency/'].some((prefix) => path.startsWith(prefix));
const isPostQualificationPath = (path) => ['qualification-digests.json', 'qualification-gate.json', 'proof-manifest.json',
  'publication-failure.json', 'secret-scan-findings.txt', 'SHA256SUMS', 'proof-bundle.tar.gz'].includes(path)
  || ['publication-readiness/', 'stage/'].some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix));

function digestTree(root, qualificationOnly = false) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute);
      if (qualificationOnly && isPostQualificationPath(path)) continue;
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        if (qualificationOnly && !isQualificationPath(path)) throw new Error(`Unexpected qualification artifact: ${path}`);
        const bytes = readFileSync(absolute);
        files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      } else throw new Error(`Unsupported qualification artifact: ${path}`);
    }
  };
  visit(root);
  return files;
}

function createDigest(manifestPath, proofDir, inputDir) {
  const document = {
    schemaVersion: 1,
    artifactKind: 'kfc-qualification-digest-manifest',
    proofArtifacts: digestTree(proofDir, true),
    qualificationInputs: digestTree(inputDir),
  };
  document.sha256 = createHash('sha256').update(JSON.stringify(document)).digest('hex');
  writeFileSync(manifestPath, `${JSON.stringify(document, null, 2)}\n`);
}

function verifyDigest(gatePath, manifestPath, proofDir, inputDir) {
  const gate = read(gatePath);
  const manifest = read(manifestPath);
  const { sha256, ...unhashed } = manifest;
  if (manifest.schemaVersion !== 1 || manifest.artifactKind !== 'kfc-qualification-digest-manifest'
      || sha256 !== gate.qualificationDigestSha256
      || sha256 !== createHash('sha256').update(JSON.stringify(unhashed)).digest('hex')
      || JSON.stringify(manifest.proofArtifacts) !== JSON.stringify(digestTree(proofDir, true))
      || JSON.stringify(manifest.qualificationInputs) !== JSON.stringify(digestTree(inputDir))) {
    throw new Error('Qualified artifact or input digest mismatch');
  }
}

function verifyAges(gatePath, latencyPath, nowValue) {
  const gate = read(gatePath);
  const latency = read(latencyPath);
  const now = nowValue === undefined ? Date.now() : Date.parse(nowValue);
  const issued = Date.parse(gate.issuedAt);
  const qualification = Date.parse(gate.qualificationCompletedAt);
  const latencyCompleted = Date.parse(latency.completedAt);
  if (![now, issued, qualification, latencyCompleted].every(Number.isFinite)
      || [issued, qualification, latencyCompleted].some((time) => time > now || now - time > 24 * 60 * 60 * 1000)
      || qualification > issued || latencyCompleted > issued) {
    throw new Error('Qualification gate, qualification, or latency is invalid, future-dated, or older than 24 hours');
  }
}

const [command, ...args] = process.argv.slice(2);
if (command === 'create-digest' && args.length === 3) createDigest(args[0], args[1], args[2]);
else if (command === 'verify-digest' && args.length === 4) verifyDigest(args[0], args[1], args[2], args[3]);
else if (command === 'verify-ages' && (args.length === 2 || args.length === 3)) verifyAges(args[0], args[1], args[2]);
else throw new Error('Invalid qualification integrity command');
