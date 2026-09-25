#!/usr/bin/env bash
# Snapshots every build worktree so an interrupted run loses minutes, not hours.
#
# For each worktree under .claude/worktrees:
#   - refs/backup/<worktree> points at its latest commit (commits already
#     live in the shared .git; the ref keeps them reachable even if the
#     worktree and its branch are cleaned up)
#   - .claude/backups/<worktree>/<time>.patch holds its uncommitted changes
#     and <time>.tar its untracked files
#
# Strictly read-only toward the worktrees: --no-optional-locks means git never
# writes their index, so an agent mid-commit is never blocked by index.lock.

set -u
ROOT=$(git rev-parse --show-toplevel)
KEEP=12   # snapshots kept per worktree

snapshot() {
  local wt=$1 name stamp dir sha untracked
  name=$(basename "$wt")
  [ -e "$wt/.git" ] || return 0
  sha=$(git -C "$wt" --no-optional-locks rev-parse HEAD 2>/dev/null) || return 0
  git -C "$ROOT" update-ref "refs/backup/$name" "$sha"

  dir="$ROOT/.claude/backups/$name"
  mkdir -p "$dir"
  stamp=$(date +%Y%m%d-%H%M%S)
  git -C "$wt" --no-optional-locks diff --binary HEAD > "$dir/$stamp.patch" 2>/dev/null
  untracked=$(git -C "$wt" --no-optional-locks ls-files --others --exclude-standard 2>/dev/null \
    | grep -v '^node_modules' | grep -v '^\.scratch/')
  if [ -n "$untracked" ]; then
    (cd "$wt" && printf '%s\n' "$untracked" | tar -cf "$dir/$stamp.tar" -T - 2>/dev/null)
  fi
  echo "$sha" > "$dir/$stamp.head"
  # Nothing changed since the last snapshot: drop the duplicate.
  if [ ! -s "$dir/$stamp.patch" ] && [ ! -e "$dir/$stamp.tar" ]; then
    rm -f "$dir/$stamp.patch"
  fi
  ls -1t "$dir"/*.head 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    base=${old%.head}
    rm -f "$base.head" "$base.patch" "$base.tar"
  done
}

while true; do
  for wt in "$ROOT"/.claude/worktrees/*/; do
    snapshot "${wt%/}"
  done
  echo "$(date +%H:%M:%S) snapshot done: $(ls -d "$ROOT"/.claude/worktrees/*/ 2>/dev/null | wc -l) worktrees"
  sleep 300
done
