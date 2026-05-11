# WAIA development workflow — operational adjunct

**Canonical workflow, branching rules, phases, and agent contract:** [`AGENTS.md`](../AGENTS.md) · [`docs/waia-governance/BRANCHING-STRATEGY.md`](waia-governance/BRANCHING-STRATEGY.md) · [`docs/waia-governance/PR-PROTOCOL.md`](waia-governance/PR-PROTOCOL.md).

This page keeps **additive** ergonomics: git commands, stack, deployment pointers—not duplicate governance prose.

---

## Branch names (summary)

- **`dee-<NN>-<slug>`** — development (Linear `DEE-NN`; full rules in **BRANCHING-STRATEGY** above).
- **`dev`** — integration (**no direct push**).
- **`main`** — production (**no direct push**).
- `feature/*` — legacy only; avoid for new work.

---

## Git flow (mechanical)

### 1. Sync with `dev`

```bash
git checkout dev
git pull origin dev
```

### 2. Create branch

```bash
git checkout -b dee-<NN>-<task-slug>
```

### 3. Work and commit

```bash
git add .
git commit -m "clear and meaningful message"
```

### 4. Push branch

```bash
git push origin dee-<NN>-<task-slug>
```

### 5. Pull request

- **Base:** `dev`
- **Compare:** `dee-<NN>-…`
- Merge process: **[`PR-PROTOCOL.md`](waia-governance/PR-PROTOCOL.md)**

---

## Before any Git action

```bash
git status
git branch
```

---

## Do NOT commit

* `.env`
* `node_modules/`
* `.next/`
* secrets or API keys

---

## Repository rules

* Protected branches: `dev`, `main`
* Pull requests required (see **AGENTS.md**)

---

## Tech stack

* Next.js
* TypeScript
* pnpm
* Tailwind CSS
* shadcn/ui

---

## Deployment

**Cloudflare Workers** + **OpenNext** (`@opennextjs/cloudflare`), not static Pages-only export.

See [cloudflare-deploy.md](cloudflare-deploy.md), [cloudflare-env-vars.md](cloudflare-env-vars.md), and [.dev.vars.example](../.dev.vars.example).

CI/Git auto-deploy wiring is a separate follow-up.
