# Decide process supervision strategy

## Question

How should `serve-demo-agent-server.ts` be kept running after the SSH session ends?

## Type

`wayfinder:grilling` (HITL)

## Status

CLOSED ✅

## Resolution

- **Supervisor:** pm2
- Commands: `npm install -g pm2`, then launch with `--env-file /etc/pvcfc-backend.env`
- `pm2 startup` + `pm2 save` to survive reboots
