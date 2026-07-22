import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const UNKNOWN = 'unknown';

export function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function walk(root, predicate = () => true) {
  const excluded = new Set([
    '.git', '.dart_tool', '.idea', '.vscode', 'node_modules', 'build', 'dist',
    'coverage', 'artifacts', '.wrangler', '.turbo', '.next', '.vitest',
  ]);
  const results = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      const path = resolve(directory, entry.name);
      const rel = relative(root, path).replaceAll('\\', '/');
      if (rel.startsWith('.claude/worktrees/')) continue;
      if (entry.isDirectory()) visit(path);
      else if (predicate(path, rel)) results.push(path);
    }
  }
  visit(root);
  return results.sort();
}

export function gitSnapshot(root) {
  const statusOutput = execFileSync(
    'git', ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const statuses = new Map();
  for (const entry of statusOutput.split('\0').filter(Boolean)) {
    const code = entry.slice(0, 2);
    const path = entry.slice(3).replaceAll('\\', '/');
    if (path.startsWith('.claude/worktrees/')) continue;
    const state = code === '??' ? 'untracked'
      : code.includes('A') ? 'added'
      : code.includes('D') ? 'deleted'
      : code.includes('R') ? 'renamed'
      : code.trim() ? 'modified'
      : 'tracked';
    statuses.set(path, { state, porcelain: code });
  }
  const revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  return {
    revision,
    dirty: statuses.size > 0,
    status(path) {
      return statuses.get(path) ?? { state: 'tracked', porcelain: '  ' };
    },
    changedPaths: [...statuses.keys()].sort(),
  };
}

function assertionTypes(text) {
  const types = new Set();
  const rules = [
    ['equality', /to(?:Be|Equal|StrictEqual|MatchObject)|\beq\b|==={0,1}| -eq | -ne /u],
    ['containment', /toContain|arrayContaining|objectContaining|grep\s|rg\s|contains?/iu],
    ['cardinality', /toHaveLength|toHaveBeenCalledTimes|\bcount\b|grep -c|\.length/iu],
    ['truthiness', /toBeTruthy|toBeFalsy|isTrue|isFalse|\btest\s+-[a-z]\b/iu],
    ['exception-or-rejection', /toThrow|throws|reject|expected .* (?:fail|reject)|exitCode/iu],
    ['snapshot-or-golden', /snapshot|golden|matchesGoldenFile/iu],
    ['http-or-route', /status|fetch\(|Request\(|\/ready|webhook|route/iu],
    ['ordering', / -lt | -gt |before|after|ordered/iu],
    ['filesystem', /test\s+!?-[fexd]|readFile|writeFile|exists|SHA256SUMS/iu],
    ['negative', /\.not\.|findsNothing|!\s*(?:grep|rg|node|test)|must not|forbid/iu],
    ['schema-or-shape', /schema|shape|keys|parse|toMatchObject/iu],
    ['visual-widget', /findsOneWidget|find\.by|Widget|render/iu],
  ];
  for (const [name, pattern] of rules) if (pattern.test(text)) types.add(name);
  return [...types].sort().length ? [...types].sort() : [UNKNOWN];
}

function modelBoundary(path, name, text) {
  const value = `${path}\n${name}\n${text}`.toLowerCase();
  if (/test:live|proof:live|npm run eval:|eval:live|live[-_: ]qualification|live.ai|live scenario|live.*model|provider|openai|gemini|google_api_key|outcome.judg/u.test(value)) {
    return 'live-model/provider orchestration boundary; inventory collection does not execute provider calls';
  }
  if (/agent|stategraph|langgraph|model profile|semantic/u.test(value)) {
    return 'agent/runtime model-adjacent boundary, generally exercised with deterministic doubles unless the profile is live';
  }
  return 'no direct model boundary detected';
}

function productionEvidence(path, name, text) {
  const value = `${path}\n${name}\n${text}`;
  const signals = [];
  if (/src\/|package:kfc_live_monitor\//u.test(value)) signals.push('imports or exercises production source modules');
  if (/worker|server|api|webhook|\/ready|\/chat\//iu.test(value)) signals.push('covers deployed HTTP/Worker/server behavior');
  if (/repository|persistence|postgres|d1|store/iu.test(value)) signals.push('covers persistence/repository behavior');
  if (/widget|screen|renderer|golden|integration_test/iu.test(value)) signals.push('covers production Flutter UI/rendering path');
  if (/deploy|acceptance|qualification|latency|proof/iu.test(value)) signals.push('verifies deployment, acceptance, qualification, or proof path');
  return signals.length ? signals.join('; ') : 'conservative summary: production-path relationship not statically established';
}

function mocksFixtures(text) {
  const signals = [...new Set((text.match(/\b(?:vi\.(?:fn|mock|spyOn)|mock\w*|fixture\w*|Fake\w*|stub\w*|golden\w*|sample\w*)\b/giu) ?? []).map((x) => x.trim()))];
  return signals.length ? `detected: ${signals.slice(0, 12).join(', ')}` : 'no explicit mock or fixture token detected in local evidence window';
}

export function recordBase({ root, git, recordType, sourcePath, line, column = 1,
  testName, sourceKind, framework, mechanism, evidenceText = '', runnerTiers,
  extractionMethod, confidence, extractionEvidence, profileEnablement = [],
  executionDimensions = {}, overlapSignals = [], assertionSummary,
  group = null, logicalCase = null, identityDiscriminator = '' }) {
  const rel = relative(root, sourcePath).replaceAll('\\', '/');
  const status = git.status(rel);
  const canonical = [recordType, rel, line, testName, identityDiscriminator].join('\0');
  return {
    schema_version: 1,
    id: `tsi-${recordType.replaceAll('_', '-')}-${sha(canonical).slice(0, 16)}`,
    record_type: recordType,
    source_path: rel,
    source_line: line,
    source_column: column,
    source_content_sha256: sha(readFileSync(sourcePath)),
    worktree_status: status.state,
    worktree_porcelain: status.porcelain,
    test_name: testName,
    source_kind: sourceKind,
    framework_mechanism: { framework, mechanism },
    model_boundary: modelBoundary(rel, testName, evidenceText),
    production_path_evidence: productionEvidence(rel, testName, evidenceText),
    mocks_fixtures_evidence: mocksFixtures(evidenceText),
    assertion_summary: assertionSummary ?? 'assertion intent not recoverable beyond local static evidence',
    assertion_types: assertionTypes(evidenceText),
    runner_ci_tiers: runnerTiers.length ? runnerTiers : [UNKNOWN],
    overlap_signals: overlapSignals.length ? overlapSignals : ['no explicit overlap signal detected'],
    profile_enablement: profileEnablement.length ? profileEnablement.sort() : [UNKNOWN],
    execution_dimensions: Object.keys(executionDimensions).length ? executionDimensions : { known: false },
    logical_group: group,
    logical_case: logicalCase,
    extraction: {
      method: extractionMethod,
      confidence,
      evidence: extractionEvidence,
    },
  };
}

function qualificationMatrix(root) {
  const contractPath = 'services/kfc-agent-backend/scripts/lib/kfc-live-text-qualification.mjs';
  const source = readFileSync(resolve(root, contractPath), 'utf8');
  const providersBody = source.match(/providers:\s*Object\.freeze\(\[([^\]]+)\]\)/u)?.[1] ?? '';
  const providers = [...providersBody.matchAll(/['"](openai|google)['"]/gu)].map((match) => match[1]);
  const repetitionCount = Number(source.match(/repetitions:\s*(\d+)/u)?.[1] ?? 0);
  const mode = source.match(/mode:\s*['"]([^'"]+)['"]/u)?.[1] ?? UNKNOWN;
  const approved_profiles = providers.map((provider) => {
    const body = source.match(new RegExp(`${provider}: Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\)`, 'u'))?.[1] ?? '';
    return {
      provider: body.match(/provider:\s*['"]([^'"]+)['"]/u)?.[1] ?? UNKNOWN,
      model: body.match(/model:\s*['"]([^'"]+)['"]/u)?.[1] ?? UNKNOWN,
      profile: body.match(/profile:\s*['"]([^'"]+)['"]/u)?.[1] ?? UNKNOWN,
    };
  });
  const conversationsRoot = resolve(root, 'ai-talent-tracks/fnb/conversations');
  const canonical_scenario_files = readdirSync(conversationsRoot)
    .filter((name) => /^0[1-9]-.*\.json$/u.test(name))
    .sort();
  const turns_by_scenario = Object.fromEntries(canonical_scenario_files.map((fileName) => {
    const value = JSON.parse(readFileSync(resolve(conversationsRoot, fileName), 'utf8'));
    const turns = Array.isArray(value.turns) ? value.turns : [];
    return [fileName, turns.filter(({ speaker, role }) => String(speaker ?? role).toLowerCase() === 'user').length];
  }));
  const turns_per_execution = Object.values(turns_by_scenario).reduce((sum, count) => sum + count, 0);
  if (providers.length !== 2 || approved_profiles.some((identity) => Object.values(identity).includes(UNKNOWN)) || repetitionCount < 1 || mode !== 'text' || canonical_scenario_files.length !== 9 || turns_per_execution < 1) {
    throw new Error('Unable to derive complete mandatory live-text qualification contract');
  }
  const repetitions = Array.from({ length: repetitionCount }, (_unused, index) => index + 1);
  const agent_judge_pairings = approved_profiles.map((agent) => ({
    agent,
    judge: approved_profiles.find(({ provider }) => provider !== agent.provider),
  }));
  const matrixExecutions = providers.length * repetitionCount;
  return {
    approved_profiles,
    providers,
    repetitions,
    mode,
    agent_judge_pairings,
    canonical_scenario_files,
    turns_by_scenario,
    scenario_count_per_execution: canonical_scenario_files.length,
    turns_per_execution,
    matrix_executions: matrixExecutions,
    scenario_runs: canonical_scenario_files.length * matrixExecutions,
    total_turn_evaluations: turns_per_execution * matrixExecutions,
    derived_from: contractPath,
  };
}

function minimalCollectionEnvironment(overrides) {
  const allowed = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'USER', 'LOGNAME', 'SHELL', 'SystemRoot', 'ComSpec', 'PATHEXT', 'LANG', 'LC_ALL'];
  const env = Object.fromEntries(allowed.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]]));
  Object.assign(env, { CI: '1', NODE_ENV: 'test', NO_COLOR: '1' });
  const explicitlyCleared = [
    'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'GOOGLE_API_KEY', 'LANGSMITH_API_KEY', 'LANGSMITH_PROJECT', 'LANGSMITH_ENDPOINT', 'LANGSMITH_TRACING',
    'RUN_LIVE_AI_SCENARIOS', 'RUN_LIVE_AI_INTERRUPTION', 'KFC_LIVE_QUALIFICATION', 'KFC_LIVE_ADVISORY_CANARY', 'KFC_LIVE_FORCE_FIRST_RETRY',
    'KFC_AGENT_PROVIDER', 'KFC_AGENT_MODEL', 'KFC_AGENT_PROFILE_MODE', 'KFC_LIVE_SCENARIO_MODE', 'KFC_LIVE_HIGH_RISK_REPETITIONS',
    'KFC_LIVE_FOCUSED_TURN_ID', 'KFC_LIVE_OUTCOME_JUDGE_PROVIDER', 'KFC_LIVE_QUALIFICATION_EXECUTION_ID',
    'KFC_LIVE_QUALIFICATION_REPETITION', 'KFC_LIVE_QUALIFICATION_ATTESTATION_FILE', 'KFC_LIVE_QUALIFICATION_GIT_SHA',
  ];
  for (const name of explicitlyCleared) delete env[name];
  Object.assign(env, overrides);
  return env;
}

function vitestProfiles(root) {
  const backend = resolve(root, 'services/kfc-agent-backend');
  const vitest = resolve(backend, 'node_modules/.bin/vitest');
  if (!existsSync(vitest)) throw new Error(`Installed Vitest is required at ${vitest}`);
  return [
    { name: 'default', filters: [], env: {} },
    {
      name: 'live-scenarios', filters: ['test/scenarios/live-ai-scenario-replay.test.ts'],
      env: { RUN_LIVE_AI_SCENARIOS: '1', KFC_AGENT_PROVIDER: 'openai', KFC_AGENT_MODEL: 'gpt-5-mini-2025-08-07', OPENAI_API_KEY: 'inventory-placeholder', GOOGLE_API_KEY: 'inventory-placeholder', LANGSMITH_PROJECT: 'inventory-collection', LANGSMITH_API_KEY: 'inventory-placeholder' },
    },
    {
      name: 'live-scenarios-high-risk', filters: ['test/scenarios/live-ai-scenario-replay.test.ts'],
      env: { RUN_LIVE_AI_SCENARIOS: '1', KFC_LIVE_SCENARIO_MODE: 'text', KFC_LIVE_HIGH_RISK_REPETITIONS: '3', KFC_AGENT_PROVIDER: 'openai', KFC_AGENT_MODEL: 'gpt-5-mini-2025-08-07', OPENAI_API_KEY: 'inventory-placeholder', GOOGLE_API_KEY: 'inventory-placeholder', LANGSMITH_PROJECT: 'inventory-collection', LANGSMITH_API_KEY: 'inventory-placeholder' },
    },
    {
      name: 'live-text-qualification', filters: ['test/scenarios/live-ai-scenario-replay.test.ts'], canonicalQualification: true,
      env: {
        RUN_LIVE_AI_SCENARIOS: '1', KFC_LIVE_QUALIFICATION: '1', KFC_AGENT_PROFILE_MODE: 'qualification', KFC_LIVE_SCENARIO_MODE: 'text',
        KFC_AGENT_PROVIDER: 'openai', KFC_AGENT_MODEL: 'gpt-5-mini-2025-08-07', KFC_LIVE_OUTCOME_JUDGE_PROVIDER: 'google',
        OPENAI_API_KEY: 'inventory-placeholder', GOOGLE_API_KEY: 'inventory-placeholder', LANGSMITH_PROJECT: 'inventory-collection', LANGSMITH_API_KEY: 'inventory-placeholder',
        KFC_LIVE_QUALIFICATION_EXECUTION_ID: '00000000-0000-4000-8000-000000000056', KFC_LIVE_QUALIFICATION_REPETITION: '1',
        KFC_LIVE_QUALIFICATION_ATTESTATION_FILE: '/tmp/kfc-inventory-attestation.json', KFC_LIVE_QUALIFICATION_GIT_SHA: '0000000000000000000000000000000000000000',
      },
    },
    {
      name: 'live-interruption', filters: ['test/worker/live-ai-interruption.test.ts'],
      env: { RUN_LIVE_AI_INTERRUPTION: '1', KFC_AGENT_PROVIDER: 'openai', KFC_AGENT_MODEL: 'gpt-5-mini-2025-08-07', OPENAI_API_KEY: 'inventory-placeholder' },
    },
  ].map((profile) => ({ ...profile, backend, vitest }));
}

export function extractVitest(root, git) {
  const mandatoryMatrix = qualificationMatrix(root);
  const logical = new Map();
  const rawCounts = {};
  const collectionFailures = {};
  const contractExcludedCases = {};
  const collect = (profile, filters) => {
    const result = spawnSync(
      profile.vitest,
      ['list', ...filters, '--json', '--includeTaskLocation'],
      { cwd: profile.backend, encoding: 'utf8', env: minimalCollectionEnvironment(profile.env), maxBuffer: 128 * 1024 * 1024 },
    );
    if (result.status === 0) return { cases: JSON.parse(result.stdout), error: null };
    return { cases: [], error: (result.stderr || result.stdout || `exit ${result.status}`).trim().split('\n').slice(0, 8).join('\n') };
  };
  for (const profile of vitestProfiles(root)) {
    const collected = collect(profile, profile.filters);
    let cases = collected.cases;
    const { error } = collected;
    if (error) {
      collectionFailures[profile.name] = { aggregate_error: error };
      throw new Error(`Vitest runtime collection failed for ${profile.name}:\n${error}`);
    }
    if (profile.canonicalQualification) {
      const canonical = new Set(mandatoryMatrix.canonical_scenario_files);
      const excluded = cases.filter(({ name }) => ![...canonical].some((fileName) => name.includes(fileName)));
      contractExcludedCases[profile.name] = excluded.map(({ name }) => name.match(/([0-9]{2}-[^ >]+\.json)/u)?.[1] ?? name).sort();
      cases = cases.filter(({ name }) => [...canonical].some((fileName) => name.includes(fileName)));
    }
    rawCounts[profile.name] = cases.length;
    const groupTotals = new Map();
    const groupSeen = new Map();
    for (const item of cases) {
      const rel = relative(root, item.file).replaceAll('\\', '/');
      const base = [rel, item.location?.line ?? 1, item.name].join('\0');
      groupTotals.set(base, (groupTotals.get(base) ?? 0) + 1);
    }
    for (const item of cases) {
      const rel = relative(root, item.file).replaceAll('\\', '/');
      const repetition = Number(item.name.match(/ repetition (\d+)$/u)?.[1] ?? 0) || null;
      let normalized = item.name.replace(/ repetition \d+$/u, '');
      if (rel.endsWith('live-ai-scenario-replay.test.ts')) {
        normalized = normalized.replace(/^.*? > (?=[^>]+\.json \[)/u, 'selected StateGraph live scenario replay > ');
      }
      const base = [rel, item.location?.line ?? 1, item.name].join('\0');
      const collectorOrdinal = (groupSeen.get(base) ?? 0) + 1;
      groupSeen.set(base, collectorOrdinal);
      const collectorTotal = groupTotals.get(base) ?? 1;
      const concreteOrdinal = rel.endsWith('live-ai-scenario-replay.test.ts') ? 1 : collectorOrdinal;
      const key = [rel, item.location?.line ?? 1, normalized, concreteOrdinal].join('\0');
      const found = logical.get(key) ?? {
        item, rel, normalized, collectorOrdinal: concreteOrdinal, collectorTotal,
        profiles: new Set(), repetitions: new Set(), rawNames: new Set(), instanceCounts: new Map(),
      };
      found.profiles.add(profile.name);
      found.instanceCounts.set(profile.name, (found.instanceCounts.get(profile.name) ?? 0) + 1);
      if (repetition) found.repetitions.add(repetition);
      found.rawNames.add(item.name);
      logical.set(key, found);
    }
  }
  const records = [...logical.values()].map((value) => {
    const source = readFileSync(value.item.file, 'utf8');
    const lines = source.split('\n');
    const line = value.item.location?.line ?? 1;
    const window = lines.slice(Math.max(0, line - 5), Math.min(lines.length, line + 120)).join('\n');
    const live = value.rel.includes('live-ai-');
    const tiers = live
      ? ['local opt-in package script', 'workflow_dispatch live tier', 'deployed acceptance where orchestrated']
      : ['local npm test/test:ci', 'pull_request and main backend check CI'];
    return recordBase({
      root, git, recordType: 'test_case', sourcePath: value.item.file, line,
      column: value.item.location?.column ?? 1, testName: value.normalized,
      sourceKind: 'backend_vitest', framework: 'Vitest', mechanism: 'runtime collection via vitest list',
      evidenceText: window, runnerTiers: tiers, extractionMethod: 'runtime-collector', confidence: 'high',
      extractionEvidence: `${value.rawNames.size} runtime-collected name(s) across ${[...value.profiles].sort().join(', ')}`,
      profileEnablement: [...value.profiles],
      executionDimensions: {
        ...(value.repetitions.size ? { diagnostic_repetitions: [...value.repetitions].sort() } : { authored_case: true }),
        collector_instances_by_profile: Object.fromEntries([...value.instanceCounts].sort(([left], [right]) => left.localeCompare(right))),
        ...(value.collectorTotal > 1 ? {
          concrete_collector_case_ordinal: value.collectorOrdinal,
          same_name_collector_case_count: value.collectorTotal,
        } : {}),
        ...(value.profiles.has('live-text-qualification') ? { qualification_contract: mandatoryMatrix } : {}),
      },
      identityDiscriminator: value.collectorTotal > 1 ? `collector-case-${value.collectorOrdinal}` : '',
      overlapSignals: live ? ['live case also participates in package/workflow/acceptance command surfaces'] : [],
      assertionSummary: `Vitest case; local evidence contains assertion types: ${assertionTypes(window).join(', ')}`,
    });
  });
  return {
    records,
    anchors: {
      runtime_raw_by_profile: Object.fromEntries(Object.entries(rawCounts).sort(([left], [right]) => left.localeCompare(right))),
      logical_cases: records.length,
      runtime_collection_failures: collectionFailures,
      runtime_uncollected_profiles: {},
      qualification_contract: mandatoryMatrix,
      contract_excluded_collector_cases: contractExcludedCases,
    },
  };
}

function balancedCall(source, openIndex) {
  let depth = 0; let quote = null; let triple = null; let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const three = source.slice(index, index + 3);
    const char = source[index];
    if (triple) {
      if (three === triple) { triple = null; index += 2; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (three === "'''" || three === '\"\"\"') { triple = three; index += 2; continue; }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '(') depth += 1;
    else if (char === ')' && --depth === 0) return source.slice(openIndex, index + 1);
  }
  return source.slice(openIndex);
}

function firstArgument(call) {
  let depth = 0; let quote = null; let escaped = false;
  for (let index = 1; index < call.length; index += 1) {
    const char = call[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if ('([{'.includes(char)) depth += 1;
    else if (')]}'.includes(char)) depth -= 1;
    else if (char === ',' && depth === 0) return call.slice(1, index).trim();
  }
  return call.slice(1).trim();
}

function literalTemplate(expression) {
  const match = expression.match(/^(?:r)?(['"])([\s\S]*)\1$/u);
  return match ? match[2] : null;
}

function enclosingForGenerator(source, declarationIndex) {
  let selected = null;
  for (const match of source.matchAll(/\bfor\s*\([\s\S]*?\)\s*\{/gu)) {
    if (match.index >= declarationIndex) break;
    const open = match.index + match[0].lastIndexOf('{');
    let depth = 0; let quote = null; let escaped = false; let end = source.length;
    for (let index = open; index < source.length; index += 1) {
      const char = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"') { quote = char; continue; }
      if (char === '{') depth += 1;
      else if (char === '}' && --depth === 0) { end = index; break; }
    }
    if (declarationIndex < end) selected = source.slice(match.index, open + 1);
  }
  return selected;
}

function flutterExpansions(rel, template, generator, root) {
  const resolved = (name, dimension, method) => ({ name, dimension, method, resolved: true });
  if (rel.endsWith('customer_run_models_test.dart') && template === '$terminalType revokes retained snapshot action authority' && /terminalType\s+in\s+\['run_failed',\s*'run_cancelled'\]/u.test(generator ?? '')) {
    return ['run_failed', 'run_cancelled'].map((value) => resolved(template.replace('$terminalType', value), { terminalType: value }, 'repository-specific literal-list resolver'));
  }
  if (rel.endsWith('customer_response_block_test.dart') && template?.includes("${disableAnimations ? 'reduced' : 'normal'}") && /disableAnimations\s+in\s+\[false,\s*true\]/u.test(generator ?? '')) {
    return [false, true].map((value) => resolved(template.replace("${disableAnimations ? 'reduced' : 'normal'}", value ? 'reduced' : 'normal'), { disableAnimations: value }, 'repository-specific conditional interpolation resolver'));
  }
  if ((rel.endsWith('kfc_genui_renderer_test.dart') && template === 'renders ${kind.wireName}') ||
      (rel.endsWith('kfc_genui_widget_states_golden_test.dart') && template === 'golden ${kind.wireName}')) {
    if (!/kind\s+in\s+KfcGenUiWidgetKind\.values/u.test(generator ?? '')) return [{ name: template, dimension: { unresolved: true }, method: 'unresolved dynamic generator', resolved: false }];
    const enumPath = resolve(root, 'apps/kfc_live_monitor_flutter/lib/features/customer_chat/domain/kfc_genui_models.dart');
    const body = readFileSync(enumPath, 'utf8').match(/enum KfcGenUiWidgetKind\s*\{([\s\S]*?);/u)?.[1] ?? '';
    const values = [...body.matchAll(/\b\w+\('([^']+)'\)/gu)].map((match) => match[1]);
    return values.map((value) => resolved(template.replace('${kind.wireName}', value), { kind_wire_name: value }, 'repository-specific enum wireName resolver'));
  }
  if (rel.endsWith('kfc_genui_renderer_test.dart') && template === 'support handoff renders ${state.key} lifecycle state' && /'requested'[\s\S]*'queued'[\s\S]*'joined'[\s\S]*\.entries/u.test(generator ?? '')) {
    return ['requested', 'queued', 'joined'].map((value) => resolved(template.replace('${state.key}', value), { handoff_lifecycle_state: value }, 'repository-specific support-handoff map-entry resolver'));
  }
  if (rel.endsWith('customer_chat_genui_conversation_test.dart') && template === 'hydrates and renders persisted ${scenarioPlan.fileName} without a model call' && /scenarioPlan\s+in\s+capturePlan\.scenarios/u.test(generator ?? '')) {
    const generated = resolve(root, 'apps/kfc_live_monitor_flutter/integration_test/support/generated_genui_scenario_capture_data.dart');
    const json = readFileSync(generated, 'utf8').match(/const genUiScenarioCapturePlanJson = r'''([\s\S]*?)''';/u)?.[1];
    const values = json ? JSON.parse(json).scenarios.map(({ fileName }) => fileName) : [];
    return values.map((value) => resolved(template.replace('${scenarioPlan.fileName}', value), { scenario_file: value }, 'repository-specific generated capture-plan JSON resolver'));
  }
  const dynamic = !template || /\$/u.test(template) || generator;
  return [{
    name: template ?? `unresolved test name in ${rel}`,
    dimension: dynamic ? { unresolved: true } : { authored_case: true },
    method: dynamic ? 'unresolved static expression or dynamic generator' : 'static literal extraction',
    resolved: !dynamic,
  }];
}

export function extractFlutter(root, git) {
  const packageRoot = resolve(root, 'apps/kfc_live_monitor_flutter');
  const files = walk(packageRoot, (_path, rel) => (rel.startsWith('test/') || rel.startsWith('integration_test/')) && rel.endsWith('_test.dart'));
  const records = []; let declarations = 0; let unresolved = 0;
  const declarationPattern = /\b(testGoldenScene|testWidgets|testGoldens|goldenTest|test)\s*\(/gu;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const rel = relative(root, file).replaceAll('\\', '/');
    for (const match of source.matchAll(declarationPattern)) {
      declarations += 1;
      const open = match.index + match[0].lastIndexOf('(');
      const call = balancedCall(source, open);
      const expression = firstArgument(call);
      const template = literalTemplate(expression);
      const line = source.slice(0, match.index).split('\n').length;
      const generator = enclosingForGenerator(source, match.index);
      const expansions = flutterExpansions(rel, template, generator, root);
      if (expansions.some((expansion) => !expansion.resolved)) unresolved += 1;
      const kind = rel.includes('/goldens/') ? 'flutter_golden'
        : rel.includes('/integration_test/') ? 'flutter_integration'
        : match[1] === 'testWidgets' ? 'flutter_widget' : 'flutter_unit';
      const tiers = kind === 'flutter_integration' ? ['manual/deployed acceptance integration tier']
        : rel.includes('/features/customer_chat/') ? ['local flutter test', 'pull_request and main customer-chat CI subset']
        : ['local flutter test; not selected by current workflow subset'];
      for (const expansion of expansions) {
        records.push(recordBase({
          root, git, recordType: 'test_case', sourcePath: file, line,
          testName: expansion.name, sourceKind: kind, framework: 'Flutter test',
          mechanism: match[1], evidenceText: call, runnerTiers: tiers,
          extractionMethod: expansion.method, confidence: expansion.resolved ? 'high' : 'low',
          extractionEvidence: `authored declaration expression: ${expression.slice(0, 180)}; generator signature sha256=${sha(generator ?? 'none')}`,
          profileEnablement: [kind], executionDimensions: expansion.dimension,
          overlapSignals: kind === 'flutter_golden' ? ['golden test and Flutter widget rendering overlap'] : [],
          assertionSummary: `Flutter ${match[1]} case; callback evidence contains ${assertionTypes(call).join(', ')}`,
        }));
      }
    }
  }
  return { records, anchors: { source_files: files.length, authored_declarations: declarations, expanded_cases: records.length, unresolved_name_expressions: unresolved } };
}

function shellCommands(source) {
  const lines = source.split('\n');
  const commands = [];
  let inArrayAssignment = false;
  for (let index = 0; index < lines.length; index += 1) {
    const start = index; let text = lines[index];
    while (text.trimEnd().endsWith('\\') && index + 1 < lines.length) text += `\n${lines[++index]}`;
    const trimmed = text.trim();
    if (inArrayAssignment) {
      if (trimmed === ')') inArrayAssignment = false;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=\($/u.test(trimmed)) { inArrayAssignment = true; continue; }
    const heredoc = /<<'?NODE'?/u.test(trimmed);
    if (heredoc) {
      const body = [];
      while (index + 1 < lines.length && lines[index + 1].trim() !== 'NODE') body.push(lines[++index]);
      if (index + 1 < lines.length) index += 1;
      commands.push({ line: start + 1, endLine: index + 1, text: `${trimmed}\n${body.join('\n')}`, group: 'embedded-node-assertion-group' });
      continue;
    }
    const multilineFailureAction = /^(?:if|elif)\s[\s\S]*;\s*then$/u.test(trimmed) && /(?:\$ROOT_DIR\/scripts\/|deploy-backend|run-kfc-deployed-acceptance)/u.test(trimmed);
    const multilineZeroExitAction = /^[A-Za-z_][A-Za-z0-9_]*=.*\\\n[\s\S]*(?:^|\n)\s*"?\$ROOT_DIR\/scripts\//u.test(trimmed);
    const directVerificationAction = /^"?\$ROOT_DIR\/scripts\//u.test(trimmed);
    const assignment = /^[A-Za-z_][A-Za-z0-9_]*=/.test(trimmed);
    const assertionCommand = /^(?:!\s*)?(?:test|grep|rg|node\b|bash\s+-n\b|cmp\b|diff\b|shasum\b)/u.test(trimmed);
    const meaningful = multilineFailureAction || multilineZeroExitAction || directVerificationAction || (!assignment && (
      assertionCommand ||
      /^(?:if|elif)\s[\s\S]+;\s*then$/u.test(trimmed) ||
      /^(?:scan_acceptance_artifacts_for_secrets|assert_[A-Za-z0-9_]+)/u.test(trimmed)
    ));
    if (meaningful) {
      const group = multilineFailureAction ? 'expected-failure-verification-action'
        : multilineZeroExitAction || directVerificationAction ? 'set-e-zero-exit-verification-action'
        : null;
      commands.push({ line: start + 1, endLine: index + 1, text: trimmed, group });
    }
  }
  return commands;
}

export function extractShell(root, git) {
  const file = resolve(root, 'tests/deployment/deploy_scripts.test.sh');
  const source = readFileSync(file, 'utf8');
  const commands = shellCommands(source);
  const records = commands.map(({ line, endLine, text, group }) => recordBase({
    root, git, recordType: 'shell_assertion', sourcePath: file, line,
    testName: text.split('\n')[0].slice(0, 220), sourceKind: 'deployment_shell_assertion',
    framework: 'Bash', mechanism: group ?? 'top-level assertion command', evidenceText: text,
    runnerTiers: ['direct shell regression suite; CI tier not found in current workflows'],
    extractionMethod: 'traceable shell command parser', confidence: group ? 'medium' : 'high',
    extractionEvidence: `${group ?? 'top-level assertion command'} at source lines ${line}-${endLine}; continuations joined`,
    profileEnablement: ['deployment-shell'], executionDimensions: { canonical_case_boundary: null, source_line_span: [line, endLine] },
    assertionSummary: group === 'embedded-node-assertion-group'
      ? 'Embedded Node assertion group; individual JavaScript checks remain grouped at the heredoc boundary'
      : group
        ? `Shell verification action whose expected exit behavior is enforced by set -e or an expected-failure branch: ${text.replaceAll('\n', ' ').slice(0, 260)}`
        : `Shell assertion: ${text.replaceAll('\n', ' ').slice(0, 300)}`,
    group, logicalCase: null,
  }));
  return {
    records,
    anchors: {
      assertion_records: records.length,
      embedded_groups: commands.filter(({ group }) => group === 'embedded-node-assertion-group').length,
      expected_failure_actions: commands.filter(({ group }) => group === 'expected-failure-verification-action').length,
      zero_exit_actions: commands.filter(({ group }) => group === 'set-e-zero-exit-verification-action').length,
    },
  };
}

function commandRecord(root, git, sourcePath, line, name, mechanism, tiers, evidence, overlap = [], dimensions = {}) {
  return recordBase({
    root, git, recordType: 'command_surface', sourcePath, line, testName: name,
    sourceKind: 'verification_command_surface', framework: 'command/orchestration', mechanism,
    evidenceText: evidence, runnerTiers: tiers, extractionMethod: 'static command-surface parser',
    confidence: 'high', extractionEvidence: evidence.slice(0, 400), profileEnablement: tiers,
    executionDimensions: { command_surface_only: true, ...dimensions }, overlapSignals: overlap,
    assertionSummary: 'Command surface or producer/orchestrator; intentionally not counted as an authored test case',
  });
}

export function extractCommandSurfaces(root, git) {
  const matrix = qualificationMatrix(root);
  const records = [];
  const packagePath = resolve(root, 'services/kfc-agent-backend/package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  const packageLines = readFileSync(packagePath, 'utf8').split('\n');
  const selected = /^(?:test:(?:live|genui)|proof:|eval:|policies:check$|check:architecture$|worker:preflight$)/u;
  const selectedTargetCommands = [];
  const commandOwners = new Map();
  for (const [name, command] of Object.entries(pkg.scripts)) {
    if (!selected.test(name)) continue;
    selectedTargetCommands.push(command);
    const line = packageLines.findIndex((value) => value.includes(`"${name}"`)) + 1;
    const owners = commandOwners.get(command) ?? [];
    owners.push(name); commandOwners.set(command, owners);
    records.push(commandRecord(root, git, packagePath, line, `npm run ${name}`, 'package script',
      name.includes('live') || name.startsWith('proof:') || name.startsWith('eval:') ? ['local opt-in/live/proof tier'] : ['local validation and backend CI tier'],
      command, [`package script target: ${command}`],
      name === 'test:live:qualification:text' ? { qualification_contract: matrix } : {}));
  }
  for (const record of records) {
    const command = record.overlap_signals[0]?.replace('package script target: ', '');
    const aliases = commandOwners.get(command) ?? [];
    if (aliases.length > 1) record.overlap_signals.push(`same target shared by aliases: ${aliases.sort().join(', ')}`);
  }

  const workflows = walk(resolve(root, '.github/workflows'), (path) => ['.yml', '.yaml'].includes(extname(path)));
  for (const workflow of workflows) {
    const lines = readFileSync(workflow, 'utf8').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const scalar = lines[index].match(/^\s*-?\s*run:\s*(.+)$/u);
      if (scalar && scalar[1] !== '|') {
        records.push(commandRecord(root, git, workflow, index + 1, scalar[1], 'GitHub Actions run step', ['GitHub Actions workflow'], scalar[1], ['may invoke a package-script command surface'], scalar[1].includes('test:live:qualification:text') ? { qualification_contract: matrix } : {}));
      } else if (/^\s*-?\s*run:\s*\|\s*$/u.test(lines[index])) {
        const indent = lines[index].match(/^\s*/u)[0].length; const body = [];
        let cursor = index + 1;
        while (cursor < lines.length && (lines[cursor].trim() === '' || lines[cursor].match(/^\s*/u)[0].length > indent)) body.push(lines[cursor++].trim());
        const commands = body.filter((value) => /^(?:npm|npx|flutter|test\b|node\b|\.\/|mkdir\b)/u.test(value));
        for (const command of commands) records.push(commandRecord(root, git, workflow, index + 1, command, 'GitHub Actions block command', ['GitHub Actions workflow'], command, ['workflow orchestration; aliases are not test cases'], command.includes('test:live:qualification:text') ? { qualification_contract: matrix } : {}));
        index = cursor - 1;
      }
    }
  }

  const acceptance = resolve(root, 'scripts/run-kfc-deployed-acceptance.sh');
  const acceptanceLines = readFileSync(acceptance, 'utf8').split('\n');
  for (let index = 0; index < acceptanceLines.length; index += 1) {
    const text = acceptanceLines[index].trim();
    if (/^(?:npm run|flutter (?:test|analyze)|node "\$|gh release create|"\$ROOT_DIR\/scripts\/)/u.test(text)) {
      records.push(commandRecord(root, git, acceptance, index + 1, text.slice(0, 240), 'deployed acceptance orchestration command', ['manual deployed acceptance/release tier'], text, ['orchestrates other command surfaces; not an authored test case'], text.includes('test:live:qualification:text') ? { qualification_contract: matrix } : {}));
    }
  }

  const commandTargetCorpus = [
    ...selectedTargetCommands,
    ...workflows.map((file) => readFileSync(file, 'utf8')),
    readFileSync(acceptance, 'utf8'),
  ].join('\n');
  const direct = walk(root, (path, rel) =>
    (rel.startsWith('scripts/') || rel.startsWith('services/kfc-agent-backend/scripts/')) &&
    ['.ts', '.mjs', '.js', '.sh'].includes(extname(path)));
  for (const file of direct) {
    const rel = relative(root, file).replaceAll('\\', '/');
    if (rel === 'scripts/generate-test-suite-inventory.mjs') continue;
    const source = readFileSync(file, 'utf8');
    if (rel.includes('/lib/') && rel.endsWith('.sh')) continue;
    const referencedTarget = commandTargetCorpus.includes(rel) || commandTargetCorpus.includes(`scripts/${file.split('/').at(-1)}`);
    const argvCli = /process\.argv|import\.meta\.url\s*\)|\b(?:main|run)\(\)\.catch\(/u.test(source);
    const executableShebang = /^#!.*(?:node|bash|sh)/u.test(source) && !(rel.includes('/lib/') && rel.endsWith('.sh'));
    const namedTopLevelRunner = /\/(?:run|check|verify|validate|consolidate|capture)-[^/]+\.(?:ts|mjs|js|sh)$/u.test(`/${rel}`);
    const keywordCandidate = /(?:proof|eval|verify|validate|check|qualification|acceptance|canary)/iu.test(rel);
    const credibleCli = argvCli || executableShebang || namedTopLevelRunner;
    if (!(referencedTarget || (keywordCandidate && credibleCli))) continue;
    const first = source.split('\n').findIndex((line) => line.trim() && !line.startsWith('#!')) + 1;
    const signals = [referencedTarget && 'referenced command target', argvCli && 'argv/main CLI signal', executableShebang && 'executable shebang', namedTopLevelRunner && 'top-level runner naming'].filter(Boolean);
    records.push(commandRecord(root, git, file, Math.max(1, first), rel, 'direct executable verification script', ['direct/manual or package/workflow-invoked tier'], `${rel}; ${signals.join(', ')}`, ['verified CLI/command target; not a test case'], rel.includes('live-text-qualification') ? { qualification_contract: matrix } : {}));
  }
  const unique = new Map(records.map((record) => [record.id, record]));
  const values = [...unique.values()];
  return {
    records: values,
    anchors: {
      package_script_surfaces: values.filter((r) => r.framework_mechanism.mechanism === 'package script').length,
      workflow_command_surfaces: values.filter((r) => r.framework_mechanism.mechanism.startsWith('GitHub Actions')).length,
      acceptance_command_surfaces: values.filter((r) => r.framework_mechanism.mechanism === 'deployed acceptance orchestration command').length,
      direct_script_surfaces: values.filter((r) => r.framework_mechanism.mechanism === 'direct executable verification script').length,
    },
  };
}
