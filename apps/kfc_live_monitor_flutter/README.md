# kfc_live_monitor

A new Flutter project.

## Getting Started

This project is a starting point for a Flutter application.

A few resources to get you started if this is your first Flutter project:

- [Learn Flutter](https://docs.flutter.dev/get-started/learn-flutter)
- [Write your first Flutter app](https://docs.flutter.dev/get-started/codelab)
- [Flutter learning resources](https://docs.flutter.dev/reference/learning-resources)

For help getting started with Flutter development, view the
[online documentation](https://docs.flutter.dev/), which offers tutorials,
samples, guidance on mobile development, and a full API reference.
# Live Backend Mode

The app expects an explicit data source. For a live backend proof run, launch it
with the backend URL:

```bash
flutter run -d chrome --dart-define=KFC_AGENT_BACKEND_URL=http://127.0.0.1:18090
```

For a local web build served by a static file server, disable Flutter's PWA
service worker so the browser does not keep an older bundle:

```bash
flutter build web --dart-define=KFC_AGENT_BACKEND_URL=http://127.0.0.1:18090 --pwa-strategy=none
```

For Cloudflare Pages, prefer same-origin backend mode:

```bash
KFC_AGENT_BACKEND_URL=/ \
../../scripts/deploy-dashboard-cloudflare-pages.sh
```

Pages forwards `/ready` and `/dashboard/*` to the Worker via `web/_worker.js`.
The dashboard reads `/dashboard/sessions`, `/dashboard/sessions/:sessionId/turns`, and `/dashboard/events/:sessionId` from the KFC agent backend.

## Channel Parity Proof

The live monitor must verify these behaviors for both Messenger and Zalo:

- live text intake appears without app restart through Worker-backed polling;
- per-user history hydrates from `/dashboard/sessions/:sessionId/turns`;
- customer display name is primary and chat ID is secondary/debug context;
- open-chat action uses a verified platform deeplink or shows an unavailable state.
