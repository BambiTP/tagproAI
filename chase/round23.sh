#!/bin/bash
# chase round 23: containing chasers (kill points, safety nets, certain kills) against a plain and a simulating carrier,
# flag-home puzzles, 3 nudges (compare with round 22's both/lead chasers on the same games)
cd /home/metjr/tagproAI
while systemctl --user is-active -q tagproai-chase22; do sleep 60; done
for b in alone rollout2; do
  for j in -0.01 0 0.01; do IDS=$(paste -sd, chase/results/home-ids.txt) JITTER=$j TAG=-h$j node chase/team.js contain $b 0 99999 & done; wait
done
