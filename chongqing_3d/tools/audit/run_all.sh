#!/usr/bin/env bash
# Chongqing 3D — Full Data + Runtime Verification Runner
# Usage:
#   ./run_all.sh --data-only [--phase 1|2]
#   ./run_all.sh --runtime-only [--url http://127.0.0.1:8768/] [--quality ultra]
#   ./run_all.sh [--phase 1|2] [--url http://127.0.0.1:8768/] [--quality ultra]
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"

PY="$ROOT/.venv/bin/python"
if [ ! -x "$PY" ]; then
  PY="$(cd "$(dirname "$0")/../../.." && pwd)/shanghai_3d/.venv/bin/python"
fi

CAPPED=""
if [ -x "$ROOT/pipeline/capped.sh" ]; then
  CAPPED="$ROOT/pipeline/capped.sh 12G"
elif [ -x "$(cd "$(dirname "$0")/../../.." && pwd)/shanghai_3d/pipeline/capped.sh" ]; then
  CAPPED="$(cd "$(dirname "$0")/../../.." && pwd)/shanghai_3d/pipeline/capped.sh 12G"
fi

MODE="all"
PHASE=1
URL="http://127.0.0.1:8768/"
QUALITY="ultra"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --data-only) MODE="data"; shift ;;
    --runtime-only) MODE="runtime"; shift ;;
    --phase) PHASE="$2"; shift 2 ;;
    --url) URL="$2"; shift 2 ;;
    --quality) QUALITY="$2"; shift 2 ;;
    *) shift ;;
  esac
done

export XDG_CONFIG_HOME=/tmp/cq-chrome-cfg
export XDG_CACHE_HOME=/tmp/cq-chrome-cache
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"

RC=0
if [[ "$MODE" == "all" || "$MODE" == "data" ]]; then
  echo ">>> [1/4] GIS, DEM, Tiles & Assets Audit"
  "$PY" "$DIR/audit_gis_dem.py" --root "$ROOT" --phase "$PHASE" || RC=1
fi

if [[ "$MODE" == "all" || "$MODE" == "runtime" ]]; then
  echo ">>> [2/4] Headless Chromium Runtime, WebGL, Bench & Geometry Audit"
  $CAPPED node "$DIR/audit_runtime.mjs" --root "$ROOT" --url "$URL" --quality "$QUALITY" || RC=1
  echo ">>> [3/4] Walk/Fly Slope, Hongyadong & Bridge Deck Collision Audit"
  $CAPPED node "$DIR/audit_collision.mjs" --root "$ROOT" --url "$URL" || RC=1
  echo ">>> [4/4] Dynamic Traffic, Pedestrians, Liziba Monorail & Cableway Audit"
  $CAPPED node "$DIR/audit_dynamics.mjs" --root "$ROOT" --url "$URL" || RC=1
fi

echo "=== Audit Runner finished with exit code $RC ==="
exit $RC
