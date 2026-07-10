# Mock POS Capability Proof

This proof demonstrates the integration architecture for an OMS and POS when vendor API documentation is unavailable. It does not claim compatibility with a particular production POS.

## Contract

The POS adapter uses:

- `POST /v1/tickets` with `Idempotency-Key`
- `GET /v1/tickets/:ticketId`
- `POST /v1/tickets/:ticketId/cancel`
- `GET /health`

The mock-only admin route `POST /__admin/tickets/:ticketId/status` drives preparation states during component proof.

## Behavior Proven

- A confirmed OMS order creates a correlated POS ticket.
- Replaying the same preview does not create another OMS order or POS ticket.
- POS preparation status is projected onto the correlated order.
- POS rejection is surfaced to the caller.
- An OMS order created before POS rejection is cancelled as compensation.

Run the automated component proof:

```bash
cd services/kfc-agent-backend
npm test -- --run test/commerce/pos-capability.test.ts
npx tsx scripts/run-mock-pos-proof.ts
```

Run the mock POS as a standalone service:

```bash
MOCK_POS_PORT=18110 MOCK_POS_TOKEN=local-token npx tsx scripts/start-mock-pos.ts
```

Connect the backend in gateway and POS mode:

```dotenv
KFC_COMMERCE_MODE=gateway
KFC_COMMERCE_GATEWAY_BASE_URL=https://mock-or-real-oms-gateway.example
KFC_COMMERCE_GATEWAY_TOKEN=...
KFC_POS_MODE=http
KFC_POS_BASE_URL=http://127.0.0.1:18110
KFC_POS_TOKEN=local-token
```
