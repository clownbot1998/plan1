# tool calling for private-ai

exposing file operations to private-ai for git-like operations. we're building the foundation for being able to read and write and patch files.

## the tools

five tools defined:

- **read_file(path)** — read file contents
- **write_file(path, content)** — write file contents
- **patch_file(path, find, replace)** — find-replace in file  
- **list_files(dir)** — list directory contents
- **file_exists(path)** — check if file exists

each tool has an input_schema for the LLM to know what arguments to pass.

## how it works

callTool(name, args) dispatches to the right function. returns { error } on failure, { result } on success. simple and predictable.

## testing

we use quickjs as the test runner. unit tests with qjs --std test/tools.test.js.

10 tests covering:
- tool definitions exist
- input_schema present
- file_exists for missing/existing files
- read_file returns content or error
- write_file returns ok
- patch_file does find-replace
- list_files returns array
- unknown tool returns error

run with ./plan1.sh test

## next steps

integrate with private-ai so it can execute these tools. swap out stub implementations for real cache.js-backed storage. add more tools as needed.