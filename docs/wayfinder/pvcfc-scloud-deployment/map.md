# PVCFC Chatbot Deployment on SCloud

## Destination

`POST /chat/pvcfc/message` responds correctly from a public SCloud ULightHost running the packaged kfc-agent-backend Node.js server, reachable from the internet, with the PVCFC AstraFlow credential wired and the PVCFC agricultural persona working end-to-end.

## Notes

- Runtime: packaged Node.js (`dist/src/index.js` plus `dist/client`) supervised by pm2; the service-only Dockerfile is an optional reproducibility path
- Platform: SCloud ULightHost (`ulhost-1tregne0qp7u`), VN(Ho Chi Minh City), 1 vCPU / 2 GB RAM, 40 GB disk, 30 Mbps peak, 400 GB traffic, monthly $7.22
- Current backend origin: `https://pvcfc-chatbot.165-154-229-65.sslip.io`
- Current web app: `https://pvcfc-ai-chatbot.pages.dev`
- Existing live process: `/home/ubuntu/pvcfc-backend-current/dist/src/index.js`, supervised by root pm2 behind nginx on `127.0.0.1:18090`
- Existing EIP `165.154.229.126` remains unbound and is not needed by ULightHost; do not release it until the migration decision is explicit
- AstraFlow uses the configured Modelverse-compatible endpoint and PVCFC-owned credential; the backend never reuses a KFC provider key
- The current acceptance endpoint uses HTTPS on `sslip.io`; an owned stable
  domain remains a later decision
- Consult `services/kfc-agent-backend/`, `apps/pvcfc_chat_web/`, and the packaged-release runbook
- Consult `CONTEXT.md` for domain language

## Decisions so far
- [Decide UHost sizing and security rules](issues/02-vm-specs-and-security-rules.md) — superseded for the demo by ULightHost 1vCPU/2GB with web-service firewall (22,3389,80,443)
- [Decide secrets strategy on the VM](issues/03-secrets-strategy.md) — `/etc/pvcfc-backend.env`, mode 600
- [Decide process supervision strategy](issues/04-process-supervision-strategy.md) — pm2 root service with saved process list
- [Produce the SCloud deploy runbook](issues/05-deploy-runbook.md) — updated for the live ULightHost deployment

## Current status

- ✅ ULightHost provisioned and running: `ulhost-1tregne0qp7u`
- ✅ AstraFlow `gpt-5.6-luna` basic and function-call probes passed on 2026-08-11
- ✅ Backend smoke test passed over HTTPS from `https://pvcfc-chatbot.165-154-229-65.sslip.io/chat/pvcfc/message`
- ✅ Response contained PVCFC agricultural guidance with no KFC mentions
- ✅ pm2 process `pvcfc-backend` online behind nginx on `127.0.0.1:18090`
- ✅ Firewall bound: TCP 80/443 plus SSH 22 and RDP 3389
- ✅ PVCFC uses its dedicated model credential and trusted business-pack route, with no KFC fallback
- ✅ 497-record public-data provider, persisted conversation state, and redacted evidence trace verified
- ✅ Cloudflare Pages proxy smoke passed with no KFC content
- The packaged AstraFlow release still requires a new credentialed deployment smoke test
- Owned stable domain decision remains open; the current HTTPS `sslip.io` endpoint is the acceptance origin
- ✅ Process supervision: pm2 (decided in issue 04)
- ✅ Secrets: `/etc/pvcfc-backend.env` (decided in issue 03)
- PostgreSQL migration or repointing for durable PVCFC conversation and evidence state

## Out of scope

- Cloudflare Workers / wrangler publish deployment (user chose Node.js on VM)
- AstraFlow model registration / Modelverse publishing (only the endpoint is needed)
- KFC endpoint migration to SCloud (separate effort)
