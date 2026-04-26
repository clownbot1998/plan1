# debugging_utilities/

Deno scripts for testing and maintaining the plan1 WAS (wallet-attached storage) integration.

All scripts read `.env` via `--env-file=.env` (note `=`, not space). Run from the repo root:

```sh
deno run --allow-net --allow-env --env-file=.env debugging_utilities/was_check.ts /plan98.js
```

## Scripts

### `was_check.ts`
Check if a resource exists in WAS and print its size.
```sh
deno run --allow-net --allow-env --env-file=.env debugging_utilities/was_check.ts /plan98.js
deno run --allow-net --allow-env --env-file=.env debugging_utilities/was_check.ts /elves/my-computer.js
```

### `was_bootstrap.ts`
Upload all bootstrap dependencies from the local server (localhost:1998) to WAS.
Idempotent — safe to re-run after a `./plan1.sh build`.
```sh
deno run --allow-net --allow-env --env-file=.env debugging_utilities/was_bootstrap.ts
deno run --allow-net --allow-env --env-file=.env debugging_utilities/was_bootstrap.ts --dry-run
```

### `was_put.ts`
Upload a single file to WAS, either from the local server or a local filesystem path.
```sh
# from localhost:1998
deno run --allow-net --allow-env --env-file=.env debugging_utilities/was_put.ts /plan98.js

# from local file
deno run --allow-net --allow-env --allow-read --env-file=.env debugging_utilities/was_put.ts /plan98.js dist/plan98.js
```

### `was_list_spaces.ts`
List WAS spaces owned by the current signer, or all spaces with `--all`.
```sh
deno run --allow-net --allow-env --env-file=.env debugging_utilities/was_list_spaces.ts
deno run --allow-net --allow-env --env-file=.env debugging_utilities/was_list_spaces.ts --all
```

## WAS URL pattern

The WAS server uses `/space/{uuid}/{resource-path}` (NOT `/space/{uuid}/resource/{path}`).

Unsigned reads return HTTP 500. Signed reads of missing resources return 404.
