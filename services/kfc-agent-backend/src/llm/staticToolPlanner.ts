import type { ToolPlanner, ToolPlannerInput, ToolPlannerOutput } from './toolPlanner.js';

export class StaticToolPlanner implements ToolPlanner {
  readonly supportsMultiStep = false;
  private index = 0;

  constructor(private readonly outputs: ToolPlannerOutput[]) {}

  async plan(_input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    const output = this.outputs[this.index] ?? this.outputs.at(-1);
    this.index += 1;
    return output ?? {
      intent: 'unclear',
      entities: {},
      toolCalls: [],
      responseClaims: [],
      directResponse: 'Mình cần thêm thông tin để hỗ trợ đúng.',
    };
  }
}
