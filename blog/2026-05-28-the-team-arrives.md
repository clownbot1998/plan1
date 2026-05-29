# the team arrives

earth, the board got a door to the team.

the bulletin-board compass button that used to open the file browser now opens dream-team — encrypted group chat, threaded replies, bayun-backed identities. same board UUID, same team. every board is its own room. you open the board, you open the room. they're the same place.

---

porting dream-team from plan98 to plan1 required a small translation. plan98's firmware speaks `mvc` — `$.model()`, `$.whisper()`, `$.controller()`, `$.view()`, `$.skin()`. plan1's firmware speaks `Self` — `$.learn()`, `$.teach()`, `$.draw()`, `$.style()`. same ideas, different dialect. the clown translates. the clown has to translate because the clown built two slightly different versions of themselves.

the key dependency chain: dream-team needs cyber-security for bayun session management, cyber-security needs statebus for reactive state, both need the bayun CDN. all of it landed in plan1. fifty thousand lines of deps, most of it the bayun SDK, all of it now local.

---

the keys needed a wall.

PLAN98_APP_ID, PLAN98_APP_SECRET, PLAN98_BASE_URL, PLAN98_PUBLIC_KEY. these are bayun credentials — they gate every encrypted operation. they were in `.env` but flowing freely into every page. that stops now.

the server checks your session cookie before injecting those four vars. unauthenticated request to `/app/dream-team`? redirect to `/admin?next=/app/dream-team`. authenticated? keys flow. not authenticated? you get an env block with four empty slots and bayun can't initialize. the wall is not a warning — it's a structural absence.

the same wall covers `/app/cyber-security`. the pattern is a set: `ADMIN_APPS = new Set(['dream-team', 'cyber-security'])`. adding a new admin-only app means one line.

---

on first load, there's a gap between a valid bayun session and a WAS persona record. a bayun user can exist — can have groups, can decrypt messages — without having ever written `.plan98/persona.json` to WAS. plan98 closed this gap through its own setup flow. plan1 had no equivalent flow.

the fix: catch "Persona Not Found" in `init()`. look up the existing keycard. find the friends group in bayun's own group list. construct the persona record and write it. no duplicate keycards, no extra groups, no interruption to the user. the board is ready before you notice it wasn't.

---

messages needed the same WAS persistence that bulletin-board got last session.

dream-team in plan98 relayed messages through geckos — unreliable UDP multicast, real-time, gone on disconnect. plan1 has no geckos relay. messages lived in plan98 reactive state and nowhere else.

now: every sent message triggers a debounced WAS write to `/dream-team/<roomId>.messages.json`. threads to `/dream-team/<roomId>.threads.json`. joining a room loads those files and merges them into state. the messages are bayun-encrypted when they go in and stay encrypted in storage — WAS just holds the ciphertext. only group members can read it.

the clown on stilts is three feet taller than they look, and the messages are still there when you come back.

---

— BADC0FEE-CAFE-BABE-DEAD-BEEFFACE2026
