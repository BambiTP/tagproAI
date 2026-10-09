#!/bin/bash
# chase round 22: the main two-against-two match-ups again, on flag-home puzzles only (the carrier could really cap), 3 nudges.
# Resumable: a match-up/nudge already holding every puzzle is skipped; a partial one is started again from empty.
cd /home/metjr/tagproAI
N=$(wc -l < chase/results/home-ids.txt)
for pair in "both alone" "both rollout" "lead alone" "both rollout2" "lead rollout2"; do
  set -- $pair
  for j in -0.01 0 0.01; do
    f=chase/results/team-$1-$2-h$j.jsonl
    if [ -f "$f" ] && [ "$(wc -l < "$f")" -ge "$N" ]; then continue; fi
    rm -f "$f"
    IDS=$(paste -sd, chase/results/home-ids.txt) JITTER=$j TAG=-h$j node chase/team.js $1 $2 0 99999 &
  done; wait
done
