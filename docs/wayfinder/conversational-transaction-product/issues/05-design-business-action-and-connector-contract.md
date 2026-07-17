Status: open
Type: prototype
Labels: wayfinder:prototype
Parent: ../map.md
Blocked by: 03-define-conversational-transaction-domain-contract.md
Assignee:

## Question

What smallest vendor-neutral Business Action Contract lets any conversational provider request, observe, and reconcile order creation, amendment or cancellation, and payment actions across replaceable OMS/POS/payment connectors?

Produce a rough OpenAPI and signed-webhook contract to make the decision concrete. Resolve operation identity, business-resource versioning, authorization and confirmation evidence, synchronous acceptance versus final disposition, authoritative status lookup, error and uncertainty semantics, webhook authenticity, Action Receipt fields, connector ownership, version compatibility, and conformance requirements. Test the prototype contract against at least two materially different upstream shapes without building a production SDK, workflow language, marketplace, or customer-hosted runner.
