# .bashrc

# Source global definitions
if [ -f /etc/bashrc ]; then
    . /etc/bashrc
fi

# User specific environment
if ! [[ "$PATH" =~ "$HOME/.local/bin:$HOME/bin:" ]]; then
    PATH="$HOME/.local/bin:$HOME/bin:$PATH"
fi
export PATH

# Uncomment the following line if you don't like systemctl's auto-paging feature:
# export SYSTEMD_PAGER=

# User specific aliases and functions
if [ -d ~/.bashrc.d ]; then
    for rc in ~/.bashrc.d/*; do
        if [ -f "$rc" ]; then
            . "$rc"
        fi
    done
fi
unset rc

PS1='\u@\h:\w$ '
echo $PS1
alias sillyz="APPIMAGE_DISABLE=true ~/Applications/sillyz.AppImage"
alias p1='/home/clownbot/plan1/plan1.sh'

export DENO_INSTALL="$HOME/.deno"
export SILLONIOUS_INSTALL="$HOME/.sillonious"
export POCKETBASE_INSTALL="$HOME/.pocketbase"
export QT_QPA_PLATFORM=xcb

export PATH="$DENO_INSTALL/bin:$PATH"
export PATH="$SILLONIOUS_INSTALL/bin:$PATH"
export PATH="$POCKETBASE_INSTALL/bin:$PATH"
export PATH="$HOME/bin:$PATH"

echo $PATH

source $HOME/.cargo/env

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion


# Added by Radicle.
export PATH="$PATH:$HOME/.radicle/bin"
. "$HOME/.cargo/env"

export PATH=$PATH:/usr/local/go/bin

# If running from tty1, start sway
if [ "$(tty)" = "/dev/tty1" ]; then
  exec sway
fi

# opencode
export PATH=/home/clownbot/.opencode/bin:$PATH

# plan1
alias p1='/home/clownbot/plan1/plan1.sh'
/home/clownbot/plan1/plan1.sh serve > /dev/null 2>&1
/home/clownbot/plan1/plan1.sh watch > /dev/null 2>&1
