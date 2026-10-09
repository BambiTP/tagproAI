#!/bin/bash
# chase round 12 (lever2: leverage only when on offer): the close puzzles (outcome depends on the plans), each played with 6 small nudges, lever (compare with round 8 alone)
cd /home/metjr/tagproAI
for b in lever2; do
  for js in "-0.015 -0.01" "-0.005 0.005" "0.01 0.015"; do
    ( for j in $js; do IDS=$(paste -sd, chase/results/close-ids.txt) JITTER=$j TAG=-j$j node chase/team.js both $b 0 99999; done ) &
  done; wait
done
