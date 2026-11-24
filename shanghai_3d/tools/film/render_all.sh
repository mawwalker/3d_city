#!/bin/bash
# The whole film at 4K, four recorders side by side (each in its own memory cap), the graphics card encoding the clips.
cd "$(dirname "$0")/.."
OUT=../video/clips; mkdir -p $OUT
run() { ../pipeline/capped.sh 10G node film.mjs --shots film/shots.mjs --w 3840 --h 2160 --out $OUT --enc nvenc --only "$1" > ../video/render_$2.log 2>&1; }
run "${W1:-s16_away,s04_roofs,s09_trees,s17_twilight}" 1 &
run "${W2:-s03_map,s13_dusk,s14a_umbrellas,s10_garden}" 2 &
run "${W3:-s08_dive,s06_bridge,s12_drive,s11_bund,s18_nightfall}" 3 &
run "${W4:-s15_night,s05_towers,s06a_lupu,s07_interchange,s14b_promenade,s10b_jingan}" 4 &
wait
grep -h "frames in\|done in\|page errors\|Error" ../video/render_[1-4].log | cut -c1-150
