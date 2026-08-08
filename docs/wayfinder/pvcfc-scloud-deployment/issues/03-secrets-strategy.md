# Decide secrets strategy on the VM

## Question

How will `OPENAI_API_KEY` (and any other secrets) be injected into the Node.js process on the SCloud VM?

## Type

`wayfinder:grilling` (HITL)

## Status

CLOSED ✅

## Resolution

- **Only secret needed:** `OPENAI_API_KEY` (stateless PVCFC persona, no DB)
- **Strategy:** Write to `/etc/pvcfc-backend.env` on the VM:
  ```
  OPENAI_API_KEY=sk-...
  ```
  File is owned root, mode 600. Referenced by the process supervisor.
- Shell history never sees the key value (write the file with `$EDITOR` or `tee`)
