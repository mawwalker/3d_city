#!/bin/bash
# Serve the site locally:  ./serve.sh [port]
cd "$(dirname "$0")"
PORT="${1:-8766}"
echo "上海 · 漫步全景  →  http://127.0.0.1:${PORT}/"
exec python3 -m http.server "$PORT" --directory site --bind 127.0.0.1
