#!/usr/bin/env bash
# Encodes composited frames and the mix into a delivery file for social platforms: H.264 High, 30 fps,
# BT.709 (converted from the sRGB frames with the right matrix, and tagged), AAC 320 kb/s, fast start.
# Two-pass at a target bitrate: 8 Mb/s keeps a 42 s film near 44 MB and is still well above what
# Instagram, TikTok and YouTube Shorts re-encode to.
#
#   trailer/tools/encode.sh <frames dir> <mix.wav> <out.mp4> [video kb/s]
set -euo pipefail
frames=$1; audio=$2; out=$3; rate=${4:-8000}
log=$(mktemp -d)/x264
video=(-vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p"
  -c:v libx264 -preset slow -b:v "${rate}k" -maxrate "$((rate * 16 / 10))k" -bufsize "$((rate * 2))k"
  -profile:v high -level 4.2 -x264-params "keyint=60:min-keyint=30:aq-mode=3" -passlogfile "$log"
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv)
ffmpeg -y -v error -stats -framerate 30 -i "$frames/%05d.png" "${video[@]}" -pass 1 -an -f mp4 /dev/null
ffmpeg -y -v error -stats -framerate 30 -i "$frames/%05d.png" -i "$audio" -map 0:v -map 1:a "${video[@]}" -pass 2 \
  -c:a aac -b:a 320k -ar 48000 -shortest -movflags +faststart "$out"
ffprobe -v error -show_entries format=duration,bit_rate,size:stream=codec_name,width,height,r_frame_rate -of compact "$out"
