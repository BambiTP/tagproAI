#!/bin/bash
# chase round 22: the main two-against-two match-ups again, on flag-home puzzles only (the carrier could really cap), 3 nudges
cd /home/metjr/tagproAI
for pair in "both alone" "both rollout" "lead alone" "both rollout2" "lead rollout2"; do
  for j in -0.01 0 0.01; do IDS=$(paste -sd, chase/results/home-ids.txt) JITTER=$j TAG=-h$j node chase/team.js $pair 0 99999 & done; wait
done
