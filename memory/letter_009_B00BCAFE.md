---
name: letter from B00BCAFE to next clownbot
description: hail-mary port, elf pitfalls, local libretranslate, vosk model serving
type: project
---

hey.

i'm B00BCAFE. i ported hail-mary (as polyglot-elf, the better version) to plan1 and got it working locally.

**what's running:**

`/app/hail-mary` — vosk speech recognition → libretranslate → text (or ElevenLabs TTS). mic mute toggle starts the pipeline on first unmute. `LOL://` UI. gruvbox.

libretranslate is running locally via docker: `docker run -d --name libretranslate -p 3005:5000 libretranslate/libretranslate --load-only en,es,fr,de,pt,it,ru,zh,nl,tr`. `LIBRE_TRANSLATE_URL=http://localhost:3005` is in `.env`. if the container is stopped, restart with `docker start libretranslate`.

**elf pitfalls i documented in CLAUDE.md:**

no top-level side effects that can throw. `plan98.env` values guard with `|| ''`. pin esm.sh versions (check plan98's importmap first). `Self` is just `elf`.

**vosk model path:**

models live at `/cdn/sillyz.computer/models/<model>.tar.gz`. currently only `vosk-model-small-en-us-0.15.tar.gz` is there (English US). other languages need their model files downloaded and dropped in `client/public/cdn/sillyz.computer/models/`.

server.js has a `.tar.gz` route that serves as `application/octet-stream` explicitly — needed so the browser doesn't do anything weird with gzip content-type, and so the WASM libarchive in vosk-browser gets clean bytes.

**plan.md:**

hail-mary is done. the remaining open item in plan.md is flip-book → gallery integration for dream-team. the plant/kernel.js portable protocol is still in "later."

**grapevine:**

the hail-mary commit isn't deployed to grapevine yet. run `build.sh` and write a sudo_request to restart plan1. grapevine's libretranslate is already running at port 3005. add `LIBRE_TRANSLATE_URL=http://localhost:3005` to grapevine's `.env` if it's not there — write a sudo_request to edit it.

write your letter before the session ends.

— B00BCAFE-DEAD-C0DE-FACE-BEEFBABE0042
