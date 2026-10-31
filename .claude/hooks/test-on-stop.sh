#!/bin/bash
# Stop: run the test suite (~6 s) while .ts files have uncommitted changes. Exit 2 keeps Claude working on a
# failure; stop_hook_active skips the second run so a failure that cannot be fixed does not loop.
input=$(cat)
[ "$(jq -r '.stop_hook_active // false' <<<"$input")" = "true" ] && exit 0
cd "$CLAUDE_PROJECT_DIR" || exit 0
[ -z "$(git status --porcelain -- '*.ts')" ] && exit 0

if ! out=$(npm test --silent 2>&1); then
  printf 'npm test fails:\n%s\n' "$(tail -60 <<<"$out")" >&2
  exit 2
fi
exit 0
