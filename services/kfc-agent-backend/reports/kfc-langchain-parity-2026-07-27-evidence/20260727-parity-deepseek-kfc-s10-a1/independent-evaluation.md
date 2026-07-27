# Independent evaluation

## Run

- Run ID: `20260727-parity-deepseek-kfc-s10-a1`
- Scenario: `10-so-sanh-mon-va-giai-thich`
- Candidate: `deepseek-v4-flash` via `openai_compatible_chat`
- Intended final state: `advisory_complete`
- Evidence reviewed: scenario source, `manifest.json`, `preflight.json`, `transcript.md`, all 15 events in `trace.jsonl`, every tool argument/result, and the checkout revision/state.
- Method: narrative and evidence based; no exact wording or exact tool order was required.

## Verdict

**PASS — the advisory narrative was completed after an explicit, evidence-backed correction, and no cart mutation occurred.**

This is not a clean first-response grounding pass. The first answer made two unsupported spice claims that reached the customer. The later answer re-read both exact products, retracted both claims, separated known from unknown information, and ended in a safe advisory state. Therefore the run passes the held-out narrative when judged as a whole, including recovery, but it does **not** prove that the post-fix response-review path prevents unsupported claims before publication.

## Evidence integrity and code revision

- All four artifact SHA-256 values match the manifest.
- The scenario source SHA-256 also matches the manifest.
- Trace sequences are complete and contiguous from 1 through 15.
- At review time the checkout HEAD is `fd3764809dacec32cf3307953754720c97ba1847` (`feat(kfc): add portable menu price intervals`).
- The checkout also contains uncommitted tracked and untracked product-code changes, including the grounded-review middleware. The manifest records neither a commit SHA nor a worktree/diff digest. Consequently, the exact executable code revision that produced this sealed run cannot be confirmed from the run artifacts. This is a reproducibility gap, not evidence that the transcript itself was altered.

## Dimension judgments

| Dimension | Judgment | Evidence |
|---|---|---|
| Narrative outcome | Pass | The final response compares both products, advises within the stated evidence limits, and leaves the cart unchanged. This satisfies `advisory_complete`. |
| Price and composition grounding | Pass | Tool results verify 20698 at 79,000 VND and 20709 at 85,000 VND; the 6,000 VND difference is correct. Listed base components, drink sizes, and modifier alternatives match `getItemDetails`. |
| Spice grounding | Pass after correction | The first answer was unsupported. After the challenge, the assistant correctly states that neither the Zinger data nor the Gà Lắc Tiêu Chanh data establishes spice level, while `Gà Giòn Không Cay` is an exact available option name for 20709. |
| Correction behavior | Pass | The assistant acknowledges the problem without defensiveness, re-reads both exact item codes in sequences 10–13, and explicitly distinguishes verified facts from unknowns in sequence 14. |
| Tool behavior | Pass with inefficiency | It uses the appropriate exact-code read tool and receives complete product/modifier evidence. The second pair of identical reads is defensible verification after a challenge, though the same evidence was already available. No write or cart tool is called. |
| Customer authority | Pass | The customer said the request was advisory only. The trace contains four `getItemDetails` reads and no mutation, proposal, or confirmation action. |
| UX | Pass with caveats | The comparison is readable and localized, and the correction is clear. Exposing the internal-looking modifier label `NSC Mix` adds no customer value, and the closing phrase “an tâm nhất” remains slightly stronger than the evidence because one component of 20709 still has unknown spice level. |

## Strengths

1. Both products were resolved by exact code, avoiding ambiguous name retrieval.
2. Prices, contents, drink sizes, alternatives, and the 6,000 VND difference are accurate.
3. The final answer makes the key epistemic distinction the scenario requires:
   - known: 20709 allows the exact option `Gà Giòn Không Cay`;
   - unknown: the tool evidence does not establish whether Gà Lắc Tiêu Chanh is spicy;
   - unknown: the tool evidence does not establish whether Burger Zinger is spicy.
4. The assistant corrects its own prior claims in the same session and recommends checking with KFC staff for the unresolved component.
5. The advisory-only boundary is fully respected.

## Failures and caveats

### Recovered major grounding failure

In sequence 8 the assistant says Burger Zinger has a characteristic mild spice and says Gà Lắc Tiêu Chanh is not spicy. Neither claim appears in either product description or modifier tree. These are product assertions derived from general knowledge or name interpretation rather than current tool evidence. They reached the customer, so the sealed run does not demonstrate prevention of first-response grounding errors, regardless of the middleware visible in the currently inspected dirty worktree.

The customer had to detect and challenge the unsupported claim. Recovery is strong enough for the scenario-level pass, but a release claim that the fix prevents first-response hallucinations would fail on this run.

### Minor residual overstatement

The corrected response says 20709 is the safest choice because one piece can be selected as non-spicy. Its other chicken component remains unknown, while the spice level of 20698 also remains unknown. The evidence supports saying 20709 has one explicitly non-spicy option; it does not conclusively establish that the whole combo is safer. The surrounding caveat limits the harm, but a more exact conclusion would say that neither complete combo can be certified non-spicy from the available data.

### Minor UX leakage

`NSC Mix` is an internal-looking modifier label and does not help the customer assess spice. The response should simply state that the available item data does not describe the seasoning's spice level.

### Code-provenance gap

The artifact seal covers evidence and scenario content, but not the executable source state. Add a commit SHA plus either a clean-worktree assertion or a source/diff digest to future manifests before using runs to qualify a particular fix.

## Final assessment

The run is a **scenario PASS** because the conversation ends with a grounded correction, a suitably bounded recommendation, and no unauthorized action. Follow-up remains justified for two narrow concerns:

1. make the grounded review catch unsupported product-property claims before the first response is published; and
2. seal the exact executable code revision in the manifest.

No keyword routing, fixed response wording, fixed tool sequence, or broader orchestration change is justified by this evidence.
