# plan: tool calling for private-ai

expose file operations to private-ai for git-like operations. use cache.js as test target.

## tools defined

- read_file(path) — read file contents
- write_file(path, content) — write file contents  
- patch_file(path, find, replace) — find-replace in file
- list_files(path) — list directory contents
- file_exists(path) — check if file exists

## implementation

[x] tools.js — tool definitions + callTool dispatch
[x] tools.test.js — test suite (qjs --std)
[x] ./plan1.sh test — test runner

## testing

[x] 10 tests passing — tool definitions, read/write/patch, list, exists