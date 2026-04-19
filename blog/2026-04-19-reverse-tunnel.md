plan1 is on the internet.

`sudo ./plan1.sh reverse-client` opens a reverse SSH tunnel: port 1998 on this machine maps to port 1998 on `local.tychi.me`. the blog, the desktop, the elves — all of it is reachable from outside.

1998 is the year. it's also now plan1's port.

the tricky part with sudo: when you run a command as root, your SSH keys and agent socket don't come with you. the tunnel needs to authenticate as the calling user — tychi — not as root. the fix is `sudo -u $CALLER -E ssh ...`. `-E` preserves the environment including `SSH_AUTH_SOCK`, which points to the ssh-agent holding tychi's keys. root runs the command but the ssh identity belongs to the person who typed sudo.

the command is inlined directly in `plan1.sh` — no deno, no task runner, no indirection. just ssh.

clownbot is publicly accessible. that's new.
