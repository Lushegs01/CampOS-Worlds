#!/usr/bin/env bash
# Encodes composited frames and the mix into a delivery file for social platforms: H.264 High, 30 fps,
# BT.709 (converted from the sRGB frames with the right matrix, and tagged), AAC 320 kb/s, fast start.
#
#   trailer/tools/encode.sh <frames dir> <mix.wav> <out.mp4> [crf]
set -euo pipefail
frames=$1; audio=$2; out=$3; crf=${4:-16}
ffmpeg -y -v error -stats -framerate 30 -i "$frames/%05d.png" -i "$audio" \
  -map 0:v -map 1:a \
  -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" \
  -c:v libx264 -preset slow -crf "$crf" -profile:v high -level 4.2 -x264-params "keyint=60:min-keyint=30:aq-mode=3" \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -c:a aac -b:a 320k -ar 48000 -shortest -movflags +faststart "$out"
ffprobe -v error -show_entries format=duration,bit_rate:stream=codec_name,width,height,r_frame_rate -of compact "$out"
