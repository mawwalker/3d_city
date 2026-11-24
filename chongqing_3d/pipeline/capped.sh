#!/bin/bash
# Run a command inside a memory-capped cgroup scope if systemd user bus is available,
# otherwise run with modest worker concurrency (CQ3D_PROCS=6) to keep RAM usage safe.
set -uo pipefail
cap="$1"; shift
if [ -n "${XDG_RUNTIME_DIR:-}" ] && command -v systemd-run >/dev/null 2>&1; then
  exec systemd-run --user --scope --quiet -p MemoryMax="$cap" -p MemorySwapMax=0 -- bash -c '
    "$@"; rc=$?
    cg=/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)
    if [ -r "$cg/memory.peak" ]; then awk -v c="'"$cap"'" "{printf \"[capped] peak %.1f GB (cap %s), exit '"'"'\$rc'"'"'\\n\", \$1/1073741824, c}" "$cg/memory.peak" | sed "s/\$rc/$rc/"; fi
    exit $rc' _ "$@"
else
  export CQ3D_PROCS="${CQ3D_PROCS:-6}"
  exec "$@"
fi
