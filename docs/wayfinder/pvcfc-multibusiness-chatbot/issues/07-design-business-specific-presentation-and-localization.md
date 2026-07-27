Status: resolved
Type: prototype
Labels: wayfinder:prototype
Parent: ../map.md
Blocked by: 06-define-pvcfc-business-pack-capabilities-and-workflows.md
Assignee:

## Question

What presentation contract should the shared customer surface expose, and which text, language, branding, citations, forms, cards, actions, secure media rules, and GenUI components belong to each Business Pack? Produce a low-cost prototype that proves KFC and PVCFC can look and behave appropriately different without Business-specific branching leaking into the shared runtime.

## Answer

See [Business-Specific Presentation And Localization Contract](../assets/business-specific-presentation-and-localization-contract.md).

The low-cost proof is fixture-only and does not claim live backend or app wiring. It implements a [Business-neutral presentation contract and Pack-scoped renderer registry](../../../../apps/kfc_live_monitor_flutter/lib/features/customer_chat/presentation/business/business_presentation_contract.dart) with one [shared shell](../../../../apps/kfc_live_monitor_flutter/lib/features/customer_chat/presentation/business/business_presentation_shell.dart), plus a [KFC compatibility adapter](../../../../apps/kfc_live_monitor_flutter/lib/features/customer_chat/presentation/business/kfc_presentation_prototype_pack.dart) that delegates the current KFC GenUI fixtures without adding Business branching to the shell. The [PVCFC prototype Pack](../../../../apps/kfc_live_monitor_flutter/lib/features/customer_chat/presentation/business/pvcfc_presentation_prototype_pack.dart), [typed models](../../../../apps/kfc_live_monitor_flutter/lib/features/customer_chat/presentation/business/pvcfc_presentation_models.dart), and [renderer](../../../../apps/kfc_live_monitor_flutter/lib/features/customer_chat/presentation/business/pvcfc_presentation_renderer.dart) prove three Pack-scoped families: cited public evidence, official public contact handoff, and synthetic workflow status.

The prototype keeps action meaning in opaque Pack payloads, separates navigation/citation authority from media authority, requires exact Pack/host/key-prefix and known-evidence bindings, preserves canonical text on unsupported components, rejects cross-Pack identities and references, limits public handoffs to open/copy metadata, and keeps synthetic disclosures and uncertain/requested/committed/cancellation-requested states explicit. These boundaries are covered by [focused presentation tests](../../../../apps/kfc_live_monitor_flutter/test/features/customer_chat/presentation/business/) and new [multi-Business golden tests and images](../../../../apps/kfc_live_monitor_flutter/test/goldens/multibusiness_presentation/), including a shared KFC/PVCFC catalog and mobile evidence for all three PVCFC families.

The executable KFC enum currently contains 12 kinds. Earlier compatibility-baseline prose said 13, but no thirteenth kind exists in the current repository; this proof preserves all 12 without inventing another kind and delegates baseline reconciliation to [issue 08](./08-design-multibusiness-quality-contract-and-kfc-migration.md). Issue 08 retains responsibility for the complete executable multi-Business quality contract and oracle. [Issue 09](./09-assemble-implementation-ready-multibusiness-specification.md) retains production module extraction, runtime/backend migration, rollout, and final implementation-ready assembly; none of those production steps is claimed here.
