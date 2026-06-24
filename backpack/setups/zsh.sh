#!/bin/sh

. ./helpers/safe_clone_pull.sh

printf "\nSTART: setups/zsh.sh\n"

printf "\nSymLink .zshrc\n"
ln -sfv $(pwd)/configs/.zshrc ~
source ~/.zshrc

printf "\nFINISH: setups/zsh.sh\n"
