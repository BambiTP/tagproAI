#!/bin/bash
# chase round 13: fresh puzzles (never used to design a blocker), 3 nudges each, no blocking vs lever2
cd /home/metjr/tagproAI
for b in alone lever2; do
  for j in -0.01 0 0.01; do IDS=$(paste -sd, chase/results/fresh-ids.txt) JITTER=$j TAG=-f$j node chase/team.js both $b 0 99999 & done; wait
done
