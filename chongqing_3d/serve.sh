#!/bin/bash
# Serve Chongqing 3D locally: ./serve.sh [port]
cd "$(dirname "$0")"
PORT="${1:-8768}"
echo "重庆 · 山城全景 8D 3D  →  http://127.0.0.1:${PORT}/"
exec python3 -m http.server "$PORT" --directory site --bind 127.0.0.1
