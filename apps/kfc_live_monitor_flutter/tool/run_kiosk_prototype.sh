#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
exec flutter run \
  -d web-server \
  --web-hostname 127.0.0.1 \
  --web-port "${KFC_KIOSK_PROTOTYPE_PORT:-8512}" \
  -t lib/main_kiosk_prototype.dart
