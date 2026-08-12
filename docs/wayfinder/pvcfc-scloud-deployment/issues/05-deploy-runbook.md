# SCloud ULightHost Deploy Runbook — PVCFC Chatbot Backend

## Question

Produce and verify the exact step-by-step commands to deploy and run the PVCFC chatbot backend on the SCloud ULightHost.

## Type

`wayfinder:task` (AFK)

## Status

RUNBOOK UPDATED — PACKAGED RELEASE NOT YET DEPLOYED

## Resolution

The original demo was verified on SCloud ULightHost on 2026-08-07 and the
existing release was cut over to AstraFlow Luna behind HTTPS on 2026-08-11.
The commands below are updated for the next packaged React/backend release;
this document does not claim that the packaged release is deployed until its
smoke tests are rerun.

- **Resource:** `ulhost-1tregne0qp7u`
- **Region:** VN(Ho Chi Minh City), Zone A
- **Plan:** 1 vCPU / 2 GB RAM / 40 GB system disk / 30 Mbps / 400 GB traffic
- **Cost:** `$7.22/month` prepaid monthly plan
- **Public IP:** `165.154.229.65`
- **Current HTTPS endpoint:** `https://pvcfc-chatbot.165-154-229-65.sslip.io/chat/pvcfc/message`
- **Current web app:** `https://pvcfc-ai-chatbot.pages.dev`
- **Image:** Ubuntu 22.04
- **Required next-release runtime:** Node.js `v24.14.0`, packaged backend plus React client, pm2
- **Firewall:** web-service recommendation bound: TCP 22, 80, 443; ICMP; TCP 3389
- **Process:** `pvcfc-backend`, online behind nginx on `127.0.0.1:18090`
- **Current PVCFC model:** AstraFlow `gpt-5.6-luna`

---

# Deploy Runbook: PVCFC Backend on SCloud ULightHost

> The backend declares Node.js 24. The ULightHost image's Ubuntu package provides an older Node.js, so install the pinned Node 24 binary explicitly.

## Step 1 — SSH into the host

Use the configured SSH key:

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@165.154.229.65
```

## Step 2 — Install Node.js 24 and Git

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git

curl -fsSL https://nodejs.org/dist/v24.14.0/node-v24.14.0-linux-x64.tar.xz -o /tmp/node.tar.xz
sudo mkdir -p /opt/node
sudo tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1
sudo ln -sf /opt/node/bin/node /usr/local/bin/node
sudo ln -sf /opt/node/bin/npm /usr/local/bin/npm
sudo ln -sf /opt/node/bin/npx /usr/local/bin/npx
node --version   # v24.14.0
npm --version
```

## Step 3 — Clone the repository

```bash
cd ~
git clone https://github.com/ThangVuNguyenViet/hackathon.git
cd ~/hackathon
npm ci --prefix apps/pvcfc_chat_web
npm ci --prefix services/kfc-agent-backend
cd ~/hackathon/services/kfc-agent-backend
```

## Step 4 — Build the compiled server

```bash
npm run build
```

This command cleans and compiles the backend, builds the already lockfile-installed `apps/pvcfc_chat_web`, and copies that generated output into the backend release. Dependency installation remains an explicit release step; after it completes, the build itself does not contact the package registry. Verify both packaged entrypoints:

```bash
test -s dist/src/index.js
test -s dist/client/index.html
grep -q '<div id="root"></div>' dist/client/index.html
```

The deployed server entrypoint is `dist/src/index.js`. The `/`, `/demo`, and `/pvcfc` routes serve `dist/client/index.html`; there is no standalone fallback UI.

Optional container build from the service-only context uses the same packaged release and does not copy the React source:

```bash
docker build -f Dockerfile.pvcfc -t pvcfc-backend:local .
```

## Step 5 — Write the secrets file

Create `/etc/pvcfc-backend.env` with the real key. Do not commit it or print it in logs:

```bash
sudo tee /etc/pvcfc-backend.env >/dev/null <<'EOF'
PVCFC_ASTRAFLOW_API_KEY=YOUR_REAL_ASTRAFLOW_KEY
PVCFC_ASTRAFLOW_BASE_URL=https://api-sg.umodelverse.ai/v1
PVCFC_ASTRAFLOW_MODEL=gpt-5.6-luna
PVCFC_PUBLIC_DATA_MODE=fixture
# Optional live official-site evidence; omit when fixture-only operation is intended.
TINYFISH_API_KEY=
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DATABASE
HOST=0.0.0.0
PORT=80
EOF
sudo chmod 600 /etc/pvcfc-backend.env
sudo chown root:root /etc/pvcfc-backend.env
```

## Step 6 — Allow Node.js to bind port 80

The service runs as root under pm2 so it can use the ULightHost web-service firewall's public port 80:

```bash
sudo setcap 'cap_net_bind_service=+ep' /opt/node/bin/node
```

## Step 7 — Install pm2 and start the compiled server

```bash
sudo /opt/node/bin/npm install -g pm2

sudo bash -c '
  set -a
  . /etc/pvcfc-backend.env
  set +a
  cd /home/ubuntu/hackathon/services/kfc-agent-backend
  PATH=/opt/node/bin:$PATH \
    /opt/node/bin/pm2 start dist/src/index.js \
      --name pvcfc-backend \
      --interpreter /opt/node/bin/node
'

sudo /opt/node/bin/pm2 status
sudo /opt/node/bin/pm2 logs pvcfc-backend --lines 20 --nostream
```

The expected startup log includes:

```json
{"level":30,"msg":"Server listening"}
```

## Step 8 — Persist pm2 across reboots

```bash
sudo /opt/node/bin/pm2 save
sudo /opt/node/bin/pm2 startup systemd -u root --hp /root
```

## Step 9 — Smoke test from the internet

Run from the local machine:

```bash
curl -i -X POST "https://pvcfc-chatbot.165-154-229-65.sslip.io/chat/pvcfc/message" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{
    "sessionId": "pvcfc:scloud_smoketest",
    "customerId": "scloud_smoketest",
    "clientMessageId": "msg_smoketest_001",
    "text": "Hãy giới thiệu dữ liệu PVCFC công khai và dẫn nguồn."
  }'
```

Expected:

- HTTP `200`
- `responseText` contains cited PVCFC public-data evidence
- no KFC mentions
- CORS headers include `access-control-allow-origin: *`

The existing pre-packaged deployment was verified again on 2026-08-11 after
the AstraFlow Luna and HTTPS cutover, including a function-call probe, an HTTP
200 grounded PVCFC response, persisted conversation/evidence state, and a
Cloudflare Pages proxy smoke test. Record a new date and release SHA here only
after redeploying this packaged build and rerunning the UI/API smoke checks.

## Migration path to UHost later

ULightHost is not resized in place into UHost. The low-risk migration is:

1. Provision the desired UHost.
2. Deploy the same compiled server and environment file.
3. Bind the existing EIP `165.154.229.126` to the UHost if a stable IP is required.
4. Smoke-test the UHost endpoint.
5. Update the client or DNS endpoint.
6. Stop and delete ULightHost after cutover.

The runtime now persists conversations and evidence in PostgreSQL. Migrate or repoint `DATABASE_URL` before cutover and verify the new host against the same durable data; do not treat the deployment as stateless.

## Open follow-ups

- Deploy the packaged React/backend release and record its release SHA and
  fresh UI/API smoke evidence.
- Decide whether to retain or release the currently unbound EIP `165.154.229.126`.
- Decide whether the current `sslip.io` hostname should be replaced by an
  owned stable domain.
