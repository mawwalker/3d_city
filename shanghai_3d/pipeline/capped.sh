#!/bin/bash
# Run a command inside a memory-capped cgroup scope, so that a runaway job is killed on its own instead of taking the
# machine down with it (swap is not allowed to the scope either). Prints the scope's peak memory when the command ends.
#   pipeline/capped.sh 24G .venv/bin/python -I pipeline/32_trees.py data/work data/raw/canopy
set -uo pipefail
cap="$1"; shift
exec systemd-run --user --scope --quiet -p MemoryMax="$cap" -p MemorySwapMax=0 -- bash -c '
  "$@"; rc=$?
  cg=/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)
  if [ -r "$cg/memory.peak" ]; then awk -v c="'"$cap"'" "{printf \"[capped] peak %.1f GB (cap %s), exit '"'"'\$rc'"'"'\\n\", \$1/1073741824, c}" "$cg/memory.peak" | sed "s/\$rc/$rc/"; fi
  exit $rc' _ "$@"
