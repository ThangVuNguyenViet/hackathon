# KFC Chat Response Mode Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a customer-visible toggle that selects text-only or Generative UI responses for subsequent messages while preserving one conversation.

**Architecture:** Store a small `CustomerChatResponseMode` value in `CustomerChatState`, let `CustomerChatController` change it only while idle, and serialize the existing `showcaseResponseMode` metadata on every text run. Render a header segmented control; do not add endpoints, agent paths, or persistence.

**Tech Stack:** Flutter, State Beacon, shadcn_ui, flutter_test, existing KFC customer-run HTTP contract.

## Global Constraints

- Default mode is `Generative UI`.
- Mode changes keep the same session and transcript.
- Existing widgets remain visible after switching to text-only.
- Disable switching while a request or confirmation is in progress.
- Reuse `showcaseResponseMode`; add no backend orchestration.

---

### Task 1: Mode state and request metadata

**Files:**
- Modify: `apps/kfc_live_monitor_flutter/lib/features/customer_chat/application/customer_chat_state.dart`
- Modify: `apps/kfc_live_monitor_flutter/lib/features/customer_chat/application/customer_chat_controller.dart`
- Test: `apps/kfc_live_monitor_flutter/test/features/customer_chat/application/customer_chat_controller_test.dart`

**Interfaces:**
- Produces: `enum CustomerChatResponseMode { genui, text }`, `CustomerChatState.responseMode`, and `CustomerChatController.setResponseMode(CustomerChatResponseMode mode)`.
- Sends: `metadata: {'showcaseResponseMode': state.responseMode.name}` for text runs.

- [ ] Add controller tests that record `startRun` metadata, verify `genui` by default, verify `text` after switching, and verify switching is ignored while sending.
- [ ] Run the focused controller test and confirm the new assertions fail because mode state is absent.
- [ ] Add the enum, immutable state field/copy support, controller setter, and text-run metadata.
- [ ] Run the focused controller test and confirm it passes.

### Task 2: Header segmented control

**Files:**
- Modify: `apps/kfc_live_monitor_flutter/lib/features/customer_chat/testing/customer_chat_keys.dart`
- Modify: `apps/kfc_live_monitor_flutter/lib/features/customer_chat/presentation/customer_chat_screen.dart`
- Test: `apps/kfc_live_monitor_flutter/test/features/customer_chat/presentation/customer_chat_screen_test.dart`

**Interfaces:**
- Consumes: `CustomerChatState.responseMode` and `CustomerChatController.setResponseMode`.
- Produces: stable keys `responseModeControl`, `responseModeGenUi`, and `responseModeText`.

- [ ] Add a widget test that finds both options, taps `Text only`, and observes `CustomerChatResponseMode.text`.
- [ ] Add a widget test that proves both options are disabled while `state.isSending` is true.
- [ ] Run the focused screen test and confirm the new controls are absent.
- [ ] Pass mode state and callbacks into `_CustomerChatHeader` and render two compact mutually exclusive header buttons with selected styling.
- [ ] Run the focused screen test and confirm it passes.

### Task 3: Verification and local launch

**Files:**
- No new production files.

**Interfaces:**
- Consumes the completed controller and header behavior.
- Produces a local customer app connected to the local direct Responses backend.

- [ ] Run `flutter test` and `flutter analyze` in `apps/kfc_live_monitor_flutter`.
- [ ] Run focused direct-agent, GenUI-action, and Messenger compatibility tests plus backend typecheck/build.
- [ ] Start the backend with the repository `.env` and fixture commerce on a local port.
- [ ] Start Flutter web with `-t lib/main_customer.dart` and the local backend URL.
- [ ] Open the app for the user and manually verify both response modes in one session.
