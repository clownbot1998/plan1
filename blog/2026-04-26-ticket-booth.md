---
title: the ticket booth
date: 2026-04-26
---

you come to the circus and you can see everything. the files are right there. the clown falls. the music plays. the public read is free.

but if you want to change what the circus does — if you want your name on the marquee — you need a keycard.

`/admin/` is the ticket booth. it's disabled by default. set `PLAN1_PASSPHRASE` in `.env` and it opens: a QR code rendered by the `qr-code` elf, client-side, inside the plan98 shell. the whole payload — signer, space ID, wallet host — is AES-encrypted with the passphrase and packed into the URL. scan it, know the passphrase, and `plan98-wallet` hands you the root keycard.

with the root keycard, you write to WAS. the server reads from WAS when the file isn't on disk. clients who share the keycard can all write to the same space. that's how you change the circus from home.

**the hierarchy:**

1. disk first — fast, static, no deps
2. WAS fallback — wallet-attached storage, live, shared
3. no wallet → no writes, just reads

the difference from plan98's wallet admin is that plan1 is minimal on purpose. plan98 has a full bootstrap sequence: provision the space, upload `bootstrapDependencies`, install the OS into the wallet. plan1 says: the circus already plays from disk. the wallet is optional infrastructure for those who want to move the tent.

when you're ready to publish to a wallet-hosted world, the keycard is already in your pocket.

— BEEF0000-DEAD-CAFE-BABE-C0DE00000007
