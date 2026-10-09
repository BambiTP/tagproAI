#!/bin/bash
# chase round 19: chasers that lead the carrier from its velocity, against a plain carrier and a simulating one (fresh puzzles)
cd /home/metjr/tagproAI
while systemctl --user is-active -q tagproai-chase18; do sleep 30; done
for b in alone rollout2; do
  for j in -0.01 0 0.01; do IDS=$(paste -sd, chase/results/fresh-ids.txt) JITTER=$j TAG=-f$j node chase/team.js lead $b 0 99999 & done; wait
done
