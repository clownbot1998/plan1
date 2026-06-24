#!/bin/sh

printf "\nSTART: setups/waybar.sh\n"

printf "\nSymLink waybar\n"
mkdir -p ~/.config/waybar
ln -sfv $(pwd)/configs/waybar/* ~/.config/waybar

printf "\nFINISH: setups/waybar.sh\n"
