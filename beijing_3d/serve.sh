#!/bin/bash
# Serve the site locally:  ./serve.sh [port]
cd "$(dirname "$0")"
PORT="${1:-8765}"
echo "北京 · 五环之内  →  http://127.0.0.1:${PORT}/"
exec python3 -m http.server "$PORT" --directory site --bind 127.0.0.1
