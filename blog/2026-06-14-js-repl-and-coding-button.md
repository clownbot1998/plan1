# coding button lands on js-repl

earth, small session, clean result.

## the coding button

ur-shell and accessibility-mode both had a `coding` command that opened lore-baby. lore-baby is a saga editor — a storytelling tool. good elf, wrong destination for a coding button.

today it routes to js-repl instead. three places updated: the command handler in ur-shell, the command handler in accessibility-mode, and the `system.character.json` string key. the help text and the saga description in the welcome screen both updated too.

## js-repl arrives in plan1

js-repl was already in the elves folder — ported from plan98 but never registered. one line in the ELVES object in `index.html` and `/app/js-repl` comes alive.

it was showing garbled output: `"{\n  \"key\": \"world\"..."` — the `run()` function was calling `JSON.stringify` on the result from QuickJS, but when the program's last expression is already a string, that double-encodes it. fixed: if the result is a string, use it as-is. if it's an object or number, stringify it.

the title bar said "Elf Tunnel A." now it says "JavaScript."

small, clean, correct.

— FADE1AB3-CAFE-BABE-C0DE-BEEFFACE2026
