#!/bin/bash
# chase round 8: the close puzzles (outcome depends on the plans), each played with 6 small nudges, no blocking vs pair
cd /home/metjr/tagproAI
for b in alone pair; do
  for js in "-0.015 -0.01" "-0.005 0.005" "0.01 0.015"; do
    ( for j in $js; do IDS=$(paste -sd, chase/results/close-ids.txt) JITTER=$j TAG=-j$j node chase/team.js both $b 0 99999; done ) &
  done; wait
done
