#!/bin/sh

printf "\nSTART: setups/sway.sh\n"

printf "\nSymLink waybar\n"
mkdir -p ~/.config/sway
ln -sfv $(pwd)/configs/sway/config ~/.config/sway/config

printf "\nFINISH: setups/sway.sh\n"
