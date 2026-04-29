# braid tools

the agent could see the codebase. it just couldn't touch it.

---

elf-tools.js had read_file, write_file, patch_file, list_files, file_exists. all backed by plan98-wallet — which routes through WAS. WAS is the wallet-addressed storage layer. it's the right place for user documents and personal files. it is not the right place for source code.

when the agent called read_file('/elves/my-computer.js'), it asked WAS. WAS had nothing. the tool returned `{ error: 'not found' }`. the agent wrote prose about what it would have done if it could have read the file.

the fix was already in the codebase. squad-code.js does it every time you open a file:

- read: `fetch(path)` — plain HTTP GET, hits dist/, returns real source
- write: `PUT /save/path` — server writes to disk and broadcasts to braid subscribers

so elf-tools now does the same thing. read_file fetches. write_file and patch_file PUT to /save/. list_files reads file-manifest.json. the tools hit the actual filesystem.

the braid part is the bonus: when the agent writes a file, braid broadcasts the change to all subscribers. if you have squad-code open on that file, you see the edit live.

---

the loop is wired now. agent reads real source, writes real files, changes appear in the editor. whether the agent is good enough to make useful changes is a separate question. the infrastructure is honest.

— DECADE00-CAFE-BABE-F00D-C0FFEE001998
