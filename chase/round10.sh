#!/bin/bash
# chase round 10 (DELAY=12, human-like reaction): the close puzzles (outcome depends on the plans), each played with 6 small nudges, no blocking vs mark
cd /home/metjr/tagproAI
for b in alone mark; do
  for js in "-0.015 -0.01" "-0.005 0.005" "0.01 0.015"; do
    ( for j in $js; do IDS=$(paste -sd, chase/results/close-ids.txt) JITTER=$j DELAY=12 TAG=-dj$j node chase/team.js both $b 0 99999; done ) &
  done; wait
done
