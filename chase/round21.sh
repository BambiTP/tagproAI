#!/bin/bash
# chase round 21: rlead2 chasers (leader + teammate choosing by simulation with a dodging carrier model) against the rollout2 carrier, fresh puzzles
cd /home/metjr/tagproAI
for j in -0.01 0 0.01; do IDS=$(paste -sd, chase/results/fresh-ids.txt) JITTER=$j TAG=-f$j node chase/team.js rlead2 rollout2 0 99999 & done; wait
