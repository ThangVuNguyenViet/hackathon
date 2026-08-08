# Inspect umodel-1783649298 in AstraFlow after login

## Question

After logging into AstraFlow (`astraflow.scloudsg.com`), what exactly is the model at `umodel-1783649298`?
- Is it a fine-tuned model with stored weights (needs GPU serving)?
- Is it a custom API endpoint wrapper pointing at an external URL?
- Is it a prompt-wrapped base model (e.g. system prompt + gpt-4.1-mini)?

The answer determines whether a second integration step is needed (registering the SCloud backend URL in AstraFlow) or whether the AstraFlow model is entirely independent of the SCloud VM.

## Type

`wayfinder:task` (AFK — browse the AstraFlow console after the user logs in)

## Status

CLOSED ✅

## Resolution

`umodel-1783649298` **does not exist** on this AstraFlow account (`thangvu@ecomeasy.asia`, CompanyID `68978675`).

Evidence gathered 2026-08-06:
- Model Marketplace garfish app has no route for the ID; redirects to `gpt-5.6-luna` default
- Model ID filter in Model Log has no `umodel-` entries at all (only marketplace provider groups)
- SkillLab returns error 155 (product not enabled); no user models visible anywhere
- No API keys created on this account
- AstraFlow is effectively a fresh/empty account

**Conclusion:** The `umodel-1783649298` reference in the wayfinder map was speculative or refers to a different account/project. It does **not** create any dependency on the SCloud VM deployment. The AstraFlow integration step is **not needed** — the backend endpoint can be tested directly with curl or wired into AstraFlow later by creating a new API key and pointing any model wrapper at `http://<EIP>:8787`.

**Next step:** Proceed directly to VM creation on SCloud (UHost = 0, EIP exists but unbound).
