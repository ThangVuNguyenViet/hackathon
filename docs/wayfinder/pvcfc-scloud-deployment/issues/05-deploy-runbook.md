# SCloud ULightHost Deploy Runbook — PVCFC Chatbot Backend

## Question

Produce and verify the exact step-by-step commands to deploy and run the PVCFC chatbot backend on the SCloud ULightHost.

## Type

`wayfinder:task` (AFK)

## Status

CLOSED ✅

## Resolution

The demo is live on SCloud ULightHost.

- **Resource:** `ulhost-1tregne0qp7u`
- **Region:** VN(Ho Chi Minh City), Zone A
- **Plan:** 1 vCPU / 2 GB RAM / 40 GB system disk / 30 Mbps / 400 GB traffic
- **Cost:** `$7.22/month` prepaid monthly plan
- **Public IP:** `165.154.229.65`
- **Endpoint:** `http://165.154.229.65/chat/pvcfc/message`
- **Image:** Ubuntu 22.04
- **Runtime:** Node.js `v22.13.0`, compiled JavaScript, pm2
- **Firewall:** web-service recommendation bound: TCP 22, 80, 443; ICMP; TCP 3389
- **Process:** `pvcfc-backend`, online, listening on `0.0.0.0:80`

---

# Deploy Runbook: PVCFC Backend on SCloud ULightHost

> The repository declares Node.js `>=22.13.0`. The ULightHost image's Ubuntu package provides an older Node.js, so install the Node 22 binary explicitly.

## Step 1 — SSH into the host

Use the configured SSH key:

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@165.154.229.65
```

## Step 2 — Install Node.js 22 and Git

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git

curl -fsSL https://nodejs.org/dist/v22.13.0/node-v22.13.0-linux-x64.tar.xz -o /tmp/node.tar.xz
sudo mkdir -p /opt/node
sudo tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1
sudo ln -sf /opt/node/bin/node /usr/local/bin/node
sudo ln -sf /opt/node/bin/npm /usr/local/bin/npm
sudo ln -sf /opt/node/bin/npx /usr/local/bin/npx
node --version   # v22.13.0
npm --version
```

## Step 3 — Clone the repository

```bash
cd ~
git clone https://github.com/ThangVuNguyenViet/hackathon.git
cd ~/hackathon/services/kfc-agent-backend
npm install
```

## Step 4 — Build the compiled server

```bash
npm run build
```

The deployed entrypoint is:

```text
dist/scripts/serve-demo-agent-server.js
```

## Step 5 — Write the secrets file

Create `/etc/pvcfc-backend.env` with the real key. Do not commit it or print it in logs:

```bash
sudo tee /etc/pvcfc-backend.env >/dev/null <<'EOF'
OPENAI_API_KEY=sk-YOUR_REAL_KEY_HERE
HOST=0.0.0.0
PORT=80
KFC_AGENT_MODEL=gpt-4.1-mini
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
    /opt/node/bin/pm2 start dist/scripts/serve-demo-agent-server.js \
      --name pvcfc-backend \
      --interpreter /opt/node/bin/node
'

sudo /opt/node/bin/pm2 status
sudo /opt/node/bin/pm2 logs pvcfc-backend --lines 20 --nostream
```

The expected startup log includes:

```json
{"ok":true,"port":80,"hasOpenAiKey":true}
```

## Step 8 — Persist pm2 across reboots

```bash
sudo /opt/node/bin/pm2 save
sudo /opt/node/bin/pm2 startup systemd -u root --hp /root
```

## Step 9 — Smoke test from the internet

Run from the local machine:

```bash
curl -i -X POST "http://165.154.229.65/chat/pvcfc/message" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{
    "sessionId": "pvcfc:scloud_smoketest",
    "customerId": "scloud_smoketest",
    "clientMessageId": "msg_smoketest_001",
    "text": "bạn làm được gì?",
    "metadata": { "responseProfile": "genui" }
  }'
```

Expected:

- HTTP `200`
- `responseText` contains PVCFC agricultural guidance
- no KFC mentions
- CORS headers include `access-control-allow-origin: *`

Verified on 2026-08-07: HTTP 200, PVCFC response, no KFC mentions.

## Migration path to UHost later

ULightHost is not resized in place into UHost. The low-risk migration is:

1. Provision the desired UHost.
2. Deploy the same compiled server and environment file.
3. Bind the existing EIP `165.154.229.126` to the UHost if a stable IP is required.
4. Smoke-test the UHost endpoint.
5. Update the client or DNS endpoint.
6. Stop and delete ULightHost after cutover.

The current demo is stateless, so this migration does not require database transfer.

## Open follow-ups

- Add HTTPS/TLS before using the endpoint from an HTTPS-only client.
- Decide whether to retain or release the currently unbound EIP `165.154.229.126`.
- Choose a stable domain/subdomain before sharing the endpoint broadly.
