export type LocalToolEvidenceEvent =
  | {
      phase: 'started';
      callId: string;
      toolName: string;
      arguments: unknown;
      requestedAt: string;
    }
  | {
      phase: 'completed';
      callId: string;
      toolName: string;
      arguments: unknown;
      rawResult: unknown;
      modelFacingResult: unknown;
      executionStartedAt: string;
      completedAt: string;
      executionDurationMs: number;
    }
  | {
      phase: 'failed';
      callId: string;
      toolName: string;
      arguments: unknown;
      error: unknown;
      requestedAt: string;
      executionStartedAt?: string;
      completedAt: string;
      totalDurationMs: number;
      executionDurationMs?: number;
    };
