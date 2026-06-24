#!/bin/sh

. ./helpers/safe_clone_pull.sh

printf "\nSTART: setups/plan98.sh\n"


printf "\nClone Plan98\n"
#safe_clone_pull https://github.com/tylerchilds/plan98 ~/.plan98
#cd ~/.plan98 && ./provision.sh && cd -

printf "\nsystemd Plan98\n"
mkdir -p ~/.config/systemd/user

printf "\nSymLink Plan98\n"
ln -sfv $(pwd)/configs/systemd/user/plan98.service ~/.config/systemd/user/plan98.service
systemctl --user daemon-reload
systemctl --user enable plan98
loginctl enable-linger "$(whoami)"

printf "\nFINISH: setups/plan98.sh\n"

printf "\nPlan98 is ready, reboot now to enjoy.\n"

