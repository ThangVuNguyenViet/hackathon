# Free And Open-Source Kiosk Shell Options

Research snapshot: 2026-07-28. Sources are limited to official documentation, official source repositories, and license files.

## Decision

Use the **existing Flutter client in Chromium kiosk mode as the MVP kiosk-shaped application**. Build its static web assets, serve them locally or on the demo LAN, and launch that trusted URL with Chromium's `--kiosk` switch. This is the smallest credible stakeholder-demo shell because it reuses the checkout's UI, API client patterns, and tests.

- for a supervised demo, Flutter web full-page mode plus Chromium `--kiosk` is presentation, not device lockdown;
- if dedicated Android hardware must prevent users leaving the app, use the maintained [`kiosk_mode`](https://pub.dev/packages/kiosk_mode) Flutter plugin only after the device-management approach is known; it delegates to official Android lock task or screen pinning rather than inventing a custom containment protocol;
- call the external recommendation API through a typed client and keep a local API/fixture adapter for repeatable demonstrations;
- do not add Electron, Tauri, Ubuntu Frame, or a full POS platform to the MVP merely to obtain full-screen presentation.

This is a stakeholder-demonstration choice, not a claim of production KFC kiosk, POS, OMS, payment-terminal, device-management, or hardware compatibility. The parent [Wayfinder map](https://github.com/ThangVuNguyenViet/hackathon/issues/93) explicitly says those private contracts are unavailable.

Chromium's own source defines `--kiosk` as enabling kiosk mode and warns that it is **not ChromeOS kiosk mode** ([official switch source](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/common/chrome_switches.cc#428)). It should therefore be treated as a full-screen demo launcher, not escape-resistant management.

## Why This Fits The Checkout

The checkout already has more reusable customer-ordering UI and proof infrastructure in Flutter than any external shell would provide:

- the package already targets `web`, `android`, `ios`, and `macos`, and documents local Chrome execution plus a web build pointed at `KFC_AGENT_BACKEND_URL` ([app README](../../../../apps/kfc_live_monitor_flutter/README.md#live-backend-mode));
- reusable widgets already include a [menu picker](../../../../apps/kfc_live_monitor_flutter/lib/features/customer_chat/presentation/genui/widgets/smart_menu_picker.dart), [product detail card](../../../../apps/kfc_live_monitor_flutter/lib/features/customer_chat/presentation/genui/widgets/product_detail_card.dart), [modifier picker](../../../../apps/kfc_live_monitor_flutter/lib/features/customer_chat/presentation/genui/widgets/modifier_picker.dart), and [cart builder](../../../../apps/kfc_live_monitor_flutter/lib/features/customer_chat/presentation/genui/widgets/cart_builder.dart);
- the package already declares Flutter widget and integration-test support ([`pubspec.yaml`](../../../../apps/kfc_live_monitor_flutter/pubspec.yaml)), and the checkout contains component golden tests and backend-backed integration tests.

These widgets need a touch-first kiosk composition rather than reuse of the chat screen itself: a large product/recommendation region, persistent cart summary, prominent quantity/modifier controls, and a bounded reset/start-over action. That is presentation work inside the current toolkit, not a reason to introduce a second runtime.

Flutter's official large-screen guidance recommends sizing from the available window, using responsive grids and bounded widths rather than device-name checks. Its Material widgets already support additional input states, while custom controls must deliberately handle input and accessibility ([large-screen guidance](https://docs.flutter.dev/ui/adaptive-responsive/large-screens), [input and accessibility](https://docs.flutter.dev/ui/adaptive-responsive/input)). Flutter web's default full-page mode owns the whole browser viewport, and Flutter also produces native Windows, macOS, and Linux applications ([web full-page mode](https://docs.flutter.dev/platform-integration/web/embedding-flutter-web), [desktop support](https://docs.flutter.dev/platform-integration/desktop)).

## Comparison

| Option | Large-screen touch UX | Product/cart UI reuse | Deployment and local/offline demo | Testing | License and maintenance signal | Custom-work burden | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Existing Flutter web + Chromium `--kiosk`** | Strong toolkit support; kiosk layout still must be composed and touch-tested. Chromium supplies full-screen presentation, not locked-device policy. | **Highest**: directly reuses the checkout's product, modifier, menu, cart, media, and golden-test code | Static Flutter assets can be served locally; recommendation results still require the external API or a local/fixture adapter. The current web build explicitly disables generated PWA behavior, so no browser-offline claim is made. | Reuses existing widget, golden, and browser integration tests | Flutter is BSD-3-Clause; current official documentation and source are actively maintained ([Flutter license/source](https://github.com/flutter/flutter), [Chromium switch source](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/common/chrome_switches.cc#428)) | **Low** | **Selected** |
| Existing Flutter Android/iOS + Mews `kiosk_mode` | Uses Android lock task/screen pinning and observes iOS Guided Access; supplies no ordering UI | Highest Flutter UI reuse | Native UI assets are local. Real Android containment still needs device-policy allowlisting; without it, the plugin starts user-exitable screen pinning. API availability remains separate. | Reuses Flutter tests, but native containment needs real-device proof | BSD-3-Clause; v0.8.0+1 was published in June 2026 by Mews ([package and behavior](https://pub.dev/packages/kiosk_mode), [source](https://github.com/MewsSystems/mews-flutter/tree/main/kiosk_mode), [license](https://pub.dev/packages/kiosk_mode/license)) | Low UI work; medium device-provisioning work | Optional only when containment is required |
| Electron wrapping a Flutter web build | Explicit `BrowserWindow` kiosk/full-screen controls; touch quality still comes from the Flutter page | High UI reuse if it only wraps the Flutter bundle, but no new product/cart capability | Can load packaged local HTML and create OS distributables; adds Electron/Chromium/Node packaging and update work. API still must be reachable locally or remotely. | Official guidance supports WebdriverIO, Selenium, or experimental Playwright Electron testing, creating a second end-to-end layer | MIT; current v43 releases and active source ([license/source](https://github.com/electron/electron), [releases](https://github.com/electron/electron/releases)) | Medium | Rejected |
| Tauri wrapping a Flutter web build | Configurable full-screen native webview; touch quality still comes from the Flutter page | High UI reuse if it wraps the Flutter bundle, but no product/cart kit | Bundles local frontend assets into native installers and uses the OS webview; adds Rust, Tauri configuration, per-platform webview behavior, and a new build pipeline | Official WebdriverIO integration covers Windows, Linux, and macOS, but it is separate from existing Flutter tests | MIT or Apache-2.0; current v2 releases and active source ([license/source](https://github.com/tauri-apps/tauri), [releases](https://github.com/tauri-apps/tauri/releases)) | Medium-high in this Dart/Flutter checkout | Rejected |
| Ubuntu Frame hosting a Flutter Linux build | **Strongest dedicated Linux kiosk shell**: full-screen window, touch/keyboard/mouse input, optional on-screen keyboard | Reuses Flutter UI, but supplies no product/cart components | Good local/appliance behavior using confined snaps and Ubuntu Core/Classic; requires adding a Linux target here, snap packaging, Frame provisioning, and hardware validation | Flutter tests remain useful, plus new snap, compositor, boot, touchscreen, and target-hardware checks | GPL-3.0; Canonical maintains the official source and current Frame/Mir documentation ([license/source](https://github.com/canonical/ubuntu-frame), [current guide](https://canonical.com/mir/docs/packaging-a-gtk3-application-as-an-iot-gui)) | High for the MVP; potentially appropriate for a later Linux appliance | Rejected for MVP |
| Odoo Community POS Self Order | Purpose-built browser/touch kiosk with catalog, order, payment, splash, language, and service-mode flows | High generic POS UI reuse, but **no reuse of the checkout's Flutter UI** | Browser-based and documented to tolerate temporary network loss; requires an Odoo server/database and an open POS session. External recommendation results still need a custom integration and offline policy. | The official community source contains unit/tour test assets, but adopting it establishes an additional Python/Owl/Odoo test stack | `pos_self_order` is LGPL-3 in the official Odoo 19.0 community source ([module manifest](https://github.com/odoo/odoo/blob/19.0/addons/pos_self_order/__manifest__.py), [repository license](https://github.com/odoo/odoo/blob/19.0/LICENSE)) | **Very high** because Odoo's catalog/order authority must be reconciled with the provider-neutral recommendation and cart contracts | Rejected |

## Selected MVP Shape

### Presentation

Build one kiosk-specific Flutter route or entrypoint inside the current package. It should reuse the existing domain widgets but not inherit conversational chat chrome. The minimum credible touch layout is:

1. category/product browsing and the active recommendation placement in the primary area;
2. a persistent cart rail or bottom panel with total quantity and amount;
3. large touch targets for product selection, quantity, modifiers, accept/dismiss recommendation, and start over;
4. visible loading, unavailable, retry, and empty states driven by typed API state;
5. a deterministic inactivity reset for demo hygiene, with its duration chosen during prototype testing rather than assumed here.

The recommendation API remains external and channel-neutral. The Flutter client sends typed placement, store/catalog, cart, and order context; it renders the returned decision; and it owns verified cart mutations. No semantic routing or recommendation ranking belongs in the kiosk shell.

### Demo deployment

Use two supported modes:

- **Fastest supervised demo:** build or run Flutter web, point `KFC_AGENT_BACKEND_URL` (or the recommendation-client equivalent introduced by implementation) at the local/LAN API, and launch its trusted URL in Chromium with `--kiosk`.
- **Dedicated touch device:** build the same Flutter client for Android. Plain immersive/full-screen presentation is enough for supervised use. If the stakeholder demo specifically requires device containment, add the maintained `kiosk_mode` plugin and provision the device for Android lock task.

Android distinguishes ordinary screen pinning from managed lock task. A device-policy controller must allowlist an app for full lock task; lock task hides Home/Overview and restricts other apps, while UI features can be selectively enabled ([Android lock-task documentation](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode)). The `kiosk_mode` package follows the same boundary: it enters lock task only when permitted and otherwise starts screen pinning, which the user can exit ([package behavior](https://pub.dev/packages/kiosk_mode)). This is a device-management decision, not a UI-framework feature, and should not be claimed until the demo hardware and provisioning method are verified.

For a disconnected venue, package UI assets locally and run the recommendation API on the same device or trusted LAN. A fixture adapter may keep the presentation rehearsable, but a fixture-only run is not evidence that the external recommendation API works. None of the compared shells can manufacture live recommendation results without an available API or a previously defined cache.

### Verification

Retain the current Flutter testing investment:

- widget tests for layout breakpoints, touch targets, cart mutations, API state, reset, and error recovery;
- golden tests at the actual target aspect ratio and text scale;
- integration tests that tap through browse, recommendation, modifier, cart, and reset flows against a controlled local API;
- a real-device smoke run for touch, virtual keyboard, display scaling, network loss, restart, and Android lock task if lock task is enabled.

Flutter's official integration framework can exercise complete apps on physical devices, emulators, browsers, and desktop, but it cannot interact with native platform UI such as permission dialogs ([official integration-test guide](https://docs.flutter.dev/testing/integration-tests), [testing overview](https://docs.flutter.dev/testing/overview)). Therefore Android containment needs separate device-level proof; passing Flutter widget tests is not proof of kiosk lockdown.

## Why The Other Options Are Rejected

### Electron

Electron directly exposes kiosk mode and can load a local HTML file ([`BrowserWindow` kiosk and local-file APIs](https://www.electronjs.org/docs/latest/api/browser-window/)). It also has established packaging through Electron Forge ([packaging guide](https://www.electronjs.org/docs/latest/tutorial/application-distribution)) and official test guidance ([automated testing](https://www.electronjs.org/docs/latest/tutorial/automated-testing)).

It is rejected because wrapping the existing Flutter web build adds a Chromium/Node application, packaging, security-update cadence, and a second test harness without adding a product, cart, or recommendation component. Rebuilding the UI in HTML would discard more existing work. Electron's own security guidance also makes the wrapper responsible for current framework versions, sandboxing, context isolation, navigation limits, and secure remote content ([security checklist](https://www.electronjs.org/docs/latest/tutorial/security)).

### Tauri

Tauri can point at packaged frontend assets, start full-screen, and produce native bundles through configuration ([configuration reference](https://v2.tauri.app/reference/config/)). It is a credible generic desktop wrapper, and official WebDriver guidance now covers the major desktop platforms ([WebDriver testing](https://v2.tauri.app/develop/tests/webdriver/)).

It is rejected because the checkout has no Rust/Tauri runtime and Tauri contributes no touch ordering UI. A Tauri wrapper would move Flutter web into an OS webview while creating another build, permission, platform-webview, and testing boundary. Its smaller generic shell does not offset that custom work for this repository.

### Ubuntu Frame

Ubuntu Frame is the strongest option in this list when the requirement is a managed Linux kiosk appliance. Canonical defines it as a full-screen shell for kiosks/POS, documents touch and on-screen keyboard support, provides confined snap deployment, and explicitly supports packaging Flutter applications ([secure web-kiosk architecture](https://canonical.com/mir/docs/make-a-secure-ubuntu-web-kiosk), [packaging guides](https://canonical.com/mir/docs/how-to-guides), [on-screen keyboard](https://canonical.com/mir/docs/stable/configuring/how-to/use-on-screen-keyboards/)).

It is rejected for this MVP because the current Flutter app has no Linux target and the ticket asks for the least custom work for a stakeholder demonstration. Adding Linux, Snapcraft, Ubuntu Frame, boot/provisioning behavior, and target hardware would solve appliance operations before the kiosk UI/API contract is validated. Keep it as the preferred follow-up candidate only if a Linux appliance becomes an explicit requirement.

### Odoo Community POS Self Order

Odoo 19.0 already provides the most complete generic self-order UI considered: customers can browse the catalog, order, and pay from a kiosk; it includes splash screens, languages, service modes, and touchscreen/IoT Box launch ([self-order documentation](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/self_order.html)). Odoo POS is browser-based and designed to keep functioning through temporary network outages ([POS overview](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale.html)). Its community `pos_self_order` source also includes product cards, order display/lines, tests, and demo kiosk data ([official source](https://github.com/odoo/odoo/tree/19.0/addons/pos_self_order)).

It is rejected because those strengths come from adopting Odoo's POS server, database, catalog, order, preparation, and payment model. The MVP instead needs a thin provider-neutral client for an external recommendation engine, with verified cart mutation owned by that client and no production POS/OMS claim. Integrating decisions into Odoo without creating competing catalog/order authorities is materially more work and risk than composing the existing Flutter widgets.

## Boundaries And Follow-Up Triggers

- Do not call the selected client a production kiosk integration. It is a kiosk-shaped MVP client.
- Do not simulate private KFC kiosk, POS, OMS, payment, device-management, or peripheral contracts.
- Do not treat full-screen presentation as tamper-resistant containment.
- Do not claim offline recommendation behavior unless a local API or an explicit, tested cache/fixture mode is active.
- Revisit Ubuntu Frame only if Linux appliance provisioning, unattended boot, snap updates, or a specific Linux touchscreen becomes a requirement.
- Revisit Android lock task only after ownership/provisioning of the demo device is confirmed.
- Revisit Odoo only if the product decision changes from a provider-neutral kiosk client to adopting Odoo as the actual POS/order authority.
