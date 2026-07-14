# KFC Best-Quality Live Demo Readiness Map

Labels: wayfinder:map

## Destination

Produce a decision-ready implementation, verification, deployment, and rehearsal specification for a three-minute first-party KFC ordering demo that reliably proves short natural conversation, verified menu-and-modifier-aware recommendations, visible cart changes and upsizing, explicit fulfillment/payment/order consent, and truthful payment, order, and delivery status.

The map is complete when the golden journey, fail-closed commerce-truth boundary, frozen catalog contract, controllable environment-scoped lifecycle, deterministic and live coverage, KFC GenUI proof, Messenger text parity, release gates, and exact fallback recording are specified well enough to execute without further product or architecture decisions.

## Notes

Domain: KFC conversational ordering, first-party Flutter customer chat, Messenger parity, verified menu and modifier snapshots, cart and checkout state, environment-scoped payment/order/delivery lifecycle, StateGraph behavior, GenUI, live-AI evaluation, deployment provenance, and demo rehearsal.

Skills every session should consult: `wayfinder`, `grilling`, and `domain-modeling`.

Planning only during this map. Do not implement product/runtime changes while charting or resolving a decision unless the user explicitly starts a separate implementation effort.

Settled direction:

- The presentation uses one polished end-to-end KFC golden journey plus short live branch proofs. The first-party KFC app is the on-stage surface; Messenger text parity is release-blocking.
- The segment has a three-minute budget. Non-address customer turns use natural fragments of roughly two to seven words; the candidate opener is `Có combo gà cay không?`.
- Short text proves discovery, recommendations, and status understanding. GenUI performs exact item selection, cart changes, modifier/upsize selection, address acceptance, payment selection, and irreversible confirmation. Branch tests prove text equivalents.
- Suggestions must be derived from verified menu items and modifier compatibility, not prompt-keyword shortcuts. A refreshed official-source-backed catalog snapshot is frozen across implementation, tests, rehearsals, deployment, and recording.
- Every customer-facing address, store, menu/modifier, cart, promotion, fulfillment, payment, order, and delivery claim is a Verified Commerce Fact returned or accepted under the current Commerce Environment contract. Missing evidence fails closed with clarification or an unavailable result; unbound defaults and cross-environment values are never substituted.
- The sandbox uses an explicit environment-scoped lifecycle provider for visible `pending -> paid` payment and `preparing -> out for delivery` order progression. Its test controls are available only to the proof harness, while its successful provider responses are ordinary authoritative sandbox facts and carry no customer-facing simulation label. Transitions are never inferred from customer wording or hidden query counts.
- Deterministic tests exhaustively validate the frozen catalog and all item/modifier relationships. Live AI covers every behavior class with representative products and natural short paraphrases rather than every product permutation.
- Readiness requires five consecutive deployed golden-journey passes and three consecutive complete live branch-matrix passes on one exact clean release, with zero hidden retries, manual repairs, unsupported facts, fixture fallbacks, or text/UI/state contradictions. A failure restarts the relevant count.
- A preloaded recording of the exact journey, deployed SHA, fixture version, and expected states is mandatory presentation insurance but never counts as a live pass.
- Preserve the shared dirty working tree and unrelated edits. The charting baseline includes in-progress StateGraph and conversation-repair changes that must be audited from the current checkout rather than reconstructed from memory.

## Decisions so far

- [Audit Current Demo Failures And Commerce Fallbacks](./issues/01-audit-current-demo-failures-and-commerce-fallbacks.md) — The deployed clean release is infrastructure-ready but confirmed live sessions expose stale journey/address/payment leakage, accidental cart changes, and a missing reply. Local repairs pass focused deterministic tests but fail current live scenario 01, remain undeployed, and use a StateGraph that is still mostly a wrapper around the monolithic turn core.
- [Define The Three-Minute Short-Turn Golden Journey](./issues/02-define-the-three-minute-short-turn-golden-journey.md) — Use one verified `20702` combo, explicit GenUI choices and confirmation, 129,000 -> 135,000 -> 153,000 VND checkpoints, and provider-driven payment/order/delivery status within a 165-second target.
- [Verify And Freeze The Menu And Modifier Snapshot](./issues/03-verify-and-freeze-menu-and-modifier-snapshot.md) — Freeze the official 118-item/56-tree `2026-07-10+3b163094` snapshot, use `20702` for spicy chicken and two +3,000 VND drink upsizes, and fail closed on store/order facts.
- [Design Menu And Modifier-Aware Recommendation Contract](./issues/04-design-menu-and-modifier-aware-recommendation-contract.md) — Filter deterministically, score only eligible items, safety-rerank, and present at most three consent-bound choices with a transparent cold-start baseline and gated learning path.
- [Design Fail-Closed Verified Commerce Facts](./issues/05-design-fail-closed-verified-commerce-facts.md) — Treat configured provider responses as authoritative within their isolated Commerce Environment, bind every fact to current evidence, and make every surface consume one fail-closed verified projection without fallback or simulation labels.
- [Design The Environment-Scoped Commerce Lifecycle Provider](./issues/06-design-the-environment-scoped-commerce-lifecycle-provider.md) — Use durable uniquely bound sandbox scenario instances, guarded payment/order/delivery machines, typed events, logical clocks, revision-checked idempotency and audit, and a sandbox-only control plane absent from production.
- [Design The Exhaustive Coverage Matrix And Oracles](./issues/07-design-the-exhaustive-coverage-matrix-and-oracles.md) — Use a closed-world Scenario Coverage Ledger with exhaustive deterministic hard oracles, one consolidated 44-turn live replay, six catalog representatives, embedded 8x3 short paraphrases, and zero-retry counted passes at bounded concurrency two.

## Not yet specified

- Exact recording cue points and on-stage recovery timing beyond the three-minute budget; these graduate after KFC and Messenger proof contracts resolve.

## Out of scope

- Claiming integration with KFC production OMS, POS, payment, identity, address, or delivery systems. The configured sandbox provider is authoritative only inside sandbox and does not imply upstream production integration.
- Treating an unbound fixture/default, a model inference, old session state, or a UI placeholder as current customer truth.
- Proving every imaginable customer utterance or running every catalog permutation through a stochastic model.
- Giving Messenger the first-party KFC GenUI; Messenger receives text-level commerce parity only.
- Redesigning unrelated Operations Monitor, customer streaming, slide-deck, or submission content beyond what this demo proof requires.
- Implementing runtime changes during this Wayfinder charting session.

## Frontier

Open, unblocked, unassigned child tickets are the frontier. In this local Markdown tracker, `Blocked by` names the tickets that must close first.

- [Design The KFC GenUI Live Proof](./issues/08-design-the-kfc-genui-live-proof.md)
- [Design The Messenger Commerce Parity Proof](./issues/09-design-the-messenger-commerce-parity-proof.md)
