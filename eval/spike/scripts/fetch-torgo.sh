#!/usr/bin/env bash
#
# Download the TORGO database of dysarthric speech.
#
#   Rudzicz, F., Namasivayam, A.K., Wolff, T. (2012).
#   "The TORGO database of acoustic and articulatory speech from speakers with
#   dysarthria." Language Resources and Evaluation 46(4), 523-541.
#   https://www.cs.toronto.edu/~complingweb/data/TORGO/torgo.html
#
# LICENCE: free for academic, non-profit use. You must cite the paper above.
# We do NOT redistribute this audio. This script downloads it from the source.
#
# Sizes verified 17 September 2026:
#   F   1.06 GB   3 female speakers with dysarthria   (F01, F03, F04)
#   M   2.33 GB   5 male speakers with dysarthria     (M01..M05)
#   FC  2.36 GB   3 female controls                   (FC01..FC03)
#   MC  3.17 GB   4 male controls                     (MC01..MC04)
#   TOTAL 8.92 GB compressed, about 18 GB unpacked.
#
# Usage:
#   ./scripts/fetch-torgo.sh              # dysarthric only, 3.4 GB  (what NEGBENCH needs)
#   ./scripts/fetch-torgo.sh --all        # everything, 8.9 GB      (adds matched controls)
#   ./scripts/fetch-torgo.sh --dir /path  # somewhere other than ./data/torgo
#
# Resumable. Re-run it if your connection drops; curl -C - picks up where it left off.

set -euo pipefail

BASE="https://www.cs.toronto.edu/~complingweb/data/TORGO"
DIR="./data/torgo"
SETS=(F M)          # dysarthric speakers only, by default

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)  SETS=(F M FC MC); shift ;;
    --dir)  DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p "$DIR"
cd "$DIR"

echo "Downloading TORGO into $(pwd)"
echo "Sets: ${SETS[*]}"
echo

for s in "${SETS[@]}"; do
  f="${s}.tar.bz2"
  if [[ -d "$s" ]]; then
    echo "  $s already unpacked, skipping"
    continue
  fi
  echo "  fetching $f"
  # -C - resumes a partial download, -L follows redirects, --retry survives blips
  curl -L -C - --retry 5 --retry-delay 5 --progress-bar -o "$f" "$BASE/$f"
done

echo
echo "Unpacking. This takes a few minutes and needs about twice the disk."
for s in "${SETS[@]}"; do
  f="${s}.tar.bz2"
  [[ -f "$f" ]] || continue
  [[ -d "$s" ]] && continue
  echo "  unpacking $f"
  tar -xjf "$f"
done

echo
echo "Done. Prompt sentences found:"
find . -name '*.txt' -not -path '*/doc/*' 2>/dev/null | wc -l
echo
echo "Next:"
echo "  cd .. && npm run bench          # NEGBENCH against real corpus sentences"
echo
echo "Remember to cite Rudzicz, Namasivayam and Wolff (2012) wherever these"
echo "numbers appear. Do not commit the audio to the repository."
