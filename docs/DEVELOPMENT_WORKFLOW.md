# WAIA development workflow — operational adjunct

**Canonical workflow, branching rules, phases, and agent contract:** [`AGENTS.md`](../AGENTS.md) · [`docs/waia-governance/BRANCHING-STRATEGY.md`](waia-governance/BRANCHING-STRATEGY.md) · [`docs/waia-governance/PR-PROTOCOL.md`](waia-governance/PR-PROTOCOL.md).

This page keeps **additive** ergonomics: git commands, stack, deployment pointers—not duplicate governance prose.

---

## Branch names (summary)

- **`dee-<NN>-<slug>`** — development from **`main`** (Linear `DEE-NN`; full rules in **BRANCHING-STRATEGY** above).
- **`main`** — single canonical trunk (**no direct push**).
- **`dev`** — frozen/retired (not an active PR base; Human deletion later).
- `feature/*` — legacy only; avoid for new work.

---

## Git flow (mechanical)

### 1. Sync with `main`

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
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

- **Base:** `main`
- **Compare:** `dee-<NN>-…`
- Sync with `origin/main` before opening if the branch was already pushed
- Merge process: **[`PR-PROTOCOL.md`](waia-governance/PR-PROTOCOL.md)** (Human squash merge)

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

* Protected trunk: `main` (GitHub rulesets — apply once):

  ```bash
  ./scripts/github/apply-branch-rulesets.sh
  ./scripts/github/configure-merge-settings.sh
  ```

* Pull requests required; squash merge into `main` (see **AGENTS.md**, **BRANCHING-STRATEGY**)
* `LINEAR_API_KEY` GitHub secret → auto **Done** on merge to `main` ([`linear-done.yml`](../.github/workflows/linear-done.yml))
* Official release = explicit Human tag of a `main` SHA — not branch promotion

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
