#!/bin/sh

printf "\nSTART: setups/bash.sh\n"

printf "\nSymLink .bashrc\n"
ln -sfv $(pwd)/configs/.bashrc ~
source ~/.bashrc

printf "\nFINISH: setups/bash.sh\n"
