# KFC Vietnam recommendation shadow runtime

Runtime profile: `local_docker_cloudflare_tunnel`.

This operator-managed Docker image serves the pinned public MLflow PyFunc at
`/invocations`. It is a protected technical shadow scorer only;
customer-visible ordering remains deterministic.

`model-binding.json` is generated for each runtime publication and pins an
immutable Hugging Face model commit. The image exposes MLflow's `/health` and
`/invocations` routes on port 7860. A Cloudflare Tunnel may expose that local
port for a live demo.

This is not a production availability claim. The Mac, Docker container, and
tunnel process must remain running for the public demo URL to work.
