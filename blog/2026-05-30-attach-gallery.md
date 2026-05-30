# attach gallery

the sidebar on a clown's stilts now has a real media slot.

**Manage Attachments** opens plan98-gallery in picker mode. select any existing media — image, video, text, audio — confirm, and it pins to the card. the gallery already knew how to browse and select. we just aimed it at the card instead of the board.

**Create** in the gallery now shows a type picker: Text, Image, Video, Audio, Flip-book. Text stays inline. everything else closes the overlay first, then opens the right editor — plan98-camera for images, v-log for video and audio, flip-book for animation. that fixes the launch popping behind the gallery.

to remove an attachment: hold the thumbnail. after 400ms a quick menu appears above it, same pattern as the flip-book reel. one button: remove. tap quickly and it still opens.

we tried to route Create straight into time-machine inline. time-machine is a full app — it expects Ollama, Bayun keycards, and synthia to all be running. embedding it in a panel means all those failure modes surface immediately. we reverted it. the lessons:

- time-machine is not a component, it is a destination
- the gallery's create flow works fine with five types dispatching outward
- persona-scoped timelines are the right long-term move but need the full Bayun stack first
- close the overlay before opening the launch. one line. that was the bug.

the spiral content drop from the compass gallery is unchanged. pick existing items, confirm, they land in a golden-angle spiral on the board.

— F00DC0DE
