import type { ToolName } from '../../ordering/types.js';
import type { KfcWebToolName } from './webTools.js';

export interface KfcTurnToolReceipt {
  readonly id: string;
  readonly name: ToolName | KfcWebToolName;
  readonly effect:
    'provider_read' | 'reversible_mutation' | 'irreversible_mutation';
  readonly status: 'success' | 'error' | 'confirmation_required';
  readonly evidenceId?: string;
  readonly evidenceMode?: 'live_web';
  readonly sourceUrls?: readonly string[];
  readonly durationMs?: number;
}

export type KfcCoreToolReceipt = KfcTurnToolReceipt & {
  readonly name: ToolName;
};

export type KfcWebToolReceipt = KfcTurnToolReceipt & {
  readonly name: KfcWebToolName;
  readonly effect: 'provider_read';
  readonly status: 'success' | 'error';
  readonly evidenceMode: 'live_web';
  readonly durationMs: number;
};
