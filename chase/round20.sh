#!/bin/bash
# chase round 20: split chasers (one route interceptor, one leading) against the rollout2 carrier, fresh puzzles
cd /home/metjr/tagproAI
for j in -0.01 0 0.01; do IDS=$(paste -sd, chase/results/fresh-ids.txt) JITTER=$j TAG=-f$j node chase/team.js split rollout2 0 99999 & done; wait
