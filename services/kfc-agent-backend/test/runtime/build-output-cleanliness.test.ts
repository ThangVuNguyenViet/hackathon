import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const retiredBuildOutputs = [
  'src/llm/responseComposer.js',
  'src/llm/smallTalkRouter.js',
  'src/llm/staticToolPlanner.js',
  'src/llm/toolPlanner.js',
  'src/llm/toolPlannerNormalization.js',
  'src/llm/vertexPlannerTransport.js',
  'src/graph/responseComposition.js',
  'src/graph/turnPlanning.js',
] as const;
const retiredBuildOutputSet = new Set<string>(retiredBuildOutputs);

function listFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else {
        files.push(relative(root, path).split(sep).join('/'));
      }
    }
  };
  visit(root);
  return files;
}

function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

describe('backend build output', () => {
  it('removes retired modules before compiling the current runtime', () => {
    const backendRoot = process.cwd();
    const distRoot = join(backendRoot, 'dist');

    for (const output of retiredBuildOutputs) {
      const path = join(distRoot, output);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, 'throw new Error("retired build output");\n');
    }

    const build = spawnSync(npmCommand(), ['run', 'build', '--silent'], {
      cwd: backendRoot,
      encoding: 'utf8',
    });
    if (build.status !== 0) {
      throw new Error(
        [
          'backend build failed',
          build.error?.message,
          build.stdout,
          build.stderr,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }

    expect(existsSync(join(distRoot, 'src/index.js'))).toBe(true);
    expect(existsSync(join(distRoot, 'src/agent/agentStateGraph.js'))).toBe(
      false,
    );

    const executableOutputs = listFiles(distRoot).filter((path) =>
      path.endsWith('.js'),
    );
    expect(
      executableOutputs.filter(
        (path) =>
          retiredBuildOutputSet.has(path) ||
          /^src\/llm\/toolPlanner[^/]*\.js$/u.test(path),
      ),
    ).toEqual([]);
  }, 120_000);
});
