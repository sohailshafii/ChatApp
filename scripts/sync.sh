#!/usr/bin/env bash
# Bring this clone up to date with origin/main after a PR merges on GitHub, and
# rebase the current feature branch onto it.
#
#   Usage:  bash scripts/sync.sh
#
# Worktree-aware: the `main` branch may be checked out in a sibling worktree
# (e.g. ../ChatApp-server), in which case `git checkout main` fails here — so we
# sync against origin/main directly and never require a local main checkout.
#
# Behavior by current state:
#   - on a feature branch  → rebase it onto origin/main
#   - on main (this clone owns it) → fast-forward main to origin/main
#   - detached HEAD        → move to latest origin/main (detached)
# Refuses to run on a dirty tree. See .claude/skills/sync.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> git fetch origin"
git fetch origin --prune || { echo "fetch failed"; exit 1; }

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree has uncommitted changes — commit or stash first. Aborting."
  git status -s
  exit 1
fi

BEFORE="$(git rev-parse HEAD)"

# Fast-forward the local main ref when it isn't checked out in any worktree.
if git worktree list | grep -qE '\[main\]$'; then
  echo "  (main is checked out in another worktree — syncing against origin/main directly)"
else
  git branch -f main origin/main 2>/dev/null && echo "  local main → origin/main" || true
fi

CUR="$(git symbolic-ref --quiet --short HEAD || echo '(detached)')"
echo "==> current: $CUR"

if [ "$CUR" = "main" ]; then
  git merge --ff-only origin/main && echo "  main fast-forwarded"
elif [ "$CUR" = "(detached)" ]; then
  git checkout --detach origin/main 2>/dev/null && echo "  moved to latest origin/main (detached)"
else
  echo "==> rebasing $CUR onto origin/main"
  if git rebase origin/main; then
    echo "  rebased $CUR onto origin/main"
  else
    echo "  rebase hit conflicts — resolve, then 'git rebase --continue' (or 'git rebase --abort')."
    exit 1
  fi
fi

# Heads-up if dependency manifests moved (the classic post-pull ERR_MODULE_NOT_FOUND).
AFTER="$(git rev-parse HEAD)"
if [ "$BEFORE" != "$AFTER" ] && git diff --name-only "$BEFORE" "$AFTER" | grep -qE '(^|/)package(-lock)?\.json$'; then
  echo "  ⚠ dependency manifests changed — run: npm install"
fi

echo "==> done"
git log --oneline -1
