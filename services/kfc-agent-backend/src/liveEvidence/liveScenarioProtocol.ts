import { z } from 'zod';
import {
  createEvidenceSanitizer,
  serializeEvidenceJsonLine,
  type EvidenceSanitizer,
} from './evidenceRedaction.js';

const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user'), text: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal('action'),
      assistantTurnId: z.string().min(1),
      attachmentId: z.string().min(1),
      actionId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('finish'),
      note: z.string().min(1).optional(),
    })
    .strict(),
]);

export interface LiveScenarioAssistantObservation {
  responseText: string;
  assistantTurnId?: string | null;
  genUi?: unknown;
  renderedActionReferences?: Array<{
    assistantTurnId: string;
    attachmentId: string;
    actionId: string;
  }>;
}

export interface LiveScenarioProtocolSession {
  submitUserMessage(text: string): Promise<LiveScenarioAssistantObservation>;
  submitAction(input: {
    assistantTurnId: string;
    attachmentId: string;
    actionId: string;
  }): Promise<LiveScenarioAssistantObservation>;
  recordAssistantRendered(
    observation: LiveScenarioAssistantObservation,
  ): Promise<void>;
  finish(note?: string): Promise<void>;
  commitFinish(): Promise<void>;
  finalizeTerminal(): Promise<void>;
  recordProtocolError(
    error: 'invalid_json' | 'invalid_command' | 'turn_error' | 'control_error',
    errorClass?: string,
  ): Promise<void>;
  interrupt(reason: 'stdin_eof' | 'control_error'): Promise<void>;
}

export async function runLiveScenarioCommandStream(input: {
  session: LiveScenarioProtocolSession;
  lines: AsyncIterable<string>;
  writeLine(line: string): void | Promise<void>;
  sanitize?: EvidenceSanitizer;
}): Promise<void> {
  let finished = false;
  let interrupted = false;
  try {
    for await (const line of input.lines) {
      const normalized = line.trim();
      if (!normalized) continue;
      let value: unknown;
      try {
        value = JSON.parse(normalized);
      } catch {
        await input.session.recordProtocolError('invalid_json');
        await emit(input, { type: 'protocol_error', error: 'invalid_json' });
        continue;
      }
      const parsed = commandSchema.safeParse(value);
      if (!parsed.success) {
        await input.session.recordProtocolError('invalid_command');
        await emit(input, { type: 'protocol_error', error: 'invalid_command' });
        continue;
      }
      if (parsed.data.type === 'finish') {
        await input.session.finish(parsed.data.note);
        await emit(input, { type: 'finished' });
        await input.session.commitFinish();
        await input.session.finalizeTerminal();
        finished = true;
        return;
      }
      try {
        const result =
          parsed.data.type === 'user'
            ? await input.session.submitUserMessage(parsed.data.text)
            : await input.session.submitAction({
                assistantTurnId: parsed.data.assistantTurnId,
                attachmentId: parsed.data.attachmentId,
                actionId: parsed.data.actionId,
              });
        await emit(input, {
          type: 'assistant',
          text: result.responseText,
          ...(result.assistantTurnId === undefined
            ? {}
            : { assistantTurnId: result.assistantTurnId }),
          ...(result.genUi === undefined ? {} : { genUi: result.genUi }),
          ...(result.renderedActionReferences === undefined
            ? {}
            : {
                renderedActionReferences: result.renderedActionReferences,
              }),
        });
        await input.session.recordAssistantRendered(result);
      } catch (error) {
        const errorClass = safeErrorClass(error);
        await input.session.recordProtocolError('turn_error', errorClass);
        await emit(input, {
          type: 'turn_error',
          errorClass,
        });
      }
    }
  } catch (error) {
    interrupted = true;
    await input.session.recordProtocolError(
      'control_error',
      safeErrorClass(error),
    );
    await input.session.interrupt('control_error');
    await input.session.finalizeTerminal();
    throw error;
  } finally {
    if (!finished && !interrupted) {
      await input.session.interrupt('stdin_eof');
      await input.session.finalizeTerminal();
    }
  }
}

async function emit(
  input: Pick<
    Parameters<typeof runLiveScenarioCommandStream>[0],
    'writeLine' | 'sanitize'
  >,
  value: Record<string, unknown>,
): Promise<void> {
  await input.writeLine(
    serializeEvidenceJsonLine(
      value,
      input.sanitize ?? createEvidenceSanitizer(),
    ),
  );
}

function safeErrorClass(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(name) ? name : 'UnknownError';
}
