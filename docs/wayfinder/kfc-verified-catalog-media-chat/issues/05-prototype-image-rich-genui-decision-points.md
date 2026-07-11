Status: resolved
Type: prototype
Labels: wayfinder:prototype
Parent: ../map.md
Blocked by: 01-audit-catalog-media-flow-and-rendering-gaps.md, 04-design-media-fixture-and-refresh-contract.md
Assignee: Codex

## Question

What should image-rich GenUI look and behave like at menu discovery, recommendation, product detail, modifier selection, promotion discovery, ingredient/allergen answers, and the first cart summary? Create the smallest reviewable prototype that proves the five-card discovery limit, single-image detail limit, loading/error behavior, accessibility text, transcript replay, and text-only degradation without redesigning unrelated widgets.

## Answer

The reviewed [KFC Image-Rich GenUI Prototype](../assets/image-rich-genui-prototype/README.md) and its [browser entrypoint](../assets/image-rich-genui-prototype/index.html) define the accepted visual and interaction contract for seven decision states: menu discovery, product detail, modifier selection, active promotions, allergen evidence, the first cart summary, and media failure.

The accepted prototype establishes:

- at most five verified official KFC images for discovery and one image for detail, modifier, allergen, or cart decisions;
- zero-based per-dish quantity controls in the menu chooser, with no per-row add buttons and exactly one disabled-until-selected `Xác nhận món` action;
- one display-ordered batch confirmation payload containing only non-zero item quantities;
- modifier media changes only after an explicit option selection;
- expired promotions remain excluded;
- the first main-item cart image remains stable across quantity changes;
- failed or absent media collapses completely while text and actions remain usable;
- neutral loading shimmer, Vietnamese alternative text, source-ratio preservation, and no generated, substituted, or fallback artwork.

The standalone model has seven passing deterministic tests. A headless browser walkthrough verified all seven states, one chooser-level confirmation action, five-to-zero media collapse, the modifier-image transition, two active promotion cards, the official allergen link, stable cart media, and no horizontal overflow at 390px or 620px. Direct HTTP checks verified all nine prototype image URLs as reachable official image responses under the shared 1 MB channel limit.
