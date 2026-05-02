


# WAIA Development Workflow

## Overview

This project uses a protected Git workflow.

Direct pushes to `dev` and `main` are not allowed.  
All changes must go through Pull Requests.

---

## Branch Structure

- `main` — production (reserved)
- `dev` — main working branch
- `feature/*` — development branches

Examples:

- feature/initial-waia-app
- feature/auth-system
- feature/ai-twin-core

---

## Development Flow

### 1. Sync with dev

```bash
git checkout dev
git pull origin dev
````

### 2. Create feature branch

```bash
git checkout -b feature/<task-name>
```

### 3. Work and commit

```bash
git add .
git commit -m "clear and meaningful message"
```

### 4. Push branch

```bash
git push origin feature/<task-name>
```

### 5. Create Pull Request

* base: `dev`
* compare: `feature/<task-name>`

---

## Merge Process

* Pull Request must be created for all changes
* Merge is done via GitHub UI
* Squash merge is preferred
* After merge, feature branch can be deleted

---

## Repository Rules

* Protected branches: `dev`, `main`
* Direct push is blocked
* Pull Request is required

---

## Do NOT commit

* `.env`
* `node_modules/`
* `.next/`
* secrets or API keys

---

## Before any Git action

Always check:

```bash
git status
git branch
```

---

## Tech Stack

* Next.js
* TypeScript
* pnpm
* Tailwind CSS
* shadcn/ui

---

## Deployment (next step)

* Cloudflare Pages will be connected
* Auto-deploy from `dev` branch

```








 











