#!/bin/sh

. ./helpers/safe_clone_pull.sh

printf "\nSTART: setups/sillonious.sh\n"


printf "\nClone Sillonious\n"
safe_clone_pull https://github.com/tylerchilds/kickstart ~/.sillonious

printf "\nsystemd Sillonious\n"
mkdir -p ~/.config/systemd/user

printf "\nSymLink Sillonious\n"
ln -sfv $(pwd)/configs/systemd/user/sillonious.service ~/.config/systemd/user/sillonious.service
systemctl --user daemon-reload
systemctl --user enable sillonious
loginctl enable-linger "$(whoami)"

printf "\nFINISH: setups/sillonious.sh\n"

printf "\nSillionious is ready, reboot now to enjoy.\n"

