export type LocalToolEvidenceEvent =
  | {
      phase: 'started';
      callId: string;
      toolName: string;
      arguments: unknown;
      startedAt: string;
    }
  | {
      phase: 'completed';
      callId: string;
      toolName: string;
      arguments: unknown;
      rawResult: unknown;
      modelFacingResult: unknown;
      startedAt: string;
      completedAt: string;
      durationMs: number;
    }
  | {
      phase: 'failed';
      callId: string;
      toolName: string;
      arguments: unknown;
      error: unknown;
      startedAt: string;
      completedAt: string;
      durationMs: number;
    };
