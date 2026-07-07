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

The app uses deterministic mock sessions by default. For the Messenger proof run, launch it with the backend URL:

```bash
flutter run -d chrome --dart-define=KFC_AGENT_BACKEND_URL=http://localhost:18090
```

The dashboard reads `/dashboard/sessions`, `/dashboard/sessions/:sessionId/turns`, and `/dashboard/events/:sessionId` from the KFC agent backend.
