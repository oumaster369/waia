# DEE-80 — AI Gateway production inference rollout record

**Type:** Operator runbook scaffold (documentation only). **Does not** authorize production activation by itself. **Does not** change application defaults.

**Audience:** Architect / operators preparing **production** outbound inference for Twin dialogue **after** staging validation and **after** any Slice B runtime work merges.

**Prerequisites:**

1. [`DEE-79-AI-GATEWAY-ACTIVATION-RUNBOOK.md`](./DEE-79-AI-GATEWAY-ACTIVATION-RUNBOOK.md) staging smoke complete with §9 sign-off.
2. [`DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md`](../architecture/DEE-80-PROMPT-ENVELOPE-DOCTRINE-V1.md) accepted for the envelope shape deployed to production.
3. Familiarity with [`DEE-76-AI-GATEWAY-ARCHITECTURE.md`](../architecture/DEE-76-AI-GATEWAY-ARCHITECTURE.md) and [`docs/cloudflare-deploy.md`](../cloudflare-deploy.md).

---

## 1. Scope

- **In scope:** Documented procedure for **deliberate** production enablement of OpenAI-compatible completion on **`POST /api/dashboard/twin-dialogue/turn`**, observation of **`waia_runtime_route`** telemetry, mandatory kill-switch drill, and sign-off.
- **Out of scope:** Staging-only procedures (use DEE-79 runbook). CI live integration tests. Retries, streaming, tool calls, retrieval, embeddings. AI-gateway DB tables (**Linear DEE-107**). Promotion mechanics beyond pointers to existing deploy docs.

---

## 2. Preconditions (human checklist)

- [ ] `dev → main` promotion policy satisfied per [`POST-MERGE-PROTOCOL.md`](../waia-governance/POST-MERGE-PROTOCOL.md) and [`cloudflare-deploy.md`](../cloudflare-deploy.md).
- [ ] Production hostname / `NEXT_PUBLIC_SITE_URL` identity verified — **not** staging.
- [ ] Secrets injected via approved secret manager — **`WAIA_AI_OPENAI_API_KEY`** never in tickets or Git.
- [ ] Two-key posture understood: `WAIA_AI_GATEWAY_FOUNDATION` + `WAIA_AI_PROVIDER=openai-compatible` (see DEE-79 §2 for semantics).
- [ ] Privacy / persistence acknowledgements from DEE-79 §7–§8 understood at production severity.

---

## 3. Rollout procedure (mirror staging semantics)

Follow the **same semantic steps** as [`DEE-79-AI-GATEWAY-ACTIVATION-RUNBOOK.md`](./DEE-79-AI-GATEWAY-ACTIVATION-RUNBOOK.md) §§3–5 adapted to **production**: baseline telemetry → deliberate env flip on production hosts only → single benign authenticated smoke → stdout observation → **mandatory** kill-switch drill → restore safe defaults unless intentionally sustained.

Use production log aggregation to locate `waia_runtime_route` lines (`route: "twin_dialogue_turn"`).

---

## 4. Telemetry expectations

Identical field taxonomy to DEE-79 §4 and [`DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md`](./DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md). Production introduces **no** additional stdout fields without a scoped telemetry issue.

---

## 5. Production sign-off block

```
Environment name (production):
Architect / operator:
Timestamp (UTC):
WAIA commit SHA deployed:
Prompt envelope doctrine version (DEE-80 doc control):
Smoke outcome (live / degraded / aborted):
Kill-switch drill performed (y/n):
Sustained live inference authorized (y/n):
Notes:
```

---

## Document control

| Version | Slice | Notes |
|---------|--------|------|
| 1.0 | DEE-80 Slice C | Initial production inference rollout record scaffold (docs only). |
