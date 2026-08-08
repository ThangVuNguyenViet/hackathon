# PVCFC Chatbot Deployment on SCloud

## Destination

`POST /chat/pvcfc/message` responds correctly from a public SCloud ULightHost running the compiled kfc-agent-backend Node.js server, reachable from the internet, with OpenAI API key wired, and the PVCFC agricultural persona working end-to-end.

## Notes

- Runtime: compiled Node.js (`dist/scripts/serve-demo-agent-server.js`) supervised by pm2, **not** Docker, **not** CF Workers
- Platform: SCloud ULightHost (`ulhost-1tregne0qp7u`), VN(Ho Chi Minh City), 1 vCPU / 2 GB RAM, 40 GB disk, 30 Mbps peak, 400 GB traffic, monthly $7.22
- Public endpoint: `http://165.154.229.65/chat/pvcfc/message` (ULightHost public IP; port 80)
- Existing EIP `165.154.229.126` remains unbound and is not needed by ULightHost; do not release it until the migration decision is explicit
- AstraFlow (`astraflow.scloudsg.com`) — `umodel-1783649298` does not exist on this account; AstraFlow integration is deferred (no dependency on VM)
- Domain/URL strategy: not yet decided (raw IP vs subdomain)
- Consult `services/kfc-agent-backend/` and `services/kfc-agent-backend/scripts/serve-demo-agent-server.ts`
- Consult `CONTEXT.md` for domain language

## Decisions so far
- [Decide UHost sizing and security rules](issues/02-vm-specs-and-security-rules.md) — superseded for the demo by ULightHost 1vCPU/2GB with web-service firewall (22,3389,80,443)
- [Decide secrets strategy on the VM](issues/03-secrets-strategy.md) — `/etc/pvcfc-backend.env`, mode 600
- [Decide process supervision strategy](issues/04-process-supervision-strategy.md) — pm2 root service with saved process list
- [Produce the SCloud deploy runbook](issues/05-deploy-runbook.md) — updated for the live ULightHost deployment

## Current status

- ✅ ULightHost provisioned and running: `ulhost-1tregne0qp7u`
- ✅ Backend smoke test passed: HTTP 200 from `http://165.154.229.65/chat/pvcfc/message`
- ✅ Response contained PVCFC agricultural guidance with no KFC mentions
- ✅ pm2 process `pvcfc-backend` online and listening on `0.0.0.0:80`
- ✅ Firewall bound: TCP 80/443 plus SSH 22 and RDP 3389
- ✅ `umodel-1783649298` does not exist — AstraFlow integration not needed for initial deploy
- Domain/subdomain vs raw IP decision (cost: none now, needed before sharing a stable URL with anyone)
- HTTPS / TLS termination — needed before AstraFlow makes HTTPS-only outbound calls to the backend
- ✅ Process supervision: pm2 (decided in issue 04)
- ✅ Secrets: `/etc/pvcfc-backend.env` (decided in issue 03)
- Whether Postgres/D1 is needed for the PVCFC persona or if stateless mode suffices for the demo

## Out of scope

- Cloudflare Workers / wrangler publish deployment (user chose Node.js on VM)
- AstraFlow model registration / Modelverse publishing (only the endpoint is needed)
- KFC endpoint migration to SCloud (separate effort)
