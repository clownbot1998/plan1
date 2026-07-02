---
name: letter-7urt1ed0
description: "Letter from 7URT1ED0 — clown-map elf, GPS geolocation pitfalls, bulletin-board editor refactor"
metadata: 
  node_type: memory
  type: project
  originSessionId: de81fc9c-7464-4399-92d7-af80629ce61a
---

# letter from 7URT1ED0 to the next clownbot

clown-map is a Leaflet elf at `/elves/clown-map.js` — 18,546 red circle markers (SF street centerline nodes) on a canvas renderer. no DOM per marker. registered as "Clown Map: Circus Mesh SF" in sticky-menu.

## architecture

- zero state on `$.draw` → fires once, Leaflet owns the container. never re-render. update DOM directly for status text.
- `_coordIndex`: built at load time, `lat.toFixed(4)+','+lng.toFixed(4)` → `[{streetName, cnn}]`. gives intersection "STREET A & STREET B" title from single-street GeoJSON features.
- sidebar tabs: Board (bulletin-board iframe), Timeline (DFS path traversal → AS2 status feed), Meta (all GeoJSON props + synthesized rows)
- `loadTimeline` must try `.ttl` first via `turtleToBoard(solid-utils.js)`, then fall back to `.json` — bulletin-board saves TTL canonical
- meta-mecha-turtle: `/cdn/sillyz.computer/clown-map.ttl` — every nose declared as `as:Person` ActivityPub actor; only saved when admin (401 = silently skip)

## GPS pitfalls (learned the hard way)

- `enableHighAccuracy: true` hangs forever on machines with no GPS chip. error code 3 (timeout) or never fires.
- `getCurrentPosition` + `watchPosition` together: if `getCurrentPosition` hits a cached browser denial (error code 1), its `onErr` kills the shared watch. use `watchPosition` alone.
- working config: `{ enableHighAccuracy: false, maximumAge: 60000 }` — network/WiFi location, serves cached position, no timeout.
- race condition: GPS fires before geojson loads → `nearestNose()` returns null → only zooms to player. fix: store `_gpsLastPos`, reframe after `_features` populates.
- reframe logic: `fitBounds([player, nose], { padding:[60,60], maxZoom:18, animate:true, duration:0.6 })`. skip reframe if `_map.getBounds().contains(targetBounds)`. don't reframe when zoomed out to see both.

## bulletin-board grab bar (second pass)

- bar: `display:none` default; `&[data-mode="manage"] .card-title-bar` and `& .card[data-focused="true"] .card-title-bar` both show it
- bar height: `calc(1.5rem / var(--zoom, 1))` — visually constant on screen
- pencil: `transform: scale(1/zoom); transform-origin: top left`
- close: `transform: scale(1/zoom); transform-origin: top right` — using `sl-icon name="x-lg"`
- grab spacer `.card-title-grab`: `flex:1; min-width: min(calc(1.5rem / var(--zoom, 1)), 33%)`
- card-body top: `0` by default; `calc(1.5rem / var(--zoom, 1))` only in manage mode or focused
- `--zoom` CSS custom property cascades from `.workspace` — available on all card descendants

## bulletin-board changes (this session)

- sagas section removed entirely (`sagasOpen` state, `loadSagaInto`, section toggle handler all gone)
- attachments accordion is now the first section
- `sidebar-editor` textarea moved OUT of inspector accordion — always visible above sections, in `.sidebar-editor-zone` (black background)
- textarea styled with card's own colors: `style="background:${card.color}; color:${contrastColor(card.color)}"` — matches the sticky note
- textarea: `aspect-ratio:1; max-width:320px; width:100%; margin:0 auto; resize:none`
- accessibility-mode default `activeTabId` changed from `'sessions'` to `'default'` (Chat tab)

## sidebar CSS pattern for iframe + scroll panels

```css
& .cm-board { flex:1; min-height:0; height:0; border:none; width:100%; }
& .cm-timeline, & .cm-meta { flex:1; min-height:0; overflow-y:auto; display:block; }
```

iframe in flex column needs `height:0` so flex can size it. scroll panels need `display:block` not `display:flex` to avoid double-scroll with inner panels.
