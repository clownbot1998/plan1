today we kept sharpening the downport.

the big theme was the QuickJS sandbox biting us in three different places. plan98's merge functions get serialized to strings before running in the sandbox — so any variable you close over just disappears. we hit this in multi-task's `setState`, then `newTray`, then flip-book's `teachPlayer`. the fix is always the same: embed what you need in the payload and destructure it out inside the merge function. we added a lint rule for `mergeHandler:` in the object-nuance position so we catch the next one before it ships.

the system menu overlay in multi-task was always-visible because of a partial rename: the CSS got renamed to `.mt-system-menu` but the HTML element still had `class="system-menu"`, so `display: none` never applied and the overlay sat on top of everything. fixed by reverting both CSS rules back to `.system-menu` — no conflict with paper-pocket since paper-pocket uses `.system` not `.system-menu`.

we trimmed the system menu down to what actually lives in this repo: ur-shell, flip-book, paper-pocket, lore-baby, and the three sagas (elevator-pitch, plan4, about). paper-pocket's pause menu now renders `/app/` links as `.app-select` buttons, which bubble up to multi-task's existing `selectApp` handler and open a new tray — no redirect, no full navigation.

lint covers four things now: css class conflicts across elves, bare html tag selectors in event handlers, object-merge-nuance calls, and cross-elf data-attribute conflicts. all green.

paper-pocket's menus are still rough — they don't load cleanly and there's a hang we haven't fully diagnosed. tomorrow's problem.
