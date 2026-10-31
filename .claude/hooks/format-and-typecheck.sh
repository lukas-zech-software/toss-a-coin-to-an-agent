#!/bin/bash
# PostToolUse (Edit|Write): format the edited file with Prettier; after a .ts edit, type-check the whole project
# (tsc takes < 1 s). Exit 2 sends the errors back to Claude.
cd "$CLAUDE_PROJECT_DIR" || exit 0
f=$(jq -r '.tool_input.file_path // empty')
case "$f" in
  "$CLAUDE_PROJECT_DIR"/*) ;;
  *) exit 0 ;; # outside the repo (scratchpad, memory, …)
esac

if ! out=$(node_modules/.bin/prettier --write --ignore-unknown --log-level warn "$f" 2>&1); then
  printf 'prettier failed for %s:\n%s\n' "$f" "$out" >&2
  exit 2
fi

case "$f" in
  *.ts)
    if ! out=$(node_modules/.bin/tsc --pretty false 2>&1); then
      printf 'tsc found type errors:\n%s\n' "$out" >&2
      exit 2
    fi
    ;;
esac
exit 0
