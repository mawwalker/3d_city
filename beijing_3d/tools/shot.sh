#!/bin/bash
# usage: shot.sh <name> [cam] [hour] [extra args...]
name=$1; cam=$2; hour=$3; shift 3 2>/dev/null
args=(--out "../shots/$name.png")
[ -n "$cam" ] && args+=("--cam=$cam")
[ -n "$hour" ] && args+=("--hour=$hour")
timeout 120 node shot.mjs "${args[@]}" "$@" 2>&1 | grep -vE "status of 404|ReadPixels" | cut -c1-${CUT:-220} | head -${LINES_MAX:-12}
