import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { StructuredTool } from '@langchain/core/tools';

export interface ScriptedPvcfcModelCall {
  messages: BaseMessage[];
  toolNames: string[];
  toolChoice: unknown;
}

export class ScriptedPvcfcChatModel extends BaseChatModel {
  readonly calls: ScriptedPvcfcModelCall[];
  private readonly outputs: BaseMessage[];
  private readonly shared: { index: number };
  private tools: StructuredTool[] = [];
  private toolChoice: unknown;

  constructor(input: {
    outputs: BaseMessage[];
    calls?: ScriptedPvcfcModelCall[];
    shared?: { index: number };
  }) {
    super({});
    this.outputs = input.outputs;
    this.calls = input.calls ?? [];
    this.shared = input.shared ?? { index: 0 };
  }

  override _llmType(): string {
    return 'scripted-pvcfc-chat-model';
  }

  override bindTools(
    tools: StructuredTool[],
    options?: Record<string, unknown>,
  ): ScriptedPvcfcChatModel {
    const bound = new ScriptedPvcfcChatModel({
      outputs: this.outputs,
      calls: this.calls,
      shared: this.shared,
    });
    bound.tools = tools;
    bound.toolChoice = options?.tool_choice;
    return bound;
  }

  override async _generate(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    this.calls.push({
      messages: [...messages],
      toolNames: this.tools.map(({ name }) => name),
      toolChoice: this.toolChoice,
    });
    const output = this.outputs[this.shared.index++];
    if (!output) throw new Error('script_exhausted');
    return {
      generations: [
        {
          text: typeof output.content === 'string' ? output.content : '',
          message: output,
        },
      ],
      llmOutput: {},
    };
  }
}
