#!/usr/bin/env bash
# Contact sheet of a take: every <stride>th frame, labelled with its frame number.
#   trailer/tools/sheet.sh <frames dir> <out.jpg> [stride] [max] [tile]
set -euo pipefail
dir=$1; out=$2; stride=${3:-5}; max=${4:-14}; tile=${5:-7x2}
mapfile -t files < <(ls "$dir"/*.png | awk -v s="$stride" '(NR-1)%s==0' | head -n "$max")
montage "${files[@]}" -tile "$tile" -geometry 180x320+2+2 -label '%t' -pointsize 11 "$out"
