#!/usr/bin/env node

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isDeepStrictEqual } = require('node:util');
const command = process.argv[2];
process.argv = [process.argv[0], process.argv[1], ...process.argv.slice(3)];

function assertAgentRuntimeIdentity(proof) {
  const versions = proof?.versions;
  const agent = versions?.agent;
  const versionKeys = versions && typeof versions === 'object'
    ? Object.keys(versions).sort()
    : [];
  const agentKeys = agent && typeof agent === 'object'
    ? Object.keys(agent).sort()
    : [];
  if (JSON.stringify(versionKeys) !== JSON.stringify(['agent', 'ledger', 'ranker', 'toolCatalog'])
      || JSON.stringify(agentKeys) !== JSON.stringify(['model', 'profile', 'provider'])
      || !['openai', 'google'].includes(agent.provider)
      || typeof agent.model !== 'string' || !agent.model
      || typeof agent.profile !== 'string' || !agent.profile) {
    throw new Error('Deep readiness does not contain one valid agent runtime identity');
  }
}

function sameAgentRuntimeIdentity(expected, actual) {
  assertAgentRuntimeIdentity(expected);
  assertAgentRuntimeIdentity(actual);
  return isDeepStrictEqual(actual.deployment, expected.deployment)
    && isDeepStrictEqual(actual.versions, expected.versions);
}

