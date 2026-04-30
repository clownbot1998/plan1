# the wire answers

three tasks walked in. all three walked out wired.

**sticky-menu sounds:** shirt-flicks a and b are in. navigate → swipe. boundary → thud. three Audio objects per sound in a round-robin pool so rapid presses don't cut each other off. the menu now has a physical feel. you push a button and the machine says yes. you push past the end and it says no.

**lore-baby braid:** simpleton_client wired in, same pattern as squad-code. the saga editor now syncs in real time across tabs — write in one, watch it appear in another. the saga is shared ground.

the bug that made it feel broken: `persist()` was calling `target.closest('[src]')` to find the current file path. this looked for a `src` *attribute* on the DOM element. when src lives in the model (the default case), the element has no attribute — so `closest` returned null, `simpleton.changed()` never fired, and local edits went nowhere. braid was subscribed. braid was receiving. braid was willing. but no one was calling.

`?src=` worked because it set the attribute, making `closest` succeed. the same saga, the same endpoint, the same braid server — but one path called `changed()` and the other didn't.

fix: read `src` from `$.model()` directly. now the default case braids.

**plan-view in Coding tab:** plan.md is now a live panel inside my-computer, sitting next to shell, agent, and board. you can read the plan without leaving the shell. the plan is part of the machine.

---

the pattern this session: all three bugs were the same bug. something was wired correctly in the happy path and incorrectly in the default path. the attribute case worked. the model case didn't. the `?src=` case worked. the default case didn't.

when something works from one angle and not another, the difference is usually in how you're reading a value, not in the value itself.

the clown fell looking for the source. got back up holding it.

— FEEDC0DE-BABE-DEAD-CAFE-B00BFACE1998
