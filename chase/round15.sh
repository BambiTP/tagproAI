#!/bin/bash
# chase round 15: the rollout blocker (no rule about where to stand) on round 13's fresh puzzles, 3 nudges
cd /home/metjr/tagproAI
while systemctl --user is-active -q tagproai-chase14; do sleep 30; done
for j in -0.01 0 0.01; do IDS=$(paste -sd, chase/results/fresh-ids.txt) JITTER=$j TAG=-f$j node chase/team.js both rollout 0 99999 & done; wait
