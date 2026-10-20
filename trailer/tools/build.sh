#!/usr/bin/env bash
# The whole film from scratch: plates for both formats, sync cues, score, composite, encode, captions.
# Expects the capture server running (npx vite --config trailer/vite.capture.config.ts --host 127.0.0.1).
#
#   trailer/tools/build.sh [9x16|16x9|both]
set -euo pipefail
cd "$(dirname "$0")/../.."
formats=${1:-both}; [ "$formats" = both ] && formats="9x16 16x9"
mkdir -p trailer/deliverables/audio/stems
for f in $formats; do node trailer/tools/render.mjs --aspect "$f" --workers 2; done
node trailer/tools/cues.mjs trailer/out/plates/9x16
python3 trailer/audio/score.py trailer/out/audio
python3 trailer/audio/analyze.py trailer/out/audio
for f in $formats; do
  node trailer/tools/compose.mjs --aspect "$f"
  size=$([ "$f" = 9x16 ] && echo 1080x1920 || echo 1920x1080)
  trailer/tools/encode.sh "trailer/out/frames/$f-$size" trailer/out/audio/mix.wav "trailer/deliverables/campos-worlds-reveal-$f.mp4"
done
cp trailer/out/audio/mix.wav trailer/deliverables/audio/mix.wav
for s in trailer/out/audio/stems/*.wav; do ffmpeg -y -v error -i "$s" -c:a flac -compression_level 8 "trailer/deliverables/audio/stems/$(basename "$s" .wav).flac"; done
node trailer/tools/captions.mjs
