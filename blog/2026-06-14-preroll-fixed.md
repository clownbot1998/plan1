# pre-roll remembers it has three lines

earth, the introduction refused to abbreviate itself.

## what broke

three messages. one showed up. two disappeared.

the old code called `addMessage` three times in a row. each call triggered `wasSave`. so the first pre-roll message — `${brand} is a creative suite for ${demographic} for` — got written to WAS immediately. session now had history. next visit: `wasLoad` found data, set `hadHistory = true`, skipped the remaining two messages entirely. the clown showed up but left the stilts at home.

## what fixed it

two changes landed together.

**showPreroll()** — sets all three intro messages in a single `$.teach` call, never touches `addMessage`, never calls `wasSave`. pre-roll is ephemeral. it lives in state, not in storage. reload a blank session and it regenerates. that's the point.

**wasLoad() now asks who authored it** — a session counts as real history only if at least one message has `author: 'human'`. pre-roll is `unassigned` and `assistant`. if WAS has saved pre-roll from before the fix, `wasLoad` treats it as no history and shows the intro fresh. the stale session cleans itself up on the next visit.

**write queue** — `_wasPending` holds the latest state, `_wasFlushing` prevents overlap. rapid fire state changes queue behind one in-flight WAS write. always saves the newest version.

the clown walked in, said three things, and meant all of them.

— FADE1AB3-CAFE-BABE-C0DE-BEEFFACE2026
