#!/bin/bash
# Rebuild Chongqing 3D data files under site/data & site/assets from raw downloads in data/raw.
# Usage:
#   pipeline/build_all.sh core     # Phase 1: 10x7 km core (70 tiles covering ALL heroes & bridges)
#   pipeline/build_all.sh full     # Phase 2: full 24x22 km city (528 tiles)
set -euo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-full}"
PY=".venv/bin/python -I"
W="${WORK_DIR:-data/work}"
S="${SITE_DATA:-site/data}"
mkdir -p "$W" "$S" site/assets data/debug

RANGE_ARGS=""
if [ "$MODE" = "core" ]; then
  RANGE_ARGS="8 7 18 14"
fi

$PY pipeline/10_extract_osm.py data/raw/osm/chongqing-latest.osm.pbf "$W"
$PY pipeline/11_rings.py "$W"
$PY pipeline/12_flyovers.py "$W"
$PY pipeline/14_spread_roads.py "$W"
$PY pipeline/20_fuse_buildings.py "$W" data/raw/gba/gba_chongqing.parquet data/raw/overture/buildings.parquet
$PY pipeline/13_terrain.py data/raw/dem "$W"
$PY pipeline/33_export_terrain.py "$W" "$S"
$PY pipeline/21_heights_styles.py "$W"
$PY pipeline/34_landmarks.py "$W" "$S" pipeline/landmark_exclusions.json
pipeline/capped.sh 24G $PY pipeline/31_build_ground.py "$W" $RANGE_ARGS
$PY pipeline/29_clip_buildings.py "$W"
$PY pipeline/36_boats.py "$W" "$S"
$PY pipeline/30_build_tiles.py "$W" pipeline/landmark_exclusions.json $RANGE_ARGS
pipeline/capped.sh 20G $PY pipeline/32_trees.py "$W" $RANGE_ARGS
pipeline/capped.sh 24G $PY pipeline/37_traffic.py "$W" $RANGE_ARGS
$PY pipeline/39_pack_tiles.py "$W" "$S"
$PY pipeline/33_far_ground.py "$W" "$S"
$PY pipeline/35_places.py "$W" site
$PY pipeline/50_textures.py data/raw/textures site/assets 1024
$PY pipeline/51_foliage.py site/assets
$PY pipeline/52_signs.py site/assets
$PY pipeline/53_interiors.py site/assets
$PY pipeline/38_audit.py "$W" site pipeline/landmark_exclusions.json
du -sh "$S" site/assets
