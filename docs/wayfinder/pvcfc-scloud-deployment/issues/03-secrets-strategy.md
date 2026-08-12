# Decide secrets strategy on the VM

## Question

How will `OPENAI_API_KEY` (and any other secrets) be injected into the Node.js process on the SCloud VM?

## Type

`wayfinder:grilling` (HITL)

## Status

CLOSED ✅

## Resolution

- **PVCFC model secret:** `PVCFC_ASTRAFLOW_API_KEY`. It is isolated from KFC's
  separately selected model-provider credentials.
- **Strategy:** Write to `/etc/pvcfc-backend.env` on the VM:
  ```
  PVCFC_ASTRAFLOW_API_KEY=...
  PVCFC_ASTRAFLOW_BASE_URL=https://api-sg.umodelverse.ai/v1
  PVCFC_ASTRAFLOW_MODEL=gpt-5.6-luna
  ```
  File is owned root, mode 600. Referenced by the process supervisor.
- Shell history never sees the key value (write the file with `$EDITOR` or `tee`)
