export interface BusinessAgentPack<TTurn, TResult> {
  readonly id: string;
  runTurn(turn: TTurn): Promise<TResult>;
}

export interface AgentPackIdentity {
  readonly id: string;
}

export interface AgentPackRegistryOptions {
  readonly expectedIds?: readonly string[];
}

function requireNonEmptyId(id: string | null | undefined): string {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('agent_pack_id_missing');
  }
  return id;
}

function validatedUniqueIds(ids: readonly string[]): readonly string[] {
  const unique = new Set<string>();
  for (const candidate of ids) {
    const id = requireNonEmptyId(candidate);
    if (unique.has(id)) {
      throw new Error(`agent_pack_id_duplicate:${id}`);
    }
    unique.add(id);
  }
  return Object.freeze([...unique]);
}

export class AgentPackRegistry<
  TPack extends AgentPackIdentity = AgentPackIdentity,
> {
  readonly #packsById: ReadonlyMap<string, TPack>;
  readonly ids: readonly string[];

  constructor(packs: readonly TPack[], options: AgentPackRegistryOptions = {}) {
    const packIds = validatedUniqueIds(packs.map(({ id }) => id));
    const expectedIds = options.expectedIds
      ? validatedUniqueIds(options.expectedIds)
      : undefined;

    if (expectedIds) {
      const expected = new Set(expectedIds);
      for (const id of packIds) {
        if (!expected.has(id)) {
          throw new Error(`agent_pack_id_unknown:${id}`);
        }
      }
      const registered = new Set(packIds);
      for (const id of expectedIds) {
        if (!registered.has(id)) {
          throw new Error(`agent_pack_registration_missing:${id}`);
        }
      }
    }

    this.ids = packIds;
    this.#packsById = new Map(packs.map((pack) => [pack.id, pack]));
    Object.freeze(this);
  }

  require(id: string | null | undefined): TPack {
    const requiredId = requireNonEmptyId(id);
    const pack = this.#packsById.get(requiredId);
    if (!pack) {
      throw new Error(`agent_pack_id_unknown:${requiredId}`);
    }
    return pack;
  }
}
