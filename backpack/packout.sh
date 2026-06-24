#!/bin/sh

printf "\nCleaning up the unpacked Backpack\n"

printf "\nDelete vim plugins\n"
rm -rf ~/.vim/plugged # Delete vim-plug plugins
rm -rf ~/.tmux/plugins # Delete tpm plugins

rm -rf ~/.config/kitty
rm -rf ~/.config/waybar
rm -rf ~/.config/sway/definitions.d
rm -rf ~/.gitconfig
rm -rf ~/.gitignore
rm -rf ~/.vimrc
rm -rf ~/.tmux.conf
rm -rf ~/.zshrc
