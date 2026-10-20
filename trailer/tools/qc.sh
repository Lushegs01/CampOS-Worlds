#!/usr/bin/env bash
# Delivery checks for a finished film: format, duration, loudness and true peak, black and frozen
# stretches (a missing or stuck plate would show as one).
#
#   trailer/tools/qc.sh <film.mp4>
set -euo pipefail
f=$1
echo "== $f"
ffprobe -v error -show_entries stream=codec_name,profile,width,height,r_frame_rate,pix_fmt,color_primaries,color_transfer,color_space,sample_rate,channels:format=duration,size,bit_rate -of default=nw=1 "$f" | paste -sd ' ' | fold -w 160
echo "-- loudness (target -14 LUFS integrated, true peak under -1 dBTP)"
ffmpeg -hide_banner -nostats -i "$f" -af ebur128=peak=true -f null - 2>&1 | grep -A16 "Summary:" | grep -E "I:|LRA:|Peak:" | sed 's/^ */   /'
echo "-- black stretches over 0.25 s (the opening darkness is intended: up to about 0.5 s)"
ffmpeg -hide_banner -nostats -i "$f" -vf blackdetect=d=0.25:pix_th=0.06 -an -f null - 2>&1 | grep -o "black_start.*" || echo "   none"
echo "-- frozen stretches over 0.5 s (the end card holds still by design from about 39 s)"
ffmpeg -hide_banner -nostats -i "$f" -vf freezedetect=n=0.001:d=0.5 -an -f null - 2>&1 | grep -o "freeze_start.*\|freeze_end.*" | paste -sd ' ' || echo "   none"
