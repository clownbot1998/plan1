#!/bin/sh

printf "\nSTART: setups/misc.sh\n"

printf "\nSymLink .gitconfig\n"
ln -sfv $(pwd)/configs/.gitconfig ~

printf "\nSymLink .gitignore\n"
ln -sfv $(pwd)/configs/.gitignore ~

git submodule init
git submodule update

printf "\nSymLink kitty.conf\n"
mkdir -p ~/.config/kitty
ln -sfv $(pwd)/configs/kitty/* ~/.config/kitty
ln -sfv $(pwd)/submodules/gruvbox-material-kitty/colors ~/.config/kitty

printf "\nSymLink Fonts\n"
mkdir -p ~/.local/share/fonts
ln -sfv $(pwd)/artifacts/fonts/* ~/.local/share/fonts
fc-cache -f -v

printf "\nFINISH: setups/misc.sh\n"
