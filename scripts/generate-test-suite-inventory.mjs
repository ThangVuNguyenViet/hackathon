#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  extractCommandSurfaces,
  extractFlutter,
  extractShell,
  extractVitest,
  gitSnapshot,
  sha,
} from './lib/test-suite-inventory-extractors.mjs';

function argumentsFrom(argv) {
  const options = {
    sourceRoot: process.cwd(),
    sourceRootProvided: false,
    outputDir: resolve(process.cwd(), 'docs/wayfinder/test-suite-reset/assets'),
    check: false,
    checkSource: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--source-root') { options.sourceRoot = resolve(argv[++index]); options.sourceRootProvided = true; }
    else if (argument === '--output-dir') options.outputDir = resolve(argv[++index]);
    else if (argument === '--check') options.check = true;
    else if (argument === '--check-source') { options.check = true; options.checkSource = true; }
    else if (argument === '--help') {
      console.log('Usage: node scripts/generate-test-suite-inventory.mjs [--source-root <shared-worktree>] [--output-dir <dir>] [--check] [--check-source --source-root <shared-worktree>]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function sortedObjectCounts(values) {
  return Object.fromEntries([...values.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function countBy(records, select) {
  const counts = new Map();
  for (const record of records) {
    const values = select(record);
    for (const value of Array.isArray(values) ? values : [values]) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return sortedObjectCounts(counts);
}

function csvCell(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(records) {
  const columns = [
    'id', 'record_type', 'source_path', 'source_line', 'source_content_sha256', 'worktree_status', 'test_name',
    'source_kind', 'framework_mechanism', 'model_boundary', 'production_path_evidence',
    'mocks_fixtures_evidence', 'assertion_summary', 'assertion_types', 'runner_ci_tiers',
    'overlap_signals', 'profile_enablement', 'execution_dimensions', 'logical_group',
    'logical_case', 'extraction',
  ];
  return `${columns.map(csvCell).join(',')}\n${records.map((record) =>
    columns.map((column) => csvCell(record[column])).join(',')).join('\n')}\n`;
}

function markdown(manifest) {
  const counts = manifest.counts;
  const anchors = manifest.independent_count_anchors;
  return `# Test-suite reset inventory

This resolution artifact inventories the dirty shared source worktree at commit \`${manifest.source.revision}\` without modifying source files or executing test bodies/provider calls. Vitest imports test modules during collection. IDs and output ordering are deterministic for the same source bytes, Git status, installed collector, and generator version.

## Counts

| Category | Count |
|---|---:|
| All inventory records | ${counts.total_records} |
| Logical executable test cases | ${counts.by_record_type.test_case ?? 0} |
| Backend Vitest logical cases | ${counts.by_source_kind.backend_vitest ?? 0} |
| Flutter expanded cases | ${Object.entries(counts.by_source_kind).filter(([key]) => key.startsWith('flutter_')).reduce((sum, [, value]) => sum + value, 0)} |
| Deployment shell assertion records/groups | ${counts.by_record_type.shell_assertion ?? 0} |
| Verification command surfaces | ${counts.by_record_type.command_surface ?? 0} |

Command surfaces, aliases, producers, and orchestration steps are deliberately excluded from executable test-case counts.

Represented source snapshot: **${manifest.source_snapshot.represented_file_count} files**, SHA-256 **\`${manifest.source_snapshot.digest}\`**.

Derivation-input snapshot: **${manifest.derivation_input_snapshot.file_count} files**, SHA-256 **\`${manifest.derivation_input_snapshot.digest}\`**. This includes shared enum/generated-plan/qualification/scenario inputs and both generator source files.

## Independent count anchors

- Vitest runtime collection raw cases by profile: \`${JSON.stringify(anchors.vitest.runtime_raw_by_profile)}\`.
- Vitest cases after concrete collector-case materialization and repetition/profile separation: **${anchors.vitest.logical_cases}**.
- Runtime collection failures: \`${JSON.stringify(anchors.vitest.runtime_collection_failures)}\`.
- Runtime-uncollected profiles: \`${JSON.stringify(anchors.vitest.runtime_uncollected_profiles)}\`.
- Canonical qualification contract derived from the qualification validator and source-bound scenario inputs: \`${JSON.stringify(anchors.vitest.qualification_contract)}\`.
- Flutter test source files: **${anchors.flutter.source_files}**; authored declarations: **${anchors.flutter.authored_declarations}**; exact expanded cases: **${anchors.flutter.expanded_cases}**.
- Flutter repository-specific expansion covers two literal two-value loops, two \`KfcGenUiWidgetKind.values\` declarations, the three-state support-handoff map, and generated persisted GenUI capture-plan scenarios.
- Shell assertion/verification-action records: **${anchors.shell.assertion_records}**, including **${anchors.shell.embedded_groups}** embedded Node heredoc groups, **${anchors.shell.expected_failure_actions}** expected-failure actions, and **${anchors.shell.zero_exit_actions}** set-e zero-exit actions.
- Command surfaces: ${anchors.commands.package_script_surfaces} package scripts, ${anchors.commands.workflow_command_surfaces} workflow commands, ${anchors.commands.acceptance_command_surfaces} deployed-acceptance invocations, and ${anchors.commands.direct_script_surfaces} credible direct executable verification scripts.

## Extraction and classification

- **Backend Vitest:** collected with installed \`vitest list --json --includeTaskLocation\` under default, live scenario, controlled high-risk repetition, mandatory live-text qualification, and live interruption environments. Child processes receive a minimal allowlisted environment with inherited provider/live/tracing flags cleared and explicit placeholders only where collection requires them. Test modules are imported, but test bodies and provider calls are not executed. Same-name parameterized collector cases receive deterministic ordinals and remain separate records. Qualification profile enablement is contract-filtered to canonical scenarios 01–09; scenarios 10–11 remain ordinary live-scenario cases. Snapshot validation requires the qualified record set to equal \`canonical_scenario_files\` exactly and rejects any out-of-contract profile tag. Profile enablement and explicit live diagnostic repetitions remain execution dimensions instead of multiplying logical cases.
- **Flutter:** statically parses every \`*_test.dart\` declaration under \`test/\` and \`integration_test/\`, including \`testGoldenScene\`. Repository-specific resolvers expand the six current authored parameterization sites from literal lists/maps, enum values, conditional interpolation, or generated JSON.
- **Shell:** materializes top-level assertions and verification actions with source spans. This includes \`bash -n\`, grep/rg/test/node/cmp/diff/shasum assertions, multiline expected-failure deployment invocations, and set-e-enforced zero-exit script actions. Embedded JavaScript heredocs remain assertion groups.
- **Commands:** inventories nonstandard proof/eval/live/validation package scripts, workflow run commands, deployed acceptance invocations, and only direct scripts with a command-target reference or credible CLI/top-level execution signal. Pure imported support modules are excluded. These are command surfaces only, even when they invoke a test runner.
- **Metadata:** production-path, mock/fixture, model-boundary, assertion, overlap, and tier fields are conservative static summaries. Every field is populated; unavailable case/group boundaries use explicit nulls or \`unknown\` values.

## Limitations and unresolved gaps

1. Vitest source locations are runtime-authoritative, but assertion summaries use a bounded source window because the collector does not expose callback end locations. Any required profile collection failure aborts generation; the generator does not publish a partial per-file fallback as complete.
2. Live text qualification safely runtime-collects the scenario test module, then applies the parsed canonical contract before profile attribution. The recorded contract includes approved provider/model/profile identities, inverse agent/judge pairings, repetitions, text mode, scenarios 01–09, turns per execution, scenario runs, and total turn evaluations. The qualification runner itself is never executed because that would make provider calls.
3. Flutter expansion is exact for the current six parameterized declarations across literal-list, map-entry, enum, conditional, and generated-JSON resolver forms. A future new dynamic form will appear as a low-confidence unresolved expression and fail the current zero-unresolved anchor expectation during review.
4. Flutter integration tests are inventoried statically and not executed; their required deployed endpoints, files, and devices are outside a safe inventory run.
5. Shell heredoc internals are intentionally grouped. Canonical named test cases do not exist in \`deploy_scripts.test.sh\`, so \`logical_case\` remains null for assertion records.
6. Workflow YAML is parsed as command-bearing lines rather than with a YAML dependency; multiline shell structure is preserved only to the command line/group level.
7. Production evidence and overlap signals are search-based summaries, not coverage instrumentation or proof that a production branch executed.
8. Snapshot and derivation digests identify one successful point in time. A later \`--check-source\` may correctly become stale if the shared worktree continues changing; this does not invalidate the recorded snapshot.

## Validation

Run:

\`\`\`sh
node scripts/generate-test-suite-inventory.mjs \\
  --source-root /path/to/shared/source-worktree
node scripts/generate-test-suite-inventory.mjs \\
  --output-dir docs/wayfinder/test-suite-reset/assets \\
  --check
node scripts/generate-test-suite-inventory.mjs \\
  --output-dir docs/wayfinder/test-suite-reset/assets \\
  --check-source --source-root /path/to/shared/source-worktree
\`\`\`

Default \`--check\` is snapshot-only: it recomputes all manifest count facets and derivable anchors from JSONL, verifies schema/artifact identity, represented-source and derivation-input snapshot digests/file counts, required fields, JSONL/CSV digests, and exact generated CSV/Markdown content. Explicit \`--check-source --source-root\` additionally hashes every currently represented shared source, every shared derivation dependency, and both current generator files.
`;
}

function derivationInputSnapshot(sourceRoot, qualificationContract) {
  const sourcePaths = [
    'apps/kfc_live_monitor_flutter/lib/features/customer_chat/domain/kfc_genui_models.dart',
    'apps/kfc_live_monitor_flutter/integration_test/support/generated_genui_scenario_capture_data.dart',
    'services/kfc-agent-backend/scripts/lib/kfc-live-text-qualification.mjs',
    'services/kfc-agent-backend/scripts/run-live-text-qualification.mjs',
    ...qualificationContract.canonical_scenario_files.map((fileName) => `ai-talent-tracks/fnb/conversations/${fileName}`),
  ];
  const generatorRoot = resolve(import.meta.dirname, '..');
  const entries = [
    ...sourcePaths.map((path) => ({ scope: 'source-root', path, sha256: sha(readFileSync(resolve(sourceRoot, path))) })),
    ...['scripts/generate-test-suite-inventory.mjs', 'scripts/lib/test-suite-inventory-extractors.mjs']
      .map((path) => ({ scope: 'generator-worktree', path, sha256: sha(readFileSync(resolve(generatorRoot, path))) })),
  ].sort((left, right) => `${left.scope}\0${left.path}`.localeCompare(`${right.scope}\0${right.path}`));
  return {
    file_count: entries.length,
    digest_algorithm: 'sha256(sorted scope NUL path NUL sha256 newline)',
    digest: sha(entries.map(({ scope, path, sha256 }) => `${scope}\0${path}\0${sha256}\n`).join('')),
    files: entries,
  };
}

function outputsFor(options) {
  const root = options.sourceRoot;
  const git = gitSnapshot(root);
  const vitest = extractVitest(root, git);
  const flutter = extractFlutter(root, git);
  const shell = extractShell(root, git);
  const commands = extractCommandSurfaces(root, git);
  const derivationInputs = derivationInputSnapshot(root, vitest.anchors.qualification_contract);
  const records = [...vitest.records, ...flutter.records, ...shell.records, ...commands.records]
    .sort((left, right) => left.id.localeCompare(right.id));
  const duplicateIds = records.length - new Set(records.map(({ id }) => id)).size;
  if (duplicateIds) throw new Error(`Inventory contains ${duplicateIds} duplicate IDs`);
  const representedSources = new Map();
  for (const record of records) {
    const prior = representedSources.get(record.source_path);
    if (prior && prior !== record.source_content_sha256) throw new Error(`Source changed during generation: ${record.source_path}`);
    representedSources.set(record.source_path, record.source_content_sha256);
  }
  const sourceSnapshotRows = [...representedSources].sort(([left], [right]) => left.localeCompare(right));
  const sourceSnapshotDigest = sha(sourceSnapshotRows.map(([path, digest]) => `${path}\0${digest}\n`).join(''));
  if (flutter.anchors.unresolved_name_expressions !== 0) {
    throw new Error(`Flutter inventory has ${flutter.anchors.unresolved_name_expressions} unresolved test names`);
  }
  const manifest = {
    schema_version: 1,
    artifact_kind: 'wayfinder-test-suite-reset-inventory',
    deterministic_generation: true,
    generator: 'scripts/generate-test-suite-inventory.mjs',
    source: {
      revision: git.revision,
      dirty: git.dirty,
      changed_path_count_excluding_nested_worktrees: git.changedPaths.length,
      root_recorded_as: 'caller-supplied shared source worktree (absolute path intentionally omitted)',
      inclusion: 'tracked, modified, added, and untracked source files',
      exclusions: ['.claude/worktrees/**', 'node_modules/**', '.dart_tool/**', 'build/**', 'dist/**', 'coverage/**', 'artifacts/**', '.wrangler/**'],
    },
    source_snapshot: {
      represented_file_count: representedSources.size,
      digest_algorithm: 'sha256(sorted source_path NUL source_content_sha256 newline)',
      digest: sourceSnapshotDigest,
    },
    derivation_input_snapshot: derivationInputs,
    counts: {
      total_records: records.length,
      by_record_type: countBy(records, ({ record_type }) => record_type),
      by_source_kind: countBy(records, ({ source_kind }) => source_kind),
      by_worktree_status: countBy(records, ({ worktree_status }) => worktree_status),
      by_extraction_confidence: countBy(records, ({ extraction }) => extraction.confidence),
      by_framework: countBy(records, ({ framework_mechanism }) => framework_mechanism.framework),
    },
    independent_count_anchors: {
      vitest: vitest.anchors,
      flutter: flutter.anchors,
      shell: shell.anchors,
      commands: commands.anchors,
    },
    integrity: {
      duplicate_ids: duplicateIds,
      jsonl_sha256: null,
      csv_sha256: null,
    },
  };
  const jsonl = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  const csv = toCsv(records);
  manifest.integrity.jsonl_sha256 = sha(jsonl);
  manifest.integrity.csv_sha256 = sha(csv);
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const summary = markdown(manifest);
  return new Map([
    ['test-suite-inventory.jsonl', jsonl],
    ['test-suite-inventory.csv', csv],
    ['test-suite-inventory-manifest.json', manifestText],
    ['test-suite-inventory-summary.md', summary],
  ]);
}

function verifyExisting(outputDir, sourceRoot = null) {
  const names = ['test-suite-inventory.jsonl', 'test-suite-inventory.csv', 'test-suite-inventory-manifest.json', 'test-suite-inventory-summary.md'];
  const contents = Object.fromEntries(names.map((name) => [name, readFileSync(resolve(outputDir, name), 'utf8')]));
  const manifest = JSON.parse(contents['test-suite-inventory-manifest.json']);
  const records = contents['test-suite-inventory.jsonl'].trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const errors = [];
  const equal = (actual, expected, label) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) errors.push(`${label} mismatch`);
  };
  if (manifest.schema_version !== 1 || manifest.artifact_kind !== 'wayfinder-test-suite-reset-inventory' || manifest.deterministic_generation !== true || manifest.generator !== 'scripts/generate-test-suite-inventory.mjs') errors.push('manifest schema/artifact identity mismatch');
  if (sha(contents['test-suite-inventory.jsonl']) !== manifest.integrity.jsonl_sha256) errors.push('JSONL digest mismatch');
  if (sha(contents['test-suite-inventory.csv']) !== manifest.integrity.csv_sha256) errors.push('CSV digest mismatch');
  if (contents['test-suite-inventory.csv'] !== toCsv(records)) errors.push('CSV is not the exact JSONL review export');
  if (contents['test-suite-inventory-summary.md'] !== markdown(manifest)) errors.push('Markdown summary is not the exact manifest rendering');
  if (records.length !== manifest.counts.total_records) errors.push('manifest total_records mismatch');
  if (new Set(records.map(({ id }) => id)).size !== records.length) errors.push('duplicate record IDs');
  const ids = records.map(({ id }) => id);
  if (JSON.stringify(ids) !== JSON.stringify([...ids].sort())) errors.push('JSONL records are not ID-sorted');
  const required = ['id', 'record_type', 'source_path', 'source_line', 'source_content_sha256', 'worktree_status', 'test_name', 'source_kind', 'framework_mechanism', 'model_boundary', 'production_path_evidence', 'mocks_fixtures_evidence', 'assertion_summary', 'assertion_types', 'runner_ci_tiers', 'overlap_signals', 'profile_enablement', 'execution_dimensions', 'logical_group', 'logical_case', 'extraction'];
  for (const record of records) {
    if (record.schema_version !== 1) errors.push(`${record.id}: invalid schema_version`);
    for (const field of required) if (record[field] === undefined || record[field] === '') errors.push(`${record.id}: missing ${field}`);
    if (!/^[0-9a-f]{64}$/u.test(record.source_content_sha256)) errors.push(`${record.id}: invalid source_content_sha256`);
  }
  const representedSources = new Map();
  for (const record of records) {
    const prior = representedSources.get(record.source_path);
    if (prior && prior !== record.source_content_sha256) errors.push(`conflicting source digest: ${record.source_path}`);
    representedSources.set(record.source_path, record.source_content_sha256);
  }
  const snapshotRows = [...representedSources].sort(([left], [right]) => left.localeCompare(right));
  const snapshotDigest = sha(snapshotRows.map(([path, digest]) => `${path}\0${digest}\n`).join(''));
  if (representedSources.size !== manifest.source_snapshot.represented_file_count) errors.push('source snapshot file count mismatch');
  if (snapshotDigest !== manifest.source_snapshot.digest) errors.push('source snapshot digest mismatch');
  const derivationFiles = manifest.derivation_input_snapshot?.files ?? [];
  const sortedDerivations = [...derivationFiles].sort((left, right) => `${left.scope}\0${left.path}`.localeCompare(`${right.scope}\0${right.path}`));
  const derivationDigest = sha(sortedDerivations.map(({ scope, path, sha256 }) => `${scope}\0${path}\0${sha256}\n`).join(''));
  if (derivationFiles.length !== manifest.derivation_input_snapshot?.file_count) errors.push('derivation input file count mismatch');
  if (derivationDigest !== manifest.derivation_input_snapshot?.digest) errors.push('derivation input digest mismatch');
  if (new Set(derivationFiles.map(({ scope, path }) => `${scope}\0${path}`)).size !== derivationFiles.length) errors.push('duplicate derivation inputs');
  for (const entry of derivationFiles.filter(({ scope }) => scope === 'source-root')) {
    const represented = representedSources.get(entry.path);
    if (represented && represented !== entry.sha256) errors.push(`derivation/record digest conflict: ${entry.path}`);
  }
  const recomputedCounts = {
    total_records: records.length,
    by_record_type: countBy(records, ({ record_type }) => record_type),
    by_source_kind: countBy(records, ({ source_kind }) => source_kind),
    by_worktree_status: countBy(records, ({ worktree_status }) => worktree_status),
    by_extraction_confidence: countBy(records, ({ extraction }) => extraction.confidence),
    by_framework: countBy(records, ({ framework_mechanism }) => framework_mechanism.framework),
  };
  equal(recomputedCounts, manifest.counts, 'all manifest count facets');
  const vitest = records.filter(({ source_kind }) => source_kind === 'backend_vitest');
  const runtimeRaw = {};
  for (const record of vitest) for (const [profile, count] of Object.entries(record.execution_dimensions.collector_instances_by_profile ?? {})) runtimeRaw[profile] = (runtimeRaw[profile] ?? 0) + count;
  const qualificationMatrices = vitest.filter(({ profile_enablement }) => profile_enablement.includes('live-text-qualification')).map(({ execution_dimensions }) => execution_dimensions.qualification_contract);
  const qualificationMatrix = qualificationMatrices[0] ?? null;
  if (!qualificationMatrix || qualificationMatrices.some((value) => JSON.stringify(value) !== JSON.stringify(qualificationMatrix))) errors.push('qualification contract dimensions are missing or inconsistent');
  const scenarioFileFrom = ({ test_name }) => test_name.match(/([0-9]{2}-[^ >]+\.json)/u)?.[1];
  const allLiveScenarioFiles = [...new Set(vitest.filter(({ profile_enablement }) => profile_enablement.includes('live-scenarios')).map(scenarioFileFrom).filter(Boolean))].sort();
  const canonicalScenarioFiles = [...(qualificationMatrix?.canonical_scenario_files ?? [])].sort();
  const canonicalFiles = new Set(canonicalScenarioFiles);
  const qualifiedRecords = vitest.filter(({ profile_enablement }) => profile_enablement.includes('live-text-qualification'));
  const qualifiedScenarioFiles = [...new Set(qualifiedRecords.map(scenarioFileFrom).filter(Boolean))].sort();
  if (JSON.stringify(qualifiedScenarioFiles) !== JSON.stringify(canonicalScenarioFiles)) errors.push('qualification profile scenario set does not exactly match canonical_scenario_files');
  if (qualifiedRecords.some((record) => !canonicalFiles.has(scenarioFileFrom(record)))) errors.push('non-canonical scenario carries live-text-qualification profile');
  const contractExcludedCases = allLiveScenarioFiles.filter((fileName) => !canonicalFiles.has(fileName));
  const flutter = records.filter(({ source_kind }) => source_kind.startsWith('flutter_'));
  const shell = records.filter(({ record_type }) => record_type === 'shell_assertion');
  const commands = records.filter(({ record_type }) => record_type === 'command_surface');
  const derivedAnchors = {
    vitest: {
      runtime_raw_by_profile: Object.fromEntries(Object.entries(runtimeRaw).sort(([left], [right]) => left.localeCompare(right))),
      logical_cases: vitest.length,
      runtime_collection_failures: {},
      runtime_uncollected_profiles: {},
      qualification_contract: qualificationMatrix,
      contract_excluded_collector_cases: { 'live-text-qualification': contractExcludedCases },
    },
    flutter: {
      source_files: new Set(flutter.map(({ source_path }) => source_path)).size,
      authored_declarations: new Set(flutter.map((record) => `${record.source_path}\0${record.source_line}\0${record.framework_mechanism.mechanism}`)).size,
      expanded_cases: flutter.length,
      unresolved_name_expressions: flutter.filter(({ extraction }) => extraction.confidence === 'low').length,
    },
    shell: {
      assertion_records: shell.length,
      embedded_groups: shell.filter(({ logical_group }) => logical_group === 'embedded-node-assertion-group').length,
      expected_failure_actions: shell.filter(({ logical_group }) => logical_group === 'expected-failure-verification-action').length,
      zero_exit_actions: shell.filter(({ logical_group }) => logical_group === 'set-e-zero-exit-verification-action').length,
    },
    commands: {
      package_script_surfaces: commands.filter(({ framework_mechanism }) => framework_mechanism.mechanism === 'package script').length,
      workflow_command_surfaces: commands.filter(({ framework_mechanism }) => framework_mechanism.mechanism.startsWith('GitHub Actions')).length,
      acceptance_command_surfaces: commands.filter(({ framework_mechanism }) => framework_mechanism.mechanism === 'deployed acceptance orchestration command').length,
      direct_script_surfaces: commands.filter(({ framework_mechanism }) => framework_mechanism.mechanism === 'direct executable verification script').length,
    },
  };
  equal(derivedAnchors, manifest.independent_count_anchors, 'independent count anchors');
  if (sourceRoot) {
    for (const [path, expected] of representedSources) {
      let actual;
      try { actual = sha(readFileSync(resolve(sourceRoot, path))); } catch { errors.push(`represented source missing: ${path}`); continue; }
      if (actual !== expected) errors.push(`represented source changed: ${path}`);
    }
    const generatorRoot = resolve(import.meta.dirname, '..');
    for (const { scope, path, sha256: expected } of derivationFiles) {
      const base = scope === 'source-root' ? sourceRoot : scope === 'generator-worktree' ? generatorRoot : null;
      if (!base) { errors.push(`unknown derivation input scope: ${scope}`); continue; }
      let actual;
      try { actual = sha(readFileSync(resolve(base, path))); } catch { errors.push(`derivation input missing: ${scope}:${path}`); continue; }
      if (actual !== expected) errors.push(`derivation input changed: ${scope}:${path}`);
    }
  }
  if (errors.length) throw new Error(`Inventory validation failed:\n${[...new Set(errors)].join('\n')}`);
  return { artifacts: names.length, records: records.length, sourceFilesChecked: sourceRoot ? representedSources.size : 0, derivationFilesChecked: sourceRoot ? derivationFiles.length : 0 };
}

const options = argumentsFrom(process.argv.slice(2));
if (options.check) {
  if (options.checkSource && !options.sourceRootProvided) throw new Error('--check-source requires an explicit --source-root');
  const result = verifyExisting(options.outputDir, options.checkSource ? options.sourceRoot : null);
  console.log(`Inventory ${options.checkSource ? 'artifact/source' : 'snapshot-only artifact'} check passed (${result.artifacts} artifacts, ${result.records} records${result.sourceFilesChecked ? `, ${result.sourceFilesChecked} represented source files, ${result.derivationFilesChecked} derivation inputs` : ''}).`);
} else {
  const outputs = outputsFor(options);
  mkdirSync(options.outputDir, { recursive: true });
  for (const [name, contents] of outputs) writeFileSync(resolve(options.outputDir, name), contents);
  const manifest = JSON.parse(outputs.get('test-suite-inventory-manifest.json'));
  console.log(`Generated ${outputs.size} artifacts with ${manifest.counts.total_records} records.`);
  console.log(JSON.stringify(manifest.independent_count_anchors, null, 2));
}
