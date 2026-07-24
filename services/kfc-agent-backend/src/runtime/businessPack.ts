import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import type { Callbacks } from '@langchain/core/callbacks/manager';
import type { StructuredToolInterface } from '@langchain/core/tools';

export interface PackRef {
  packId: string;
  version: string;
}

export interface PackStateEnvelope<TState = unknown> {
  envelopeVersion: 1;
  packRef: PackRef;
  schemaVersion: string;
  state: TState;
  integrity: {
    algorithm: 'sha256';
    digest: string;
  };
}

export interface BusinessPackInvocation {
  model: BaseChatModel;
  systemPrompt: string;
  messages: BaseMessage[];
  tools: StructuredToolInterface[];
  signal?: AbortSignal;
  runtime?: {
    callbacks?: Callbacks;
    runWithContext?<T>(operation: () => Promise<T>): Promise<T>;
  };
  responseErrors?: {
    invalid: string;
    empty: string;
  };
}

export type InvokeBusinessPackModel = (
  invocation: BusinessPackInvocation,
) => Promise<string>;

export interface BusinessPack<TInput, TOutput, TState> {
  readonly ref: PackRef;
  readonly stateSchemaVersion: string;
  parseState(value: unknown): TState;
  /**
   * Applies the pack-owned durable namespace to external identifiers.
   * The semantic kernel invokes this only after resolving a trusted binding.
   */
  scopeInput(input: TInput): TInput;
  run(input: TInput, invokeModel: InvokeBusinessPackModel): Promise<TOutput>;
}

export interface TrustedPackBinding {
  readonly ref: PackRef;
}

export interface BusinessPackRegistry<TInput, TOutput, TState> {
  createTrustedBinding(ref: PackRef): TrustedPackBinding;
  resolve(binding: unknown): BusinessPack<TInput, TOutput, TState>;
}

const bindingOwners = new WeakMap<object, symbol>();

export function createBusinessPackRegistry<TInput, TOutput, TState>(
  packs: readonly BusinessPack<TInput, TOutput, TState>[],
): BusinessPackRegistry<TInput, TOutput, TState> {
  const owner = Symbol('business-pack-registry');
  const byRef = new Map<string, BusinessPack<TInput, TOutput, TState>>();
  for (const pack of packs) {
    assertPackRef(pack.ref);
    const key = packRefKey(pack.ref);
    if (byRef.has(key)) {
      throw new Error(`business_pack_duplicate:${key}`);
    }
    byRef.set(key, pack);
  }

  return {
    createTrustedBinding(ref) {
      assertPackRef(ref);
      const pack = byRef.get(packRefKey(ref));
      if (!pack) throw new Error('business_pack_unknown');
      const binding: TrustedPackBinding = Object.freeze({
        ref: Object.freeze({ ...pack.ref }),
      });
      bindingOwners.set(binding, owner);
      return binding;
    },
    resolve(binding) {
      if (!isRecord(binding) || bindingOwners.get(binding) === undefined) {
        throw new Error('pack_binding_untrusted');
      }
      if (bindingOwners.get(binding) !== owner) {
        throw new Error('pack_binding_registry_mismatch');
      }
      const ref = binding.ref;
      if (!isPackRef(ref)) throw new Error('pack_binding_invalid');
      const pack = byRef.get(packRefKey(ref));
      if (!pack) throw new Error('business_pack_unknown');
      return pack;
    },
  };
}

export async function createPackStateEnvelope<TState>(input: {
  packRef: PackRef;
  schemaVersion: string;
  state: TState;
}): Promise<PackStateEnvelope<TState>> {
  assertPackRef(input.packRef);
  if (!input.schemaVersion.trim()) {
    throw new Error('pack_state_schema_version_invalid');
  }
  const unsigned = {
    envelopeVersion: 1 as const,
    packRef: { ...input.packRef },
    schemaVersion: input.schemaVersion,
    state: structuredClone(input.state),
  };
  return {
    ...unsigned,
    integrity: {
      algorithm: 'sha256',
      digest: await sha256(unsigned),
    },
  };
}

export function scopePackSessionId(
  packRef: PackRef,
  externalSessionId: string,
): string {
  assertPackRef(packRef);
  if (!externalSessionId.trim()) throw new Error('session_id_invalid');
  return `pack:${packRef.packId}@${packRef.version}:${externalSessionId}`;
}

/**
 * Keeps KFC's established durable keys coherent with existing run, delivery,
 * dashboard, and session-authority records. The `pack:` prefix is reserved
 * exclusively for namespaced pluggable business packs.
 */
export function legacySessionIdOutsidePackNamespace(
  externalSessionId: string,
): string {
  if (!externalSessionId.trim()) throw new Error('session_id_invalid');
  if (externalSessionId.startsWith('pack:')) {
    throw new Error('business_pack_session_namespace_reserved');
  }
  return externalSessionId;
}

export async function validatePackStateEnvelope<TState>(
  value: unknown,
  expected: {
    packRef: PackRef;
    schemaVersion: string;
    parseState(value: unknown): TState;
  },
): Promise<TState> {
  if (!isRecord(value) || value.envelopeVersion !== 1) {
    throw new Error('pack_state_envelope_version_mismatch');
  }
  if (
    !isPackRef(value.packRef) ||
    !samePackRef(value.packRef, expected.packRef)
  ) {
    throw new Error('pack_state_ref_mismatch');
  }
  if (
    typeof value.schemaVersion !== 'string' ||
    value.schemaVersion !== expected.schemaVersion
  ) {
    throw new Error('pack_state_schema_mismatch');
  }
  if (
    !isRecord(value.integrity) ||
    value.integrity.algorithm !== 'sha256' ||
    typeof value.integrity.digest !== 'string'
  ) {
    throw new Error('pack_state_integrity_invalid');
  }
  const digest = await sha256({
    envelopeVersion: value.envelopeVersion,
    packRef: value.packRef,
    schemaVersion: value.schemaVersion,
    state: value.state,
  });
  if (digest !== value.integrity.digest) {
    throw new Error('pack_state_integrity_mismatch');
  }
  return expected.parseState(value.state);
}

function assertPackRef(ref: PackRef): void {
  if (!isPackRef(ref)) throw new Error('business_pack_ref_invalid');
}

function isPackRef(value: unknown): value is PackRef {
  return (
    isRecord(value) &&
    typeof value.packId === 'string' &&
    value.packId.trim().length > 0 &&
    typeof value.version === 'string' &&
    value.version.trim().length > 0
  );
}

function samePackRef(left: PackRef, right: PackRef): boolean {
  return left.packId === right.packId && left.version === right.version;
}

function packRefKey(ref: PackRef): string {
  return `${ref.packId}@${ref.version}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
