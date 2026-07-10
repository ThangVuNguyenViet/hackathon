# KFC Commerce Gateway

The first-party KFC chat supports two commerce modes:

- `fixture`: local development and visual proof. `/ready` reports `production: false`.
- `gateway`: authenticated OMS and payment requests. `/ready` fails unless the base URL and token are configured.

```dotenv
KFC_COMMERCE_MODE=gateway
KFC_COMMERCE_GATEWAY_BASE_URL=https://commerce-gateway.internal
KFC_COMMERCE_GATEWAY_TOKEN=...
```

The gateway is an internal adapter contract, not a claim about KFC Vietnam's private API shape. The configured service must expose JSON `ToolResult<T>` responses on:

- `POST /v1/orders/preview`
- `POST /v1/orders`
- `GET /v1/orders/:orderId`
- `POST /v1/orders/:orderId/cancel`
- `GET /v1/payment-methods`
- `POST /v1/orders/:orderId/payment-links`
- `GET /v1/orders/:orderId/payment-status`

Run staging acceptance only against a non-production environment:

```bash
KFC_STAGING_ACCEPTANCE=1 KFC_STAGING_URL=https://staging.example npx tsx scripts/verify-kfc-staging.ts
```

The verifier creates a conversation and checks stable identity reuse, message idempotency, dashboard visibility, disabled KFC deeplinks, and disabled KFC human join.
