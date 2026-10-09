#!/bin/bash
# chase round 14: lever3 on round 13's fresh puzzles, 3 nudges (compare with round 13's alone and lever2)
cd /home/metjr/tagproAI
for j in -0.01 0 0.01; do IDS=$(paste -sd, chase/results/fresh-ids.txt) JITTER=$j TAG=-f$j node chase/team.js both lever3 0 99999 & done; wait
