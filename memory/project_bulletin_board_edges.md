---
name: project-bulletin-board-edges
description: Canon spec for bulletin-board relationship edges — types, colors, compass routing, modal UI
metadata:
  type: project
---

User explicitly marked this as canon (2026-05-24). High fidelity — do not dilute.

## Arrow / routing (clarified 2026-05-24)
- 8 compass exit points per card: N/S/E/W = edge midpoints, NW/NE/SE/SW = corners
- Each line connects to the nearest compass point on the target card (shortest distance)
- Arrow redraw debounced at **12fps while grabbing**, positions averaged over **250ms with ease-in-out** to smooth discrete steps. Snaps to correct position on drop.

## Relationship edge data model
- Default type: **"hyper"** — Ted Nelson bidirectional hyperlink. Applied automatically on drag-to-link.
- Types have a unique name → UUID + color mapping. "depends-on" is always the same UUID/color everywhere. No per-instance color variation for the same type name.
- Type is only explicitly set by the user when they want to; otherwise stays "hyper".
- Edge types stored in `edgeTypes: { [uuid]: { name, color } }` alongside `cards` in board state.

## Edge color
- plan98-palette is the color picker for edge types (same component, different context)

## Sidebar link behavior (changed)
- Clicking a linked node ref in the inspector opens a **plan98-modal** for that edge
- Does NOT navigate directly (old behavior removed)

## Edge modal contents
**Primary:**
- Both endpoint cards as card-form miniatures (rectangle + text + color)
- Edge between them: type name + color swatch
- "Go to node" buttons: close modal, pan to center card in the **left-hand visible portion** (viewport center offset left by sidebar width / 2), open sidebar for that card

**Secondary:**
- All **nodes** (not edges) that participate in at least one edge of this type — shown as card-form miniatures

## Pan behavior
- Center = `(viewport_width - sidebar_width) / 2` from left edge — sidebar-aware

## Why card form is canonical
"the colors their own form of organizational clarity" — rectangles with text + color are the user's organizational language. All node lists use card-form, not plain text.

**How to apply:** Full implementation scope is large. Break into: (1) compass routing + 12fps debounce, (2) edgeTypes data model + default "hyper", (3) edge modal UI.
