#!/bin/bash
# chase round 16: the chaser's teammate choosing by rollout, against a carrier whose teammate does not block, fresh puzzles
cd /home/metjr/tagproAI
while systemctl --user is-active -q tagproai-chase15; do sleep 30; done
for j in -0.01 0 0.01; do IDS=$(paste -sd, chase/results/fresh-ids.txt) JITTER=$j TAG=-f$j node chase/team.js rollout alone 0 99999 & done; wait
