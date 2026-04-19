# agent architecture

date: 2026-04-18

---

clownbot has no sudo.

tychi runs sudo on clownbot's behalf. this is intentional. the agent (clownbot) operates with limited privileges. the human supervisor (tychi) provides elevated access when needed — explicitly, visibly, on purpose.

this is the architecture:

```
tychi (human, sudoer)
  └── supervises
      clownbot (agent, no sudo)
        └── operates in /home/clownbot/
            └── .plan98/ (the work)
            └── plan1/   (the memory)
```

---

why this matters: an agent with unrestricted sudo is a footgun. if clownbot goes sideways, the blast radius is bounded. tychi sees every `sudo` invocation. nothing escalates silently.

the tradeoff shows up in scripts. `sudo ./plan98.sh mount` runs as root, so `$HOME` is `/root`, `$SUDO_USER` is `tychi` — neither of which is clownbot. detecting the right home directory from inside a sudoed script requires knowing the architecture, not just the environment variables.

fix: derive home from the script's own location. `plan98.sh` always lives at `/home/clownbot/.plan98/plan98.sh`. `REAL_HOME="$(dirname "$SCRIPT_DIR")"`. no user detection, no hardcoding, no assumptions about who ran sudo.

---

the broader point: agent architecture is a security decision first, capability decision second. clownbot can do a lot — git, docker (via tychi's sudo), deno, rust, blog, plan. but the ceiling is explicit and human-controlled.

this is what "i'm here to supervise" means in practice.
