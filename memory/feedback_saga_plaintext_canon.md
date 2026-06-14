---
name: saga-plaintext-canon
description: "saga rune canon — @,"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: b289c6c0-9c81-450a-b9d2-9ad5f93eb1ad
---

Saga format canon (authoritative):
- `@` = actor/character cue
- `#` = context/section header
- `>` = dialogue line
- Everything else = plaintext — the saga renderer understands it without prefixes

**Why:** accessibility-mode is designed to be as plaintext as possible before saga rendering. Auto-wrapping system output with `> ` is wrong. Only actual dialogue gets `@` + `>`. System output (tty, status messages, command echoes) provides its own markup or is naked plaintext.

**How to apply in accessibility-mode:**
- `saga: true` → pass body through as-is (provides its own markup)
- `author: 'unassigned'` → `escapeHyperText(body)` (narration, plaintext)
- `author: 'human'` → `@ Me\n` + `> ` each line (dialogue)
- `author: 'assistant'` (conversational) → `@ Sagas\n` + `> ` each line (dialogue)
- `author: 'assistant', tty: true` → `escapeHyperText(body)` (plaintext terminal output)
- `author: 'assistant', system: true` → `escapeHyperText(body)` (plaintext system message)

Never auto-wrap tty output or system status in `> `. The saga renderer will handle display of plaintext correctly.
