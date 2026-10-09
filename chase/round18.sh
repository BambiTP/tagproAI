#!/bin/bash
# chase round 18: rlead (rollout chaser with chasers leading the carrier in the simulations), fresh puzzles
cd /home/metjr/tagproAI
while systemctl --user is-active -q tagproai-chase17; do sleep 30; done
for j in -0.01 0 0.01; do IDS=$(paste -sd, chase/results/fresh-ids.txt) JITTER=$j TAG=-f$j node chase/team.js rlead alone 0 99999 & done; wait
