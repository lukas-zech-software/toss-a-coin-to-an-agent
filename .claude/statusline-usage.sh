#!/bin/bash
# Status line wrapper: saves the Claude.ai rate limits to tmp/claude-usage.json (so long agent runs can
# check how much of the 5-hour/7-day limit is left), then shows the usual personal status line.
input=$(cat)
dir=$(echo "$input" | jq -r '.workspace.project_dir // empty')
if [ -n "$dir" ] && [ -d "$dir/tmp" ]; then
  echo "$input" | jq -c '{saved_at: (now | floor), rate_limits}' >"$dir/tmp/claude-usage.json" 2>/dev/null
fi
echo "$input" | bash ~/.claude/statusline-command.sh
