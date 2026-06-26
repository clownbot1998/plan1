---
name: project_plan98_env_live_keys
description: plan98-env.js is the live key store; migrate plan98.env.X reads to getEnv() so keys rotate without reload
metadata: 
  node_type: memory
  type: project
  originSessionId: de81fc9c-7464-4399-92d7-af80629ce61a
---

`client/public/elves/plan98-env.js` is the live key store (built 2026-06-24, sign-off FACEFEED). The server injects `plan98.env` once as a frozen snapshot in `<head>`; any elf that reads `plan98.env.X` at **module-load** captures it forever and can't see a rotated value.

plan98-env fixes that: captures server values as an immutable `baseEnv`, layers a localStorage override map (key `plan98-env-overrides`, per browser+origin, never sent to server), resolves **override → server → fallback** live on every read.

API: `getEnv(key, fallback)` (read fresh), `setEnv(key, val)` (persist + live-patch `plan98.env` + fire `plan98:env` event), `clearEnv(key)`, `onEnvChange(fn)` (subscribe → rebuild cached SDK clients on rotation). `<plan98-env>` element = end-user override UI (green=override, grey=env, red=unset; secrets masked). Eager-loaded in index.html before lazy elves so overrides merge into `plan98.env` first.

**Migration pattern:** replace `plan98.env.X` with `getEnv('X', default)`. For clients that cache a constructed instance (SDK wrappers), also `onEnvChange` and rebuild. Already migrated: `clownbot-agent` (ANTHROPIC_API_KEY), `hail-mary` (ELEVEN_LABS_API_KEY), `accessibility-mode` (via its dedicated config).

**Still snapshot at module-load (migrate next for full live-rotation):** `private-ai.js` (`OLLAMA_HOST`/`OLLAMA_KEY` → `envUrl`/`envKey` consts, lines ~7-8) and `cyber-security.js` (Bayun `PLAN98_APP_ID`/`SECRET`/`BASE_URL`/`PUBLIC_KEY`, lines ~26-31).

**accessibility-mode dedicated config** (server.js injects, agentChat prefers, then falls back to FALLBACK_LLM_* → OLLAMA_*): `ACCESSIBILITY_MODE_LOCK` (endpoint url = "the lock"), `ACCESSIBILITY_MODE_KEY` (the key that fits it), `ACCESSIBILITY_MODE_DEFAULT_MODEL`. In prod these are empty — user pastes creds live in the `<plan98-env>` panel.

Related: [[feedback_push_before_deploy]] [[project_plan1_architecture]]
