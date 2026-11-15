#!/usr/bin/env bash
# Crop and encode Blender renders (art/build) into web assets (web/public/art).
# Needs cwebp (brew install webp) and node. Run from the repo root: art/encode.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=art/build
DST=web/public/art
mkdir -p "$DST/court" "$DST/props"

# Courtroom layers: crop each to its alpha box (recorded by render.py), then encode.
node -e '
const m = require("./art/build/court/manifest.json");
for (const [name, l] of Object.entries(m.layers)) console.log(name, ...l.px);
' | while read -r name x y w h; do
  q=86
  [ "$name" = "back" ] && q=84
  [ "$name" = "haze" ] && q=80
  cwebp -quiet -q "$q" -alpha_q 90 -m 6 -sharp_yuv -crop "$x" "$y" "$w" "$h" "$SRC/court/$name.png" -o "$DST/court/$name.webp"
  printf "  %-10s %6s KB\n" "$name" "$(( $(stat -f%z "$DST/court/$name.webp") / 1024 ))"
done

# The manifest the stage reads, without the pixel boxes.
node -e '
const m = require("./art/build/court/manifest.json");
for (const l of Object.values(m.layers)) delete l.px;
require("fs").writeFileSync("web/src/stage/court.json", JSON.stringify(m, null, 2) + "\n");
'

# Props and key art: full frame, alpha kept.
if [ -d "$SRC/props" ]; then
  for f in "$SRC"/props/*.png; do
    [ -e "$f" ] || continue
    n=$(basename "$f" .png)
    cwebp -quiet -q 88 -alpha_q 95 -m 6 -sharp_yuv "$f" -o "$DST/props/$n.webp"
    printf "  %-14s %6s KB\n" "$n" "$(( $(stat -f%z "$DST/props/$n.webp") / 1024 ))"
  done
fi
