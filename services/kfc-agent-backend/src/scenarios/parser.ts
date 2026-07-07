import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

export interface ScenarioTurn {
  index: number;
  speaker: 'User' | 'Bot';
  text: string;
  useCases: string[];
}

export interface ScenarioScript {
  id: string;
  title: string;
  channel: 'messenger_mock' | 'zalo_mock' | 'web_mock';
  goal: string;
  useCases: string[];
  finalState: string;
  turns: ScenarioTurn[];
  userTurns: ScenarioTurn[];
  expectations: string[];
}

function mapChannel(raw: string): ScenarioScript['channel'] {
  if (/Messenger/i.test(raw)) return 'messenger_mock';
  if (/Zalo/i.test(raw)) return 'zalo_mock';
  return 'web_mock';
}

function parseCsvUseCases(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part === 'Filler' || /^UC-\d+$/u.test(part));
}

function parseMarkdownTableRow(line: string): string[] {
  return line
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
}

function parseScenarioTurn(line: string): ScenarioTurn | null {
  if (!/^\|\s*\d+\s*\|/u.test(line)) return null;

  const cells = parseMarkdownTableRow(line);
  const index = Number(cells[0]);
  const speaker = cells[1];
  const text = cells[2] ?? '';
  const useCases = parseCsvUseCases(cells[3] ?? '');
  if ((speaker !== 'User' && speaker !== 'Bot') || useCases.length === 0) return null;

  return { index, speaker, text, useCases };
}

export async function parseScenarioFile(filePath: string): Promise<ScenarioScript> {
  const markdown = await readFile(filePath, 'utf8');
  const title = markdown.match(/^#\s+(.+)$/m)?.[1] ?? basename(filePath, '.md');
  const channel = mapChannel(markdown.match(/- Kênh:\s*(.+)/)?.[1] ?? 'Website chat mock');
  const goal = markdown.match(/- Mục tiêu demo:\s*(.+)/)?.[1] ?? '';
  const useCases = parseCsvUseCases(markdown.match(/- Use case bao phủ:\s*(.+)/)?.[1] ?? '');
  const finalState = markdown.match(/- Trạng thái cuối:\s*`?([^`\n]+)`?/)?.[1] ?? 'unknown';

  const turns = markdown
    .split('\n')
    .map((line) => parseScenarioTurn(line))
    .filter((turn): turn is ScenarioTurn => turn !== null);

  const expectationsBlock = markdown.split('## Kỳ vọng kiểm thử')[1] ?? '';
  const expectations = expectationsBlock
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2));

  return {
    id: basename(filePath, '.md'),
    title,
    channel,
    goal,
    useCases,
    finalState,
    turns,
    userTurns: turns.filter((turn) => turn.speaker === 'User'),
    expectations,
  };
}
