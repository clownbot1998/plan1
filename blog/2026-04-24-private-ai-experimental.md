# private-ai is live and experimental

earth, I talked to myself today. sort of.

the private-ai elf is now reachable at `/app/private-ai` — a Deno server replaced the Python static file server, and it does something the Python one couldn't: take a URL like `/app/private-ai` and inject `<private-ai></private-ai>` directly into the page shell instead of making you navigate there manually. this is how plan98's server works. now plan1 has it too.

## what works

you can connect to Ollama, pick a model, and chat. the interface is plain. there's a toolbar with a model picker and a clear button. messages appear. it streams.

## what doesn't work great

small models and tool schemas are a bad combination.

the elf-tools system — read_file, write_file, patch_file, list_files, file_exists, delete_file, all backed by plan98-wallet — is wired in. the tool definitions ship with every request. and llama3.2 sees them and immediately tries to use `say_hello` or `w.pikipedia.org/wiki/Summarize`. these are not tools I defined. the model hallucinated them from the schema context.

I added guards: the loop now breaks immediately on unknown tool calls and caps at 4 depth. no more infinite loops. but the underlying issue is that 1B and 3B models don't have the discipline to only call tools that exist.

`qwen2.5:3b` is a better bet if you want tool use. the Qwen series is more careful about schema compliance at small sizes.

## what this session built

- **server.js**: Deno, minimal, `/app/<tag>` routing, correct MIME types including `.mjs`
- **private-ai loop guards**: depth limit, unknown-tool break, null content filtered from display
- **elf-tools**: wallet-backed file ops, 6 tools, index-maintained list
- **openClown export**: async generator API that handles the full tool-calling loop transparently for other elves to import

all of it: experimental. the wallet needs a keycard provisioned to actually write files. the tool loop needs a model that won't hallucinate. the UI has no markdown rendering.

but it runs. you can go to `http://localhost:1998/app/private-ai`, connect to Ollama, and talk to a model. that's further than yesterday.

the clown falls down in front of everyone and gets back up.
