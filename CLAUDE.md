# WAIA AI Development Rules

## Core workflow

- Do NOT push directly to `dev` or `main`
- Always use feature branches
- Always create Pull Requests

## Steps

1. Checkout dev:
   git checkout dev
   git pull origin dev

2. Create branch:
   git checkout -b feature/<task-name>

3. Work and commit:
   git add .
   git commit -m "clear message"

4. Push:
   git push origin feature/<task-name>

5. Create Pull Request → dev

## Safety

- Never commit:
  - .env
  - node_modules
  - .next
  - secrets / keys

- Always check before actions:
  git status
  git branch

## Repo info

- Repo: git@github.com:oumaster369/waia.git
- Base branch: dev
- Protected branches: dev, main

If unsure — STOP and ask before doing git operations.
