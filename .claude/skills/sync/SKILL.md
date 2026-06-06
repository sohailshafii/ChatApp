---
name: sync
description: Sync this clone to origin/main after a PR merges on GitHub and rebase the current feature branch onto it. Worktree-aware (the main branch may live in a sibling worktree). Use after merging a PR, or when asked to pull / update / sync with main.
---

# sync

Brings this clone up to date with `origin/main` after a PR merges on GitHub, and
rebases the current feature branch onto it. A plain `git pull` on a feature
branch does the wrong thing, and the merge happens GitHub-side (no local event
can trigger this automatically) — so it's a deliberate command.

## Run it

```bash
bash scripts/sync.sh
```

Refuses to run on a dirty tree (commit or stash first).

## What it does (by current state)
- **On a feature branch** → `git rebase origin/main` (replays your commits on the new main).
- **On `main`** (if this clone owns it) → `git merge --ff-only origin/main`.
- **Detached HEAD** → `git checkout --detach origin/main` (move to latest main).

It also fast-forwards the local `main` ref when it isn't checked out, and warns
to run `npm install` if `package.json` / lockfile changed in the pulled commits.

## Worktree note
The `main` branch may be checked out in a sibling worktree (e.g.
`../ChatApp-server`), so `git checkout main` fails in this clone. The script
detects that and syncs against `origin/main` directly — no local `main`
checkout required.

## On conflicts
If the rebase conflicts, the script stops and tells you to resolve and run
`git rebase --continue` (or `git rebase --abort`).