switch (command) {
  case 'check-1': {
    const fs = require('node:fs');
    const [path, gitSha, releaseBuiltAt, deploymentId] = process.argv.slice(2);
    fs.writeFileSync(path, JSON.stringify({ gitSha, deploymentId, releaseBuiltAt, dirty: false }) + '\n');
    break;
  }
  case 'check-2': {
    const fs = require('node:fs');
    const [expectedPath, actualPath] = process.argv.slice(2);
    const expected = JSON.parse(fs.readFileSync(expectedPath));
    const actual = JSON.parse(fs.readFileSync(actualPath));
    if (!actual.ok || JSON.stringify(actual.release) !== JSON.stringify(expected)) process.exit(1);
    break;
  }
  case 'check-3': {
    const fs = require('node:fs');
    const [candidatePath, pagePath, canonicalUrl, deploymentId] = process.argv.slice(2);
    const candidate = JSON.parse(fs.readFileSync(candidatePath));
    const page = JSON.parse(fs.readFileSync(pagePath));
    if (page.gitSha !== candidate.gitSha || page.releaseBuiltAt !== candidate.releaseBuiltAt || page.dirty !== false
        || page.deploymentId !== deploymentId || page.canonicalUrl !== canonicalUrl
        || !page.buildId || !page.project) process.exit(1);
    break;
  }
  case 'check-4': {
    const fs = require('node:fs');
    const [readinessPath, outputPath] = process.argv.slice(2);
    const readiness = JSON.parse(fs.readFileSync(readinessPath));
    if (!readiness.proof) throw new Error('Deep readiness is missing proof bindings');
    assertAgentRuntimeIdentity(readiness.proof);
    fs.writeFileSync(outputPath, `${JSON.stringify(readiness.proof, null, 2)}\n`);
    break;
  }
  case 'check-5': {
    const fs = require('node:fs');
    const crypto = require('node:crypto');
    const [releasePath, outputPath, releaseUrl] = process.argv.slice(2);
    const raw = fs.readFileSync(releasePath);
    const release = JSON.parse(raw);
    fs.writeFileSync(outputPath, `${JSON.stringify({ gitSha: release.gitSha, deploymentId: release.deploymentId, buildId: release.buildId, releaseUrl, project: release.project, releaseAssetSha256: crypto.createHash('sha256').update(raw).digest('hex'), releaseBuiltAt: release.releaseBuiltAt, dirty: false }, null, 2)}\n`);
    break;
  }
  case 'check-6': {
    const fs = require('node:fs');
    const [expectedPath, actualPath] = process.argv.slice(2);
    const expected = JSON.parse(fs.readFileSync(expectedPath));
    const actual = JSON.parse(fs.readFileSync(actualPath)).proof;
    if (!actual?.catalogObservation || !sameAgentRuntimeIdentity(expected, actual)) {
      throw new Error('Catalog observation is not bound to the qualified deployment');
    }
    break;
  }
  case 'check-7': {
    const crypto = require('node:crypto');
    const fs = require('node:fs');
    const [beforePath, afterPath, outputPath] = process.argv.slice(2);
    const proof = (file) => JSON.parse(fs.readFileSync(file)).proof;
    const before = proof(beforePath);
    const after = proof(afterPath);
    const changed = before.catalogObservation.sha256 !== after.catalogObservation.sha256;
    const document = {
      schemaVersion: 1,
      artifactKind: 'catalog-relevance-diff',
      algorithm: 'catalog-hash-conservative-v1',
      deployment: after.deployment,
      before: before.catalogObservation,
      after: after.catalogObservation,
      goldenAffected: changed,
      matrixAffected: changed,
    };
    document.sha256 = crypto.createHash('sha256').update(JSON.stringify(document)).digest('hex');
    fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
    break;
  }
  case 'check-8': {
    const fs = require('node:fs');
    const [expectedPath, runtimePath, actualPath] = process.argv.slice(2);
    const expected = JSON.parse(fs.readFileSync(expectedPath));
    const runtime = JSON.parse(fs.readFileSync(runtimePath));
    const actual = JSON.parse(fs.readFileSync(actualPath));
    if (!actual.ok || JSON.stringify(actual.release) !== JSON.stringify(expected)
        || !sameAgentRuntimeIdentity(runtime, actual.proof)) {
      throw new Error('Replacement Worker release identity mismatch');
    }
    break;
  }
  case 'check-9': {
    const crypto = require('node:crypto');
    const fs = require('node:fs');
    const path = require('node:path');
    const [gatePath, proofDir, gitSha, deploymentId, workerUrl, chatbotUrl, monitorUrl, latencyReport, digestPath, chatbotReleasePath] = process.argv.slice(2);
    const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
    let goldenStreak = 0;
    let matrixStreak = 0;
    for (let pass = 1; pass <= 5; pass += 1) {
      if (pass > 1) {
        const relevance = read(path.join(proofDir, 'catalog', pass <= 3 ? `cycle-${pass}-relevance.json` : `golden-${pass}-relevance.json`));
        const { sha256, ...unhashed } = relevance;
        if (relevance.schemaVersion !== 1 || relevance.artifactKind !== 'catalog-relevance-diff'
            || relevance.algorithm !== 'catalog-hash-conservative-v1'
            || sha256 !== crypto.createHash('sha256').update(JSON.stringify(unhashed)).digest('hex')
            || relevance.deployment.gitSha !== gitSha || relevance.deployment.deploymentId !== deploymentId) {
          throw new Error(`Pass ${pass} lacks a schema-bound generated catalog relevance diff`);
        }
        if (relevance.goldenAffected) goldenStreak = 0;
        if (relevance.matrixAffected) matrixStreak = 0;
      }
      const kfc = read(path.join(proofDir, 'kfc', pass <= 3 ? `cycle-${pass}` : `golden-${pass}`, 'manifest.json'));
      if (kfc.status !== 'PASS' || kfc.passed !== true || kfc.retries !== 0) throw new Error(`KFC pass ${pass} is ineligible`);
      goldenStreak += 1;
      if (pass <= 3) {
        const messenger = read(path.join(proofDir, 'messenger', `cycle-${pass}`, 'manifest.json'));
        if (kfc.proofMode !== 'full' || messenger.status !== 'PASS' || messenger.retries !== 0 || messenger.manualRepairs !== 0) {
          throw new Error(`Matrix pass ${pass} is ineligible`);
        }
        matrixStreak += 1;
      }
    }
    if (goldenStreak !== 5 || matrixStreak !== 3) throw new Error(`Qualification streaks incomplete: golden=${goldenStreak} matrix=${matrixStreak}`);
    const latency = read(latencyReport);
    const chatbotRelease = read(chatbotReleasePath);
    const latencyStarted = Date.parse(latency.startedAt);
    const latencyCompleted = Date.parse(latency.completedAt);
    const releaseBuilt = Date.parse(chatbotRelease.releaseBuiltAt);
    if (latency.latency?.ok !== true || latency.traces?.ok !== true || latency.chatBaseUrl !== chatbotUrl
        || JSON.stringify(latency.release) !== JSON.stringify(chatbotRelease)
        || typeof latency.probeRunId !== 'string' || !latency.probeRunId.startsWith('latency-')
        || !Array.isArray(latency.samples) || latency.samples.length === 0
        || latency.samples.some((sample) => !String(sample.clientMessageId ?? '').includes(latency.probeRunId)
          || !String(sample.sessionId ?? '').includes(latency.probeRunId))
        || !Number.isFinite(latencyStarted) || !Number.isFinite(latencyCompleted) || !Number.isFinite(releaseBuilt)
        || releaseBuilt > latencyStarted || latencyStarted > latencyCompleted) {
      throw new Error('Production latency report is not bound to the qualified endpoint, release, and probe chronology');
    }
    const completionFiles = [
      ...[1, 2, 3].flatMap((pass) => [
        path.join(proofDir, 'kfc', `cycle-${pass}`, 'manifest.json'),
        path.join(proofDir, 'messenger', `cycle-${pass}`, 'manifest.json'),
      ]),
      ...[4, 5].map((pass) => path.join(proofDir, 'kfc', `golden-${pass}`, 'manifest.json')),
    ];
    const qualificationCompleted = Math.max(...completionFiles.map((file) =>
      Date.parse(JSON.parse(fs.readFileSync(file, 'utf8')).completedAt)));
    const issuedAt = Date.now();
    if (!Number.isFinite(qualificationCompleted) || qualificationCompleted > issuedAt || latencyCompleted > issuedAt
        || issuedAt - qualificationCompleted > 24 * 60 * 60 * 1000 || issuedAt - latencyCompleted > 24 * 60 * 60 * 1000) {
      throw new Error('Qualification or latency completion time is invalid, stale, or in the future');
    }
    const digestManifest = read(digestPath);
    const { sha256: digestSha256, ...unhashedDigest } = digestManifest;
    if (digestManifest.schemaVersion !== 1 || digestManifest.artifactKind !== 'kfc-qualification-digest-manifest'
        || digestSha256 !== crypto.createHash('sha256').update(JSON.stringify(unhashedDigest)).digest('hex')) {
      throw new Error('Qualification digest manifest is invalid');
    }
    const gate = {
      schemaVersion: 1,
      artifactKind: 'kfc-stage-evidence-gate',
      gateId: crypto.randomUUID(),
      gitSha,
      deploymentId,
      workerUrl,
      chatbotUrl,
      monitorUrl,
      latencyReport: 'latency/report.json',
      qualificationDigestSha256: digestSha256,
      qualificationCompletedAt: new Date(qualificationCompleted).toISOString(),
      issuedAt: new Date(issuedAt).toISOString(),
    };
    fs.writeFileSync(gatePath, `${JSON.stringify(gate, null, 2)}\n`);
    break;
  }
  case 'check-10': {
    const fs = require('node:fs');
    const [expectedPath, runtimePath, actualPath] = process.argv.slice(2);
    const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
    const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    const actual = JSON.parse(fs.readFileSync(actualPath, 'utf8'));
    if (!actual.ok || JSON.stringify(actual.release) !== JSON.stringify(expected)
        || !sameAgentRuntimeIdentity(runtime, actual.proof)) process.exit(1);
    break;
  }
  case 'check-11': {
    const crypto = require('node:crypto');
    const fs = require('node:fs');
    const path = require('node:path');
    const [inputDir, outputDir, runtimePath, gatePath, gitSha, deploymentId] = process.argv.slice(2);
    const read = (name) => JSON.parse(fs.readFileSync(path.join(inputDir, name), 'utf8'));
    const pass = (value, name) => {
      if (value.schemaVersion !== 1 || value.status !== 'PASS' || value.gitSha !== gitSha || value.deploymentId !== deploymentId) {
        throw new Error(`${name} is not bound to the qualified release`);
      }
    };
    const recording = read('recording-manifest.json');
    const rehearsal1 = read('rehearsal-1.json');
    const rehearsal2 = read('rehearsal-2.json');
    const finalRun = read('final-run.json');
    const preflight = read('stage-preflight.json');
    pass(recording, 'recording manifest');
    pass(rehearsal1, 'rehearsal 1');
    pass(rehearsal2, 'rehearsal 2');
    pass(finalRun, 'final run');
    pass(preflight, 'stage preflight');
    const gate = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
    if (gate.schemaVersion !== 1 || gate.artifactKind !== 'kfc-stage-evidence-gate'
        || gate.gitSha !== gitSha || gate.deploymentId !== deploymentId) {
      throw new Error('Qualification gate is invalid');
    }
    for (const [name, value] of [['recording manifest', recording], ['rehearsal 1', rehearsal1], ['rehearsal 2', rehearsal2], ['stage preflight', preflight], ['final run', finalRun]]) {
      if (value.qualificationGateId !== gate.gateId) throw new Error(`${name} is not bound to the current qualification gate`);
    }
    const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    const expectedStates = ['addressFulfillmentCheck', 'cartBuilder', 'orderReviewConfirm', 'orderTrackingStatus', 'paymentOrderStatus', 'smartMenuPicker', 'supportHandoff'];
    if (recording.catalogObservationId !== runtime.catalogObservation.id
        || recording.catalogSha256 !== runtime.catalogObservation.sha256
        || JSON.stringify(recording.expectedStates) !== JSON.stringify(expectedStates)) {
      throw new Error('Recording is not bound to the qualified catalog observation and expected states');
    }
    const recordingPath = path.resolve(inputDir, recording.recording?.path ?? '');
    if (!recordingPath.startsWith(`${path.resolve(inputDir)}${path.sep}`) || !fs.statSync(recordingPath).isFile()
        || recording.recording.durationSeconds < 300
        || crypto.createHash('sha256').update(fs.readFileSync(recordingPath)).digest('hex') !== recording.recording.sha256) {
      throw new Error('Five-minute recording is missing or its checksum is invalid');
    }
    const recordingCompleted = Date.parse(recording.completedAt);
    const completed1 = Date.parse(rehearsal1.completedAt);
    const completed2 = Date.parse(rehearsal2.completedAt);
    const finalCompleted = Date.parse(finalRun.completedAt);
    const checkedAt = Date.parse(preflight.checkedAt);
    const now = Date.now();
    const gateIssued = Date.parse(gate.issuedAt);
    const qualificationCompleted = Date.parse(gate.qualificationCompletedAt);
    const latencyCompleted = Date.parse(JSON.parse(fs.readFileSync(path.join(path.dirname(gatePath), gate.latencyReport), 'utf8')).completedAt);
    const stageBoundary = Math.max(gateIssued, qualificationCompleted, latencyCompleted);
    const orderedTimes = [stageBoundary, recordingCompleted, completed1, completed2, checkedAt, finalCompleted];
    const allTimes = [gateIssued, qualificationCompleted, latencyCompleted, recordingCompleted, completed1, completed2, checkedAt, finalCompleted];
    if (!allTimes.every(Number.isFinite)
        || allTimes.some((time) => time > now)
        || allTimes.some((time) => now - time > 24 * 60 * 60 * 1000)
        || orderedTimes.some((time, index) => index > 0 && time <= orderedTimes[index - 1])
        || rehearsal1.rehearsalNumber !== 1 || rehearsal2.rehearsalNumber !== 2
        || rehearsal1.retries !== 0 || rehearsal2.retries !== 0 || rehearsal1.manualRepairs !== 0 || rehearsal2.manualRepairs !== 0
        || rehearsal1.fallbackPlaybackPassed !== true || rehearsal2.fallbackPlaybackPassed !== true
        || preflight.fallbackPlaybackPassed !== true) {
      throw new Error('Two ordered rehearsals and a final stage preflight within 24 hours are required');
    }
    fs.mkdirSync(outputDir, { recursive: true });
    for (const name of ['recording-manifest.json', 'rehearsal-1.json', 'rehearsal-2.json', 'final-run.json', 'stage-preflight.json']) {
      fs.copyFileSync(path.join(inputDir, name), path.join(outputDir, name));
    }
    fs.copyFileSync(recordingPath, path.join(outputDir, path.basename(recordingPath)));
    break;
  }
  case 'check-12': {
    const fs = require('node:fs');
    const path = require('node:path');
    const crypto = require('node:crypto');
    const [runId, gitSha, releaseBuiltAt, workerUrl, chatbotUrl, monitorUrl, outputDir, latencyReport] = process.argv.slice(2);
    const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
    let goldenStreak = 0;
    let matrixStreak = 0;
    const attempts = [];
    for (let pass = 1; pass <= 5; pass += 1) {
      if (pass > 1) {
        const relevancePath = path.join(outputDir, 'catalog', pass <= 3 ? `cycle-${pass}-relevance.json` : `golden-${pass}-relevance.json`);
        const relevance = read(relevancePath);
        const { sha256, ...unhashed } = relevance;
        const actualHash = crypto.createHash('sha256').update(JSON.stringify(unhashed)).digest('hex');
        if (relevance.schemaVersion !== 1 || relevance.artifactKind !== 'catalog-relevance-diff'
            || relevance.algorithm !== 'catalog-hash-conservative-v1' || sha256 !== actualHash
            || relevance.deployment.gitSha !== gitSha || relevance.deployment.deploymentId !== `worker-${runId}`) {
          throw new Error(`Pass ${pass} lacks a schema-bound generated catalog relevance diff`);
        }
        if (relevance.goldenAffected) goldenStreak = 0;
        if (relevance.matrixAffected) matrixStreak = 0;
      }
      const kfcPath = path.join(outputDir, 'kfc', pass <= 3 ? `cycle-${pass}` : `golden-${pass}`, 'manifest.json');
      const kfc = read(kfcPath);
      if (kfc.status !== 'PASS' || kfc.passed !== true || kfc.retries !== 0) throw new Error(`KFC pass ${pass} is ineligible`);
      goldenStreak += 1;
      const attempt = { pass, kfcManifest: path.relative(outputDir, kfcPath) };
      if (pass <= 3) {
        const messengerPath = path.join(outputDir, 'messenger', `cycle-${pass}`, 'manifest.json');
        const messenger = read(messengerPath);
        if (kfc.proofMode !== 'full' || messenger.status !== 'PASS' || messenger.retries !== 0 || messenger.manualRepairs !== 0) {
          throw new Error(`Matrix pass ${pass} is ineligible`);
        }
        matrixStreak += 1;
        attempt.messengerManifest = path.relative(outputDir, messengerPath);
      }
      attempts.push(attempt);
    }
    if (goldenStreak !== 5 || matrixStreak !== 3) throw new Error(`Qualification streaks incomplete: golden=${goldenStreak} matrix=${matrixStreak}`);
    const latency = read(latencyReport);
    if (latency.latency?.ok !== true || latency.traces?.ok !== true) throw new Error('Production latency report is not accepted');
    process.stdout.write(JSON.stringify({ schemaVersion: 1, artifactKind: 'kfc-deployed-release-candidate', runId, passed: true, acceptanceStatus: 'accepted', gitSha, releaseBuiltAt, dirty: false, workerUrl, chatbotUrl, monitorUrl, bindings: { runtime: 'runtime-binding.json', flutter: 'flutter-release.json' }, qualification: { goldenStreak, matrixStreak, attempts, gate: 'qualification-gate.json', digests: 'qualification-digests.json' }, latency: { path: 'latency/report.json', probeRunId: latency.probeRunId, startedAt: latency.startedAt, completedAt: latency.completedAt }, durability: { before: 'durability-turns-before.json', after: 'durability-turns-after.json' }, stage: { recording: 'stage/recording-manifest.json', rehearsals: ['stage/rehearsal-1.json', 'stage/rehearsal-2.json'], finalRun: 'stage/final-run.json', preflight: 'stage/stage-preflight.json' }, finalizedAt: new Date().toISOString() }, null, 2) + '\n');
    break;
  }
  default:
    throw new Error(`Unknown acceptance check: ${command ?? '<missing>'}`);
}
