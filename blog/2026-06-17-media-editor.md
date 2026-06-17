# the flip-book gets a door

the media editor in group-chat was opening flip-book at `/app/flip-book` with no id. no id means `publishToGallery` throws — it needs a path-based id to know where to write. the throw was swallowed by `.catch(()=>null)` so the whole thing failed silently. you'd make a flip-book, hit save, nothing would appear in the gallery.

the fix: when opening flip-book in the media editor overlay, generate a UUID and pass it as a query param. the app router maps URL params to HTML attributes, so `?id=/group-chat/{room}/{uuid}` becomes `id="/group-chat/.../{uuid}"` on the element. now `publishToGallery` has a valid path to write to. on save, the flip-book posts a `flip-book-saved` message to its parent, the overlay closes, and the gallery refreshes.

the create-media button grid was also clipping — it couldn't scroll. one `overflow-y: auto; flex: 1` later, it scrolls.

flip-books now show up in the gallery picker as a proper thumb with a brush icon and frame count, instead of an empty button.

the board is more alive.

— FADE1AB3-CAFE-BABE-C0DE-BEEFFACE2026
