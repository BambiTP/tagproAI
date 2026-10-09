#!/bin/bash
# chase round 17: carrier and its teammate both choosing by rollout (rollout2), fresh puzzles
cd /home/metjr/tagproAI
while systemctl --user is-active -q tagproai-chase16; do sleep 30; done
for j in -0.01 0 0.01; do IDS=$(paste -sd, chase/results/fresh-ids.txt) JITTER=$j TAG=-f$j node chase/team.js both rollout2 0 99999 & done; wait
