# Mock Commerce API Contract

The demo chatbot has one architecture: bundled fixtures behind mock commerce
clients. It has no production or gateway runtime mode.

The standalone sandbox proof gateway exercises the future adapter boundary. It
is not a claim about KFC Vietnam's private API shape and is not selectable by
the deployed chatbot. Its JSON `ToolResult<T>` contract covers:

- `POST /v1/orders/preview`
- `POST /v1/orders`
- `GET /v1/orders/:orderId`
- `POST /v1/orders/:orderId/cancel`
- `GET /v1/payment-methods`
- `POST /v1/orders/:orderId/payment-links`
- `GET /v1/orders/:orderId/payment-status`

OMS order placement in the proof gateway is coordinated with its mock POS API.
See [Mock POS Capability Proof](./mock-pos-proof.md).
