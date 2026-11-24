#!/bin/bash
# Publish site/ to Cloudflare Workers static assets (configure wrangler.jsonc first)
set -euo pipefail
cd "$(dirname "$0")"
npx --yes wrangler@latest deploy "$@"
