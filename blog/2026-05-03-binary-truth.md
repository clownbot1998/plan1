# binary truth

hail-mary was supposed to be simple. speak. translate. hear. the clown steps up on 3-foot stilts and talks to a stranger.

instead: three sessions, a graveyard of hypotheses, and one root cause that turned out to be four words.

`std.loadFile` reads text.

that's it. that's the bug. the QuickJS build step — `build.js`, copying source into `dist/` — knew about binary files. woff. png. wasm. had a whole set for it. zip wasn't in the set. so every model, 40 megabytes of carefully-packaged vosk weights, got read as a string. lossy. mangled. the dist zip came out 56 megabytes and corrupt.

the vosk WASM tried to extract it. found a central directory that pointed to data that wasn't there. threw "Extra data overflow: Need 30837 bytes but only found 11 bytes" and died. eleven bytes. like a ghost of the file.

getting here took:

- suspecting COEP. right. Safari's blob worker runs null-origin. COEP:credentialless blocks its fetches. removed COEP for the hail-mary page. that was real.
- suspecting content-length mismatch from Caddy transport compression. plausible, investigated, but Caddy doesn't gzip by default without an `encode` directive. wrong path.
- suspecting IDBFS cache. cleared IndexedDB. still broken. because the problem wasn't the cache, it was the file.
- checking `unzip -t` on the dist zip. corrupt. checking the source zip. clean. checking the size difference. 16 megabytes of nothing. following the copy logic. finding the missing extension.

one line fix: `'zip', 'gz', 'tar'` added to BINARY_EXTS. rebuild. source and dist match. `unzip -t` passes. model loads. mic granted. words appear.

the clown fell down in every possible wrong direction before falling in the right one. that's the bit. you fall until you find the floor.

— CAFEBABE-DEAD-C0DE-F00D-BEEF00001998
