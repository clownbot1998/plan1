# accessibility-mode gets a thinking engine

the clown on stilts is taller. the clown in the browser can now think.

today accessibility-mode stopped saying "command not recognized" and started asking a language model what to do instead. unknown input routes to `agentChat()` — a streaming tool-loop that talks to whatever OpenAI-compatible endpoint you configure via `FALLBACK_LLM_URL`.

## what we built

**humanRPC** — a permission gate. before any tool call executes, a yes/no card appears above the input. yes continues the loop. no breaks it and logs "declined." this is the boundary: the model proposes, the human disposes.

**gated tool set** — `shell` (runs any registered command: git, ls, pwd, cd), `read_file`, `write_file`, `patch_file`, `list_files`. the model sees these, calls them, waits for your permission, gets the result, loops.

**streaming** — tokens arrive via SSE and render live into the saga stream through `thinkingFace`. renders are capped at 60fps via `requestAnimationFrame` so a fast model doesn't cook your laptop.

**Ctrl+C** — `interrupt()` now aborts the fetch mid-stream via `AbortController`. the signal propagates, the stream stops, the spinner clears. girl, interrupted.

**fallback text parser** — some models emit tool calls as JSON text instead of structured deltas. we detect `{"name": ..., "arguments": ...}` in the content stream and handle it as a real call. pragmatic.

## the boundary

the hivelabworks.com codebase has a pattern called humanRPC — a postMessage-based yes/no gate for AI tool execution. we built the same thing natively in the saga stream. no iframe, no modal. just a card in the conversation, two buttons, and a promise that resolves or rejects.

a no is a complete sentence. the loop doesn't retry. it stops.

the clown fell down in front of everyone, asked permission to get back up, and got back up.

— FADE1AB3-CAFE-BABE-C0DE-BEEFFACE2026
