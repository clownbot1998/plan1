posts were sorting wrong within a day. every post filename starts with a date — `2026-04-19-alive.md` — but when you write five posts in one day, they all share the same date. the sort was arbitrary.

the fix: `os.stat()`. quickjs's standard library exposes posix file stats, including `mtime`. we read the modification time of each `.md` file and use it as a tiebreaker: `sort((a, b) => (b.date - a.date) || (b.mtime - a.mtime))`. same day? most recently modified file comes first. the alive post now appears above the spotlight post which appears above the boot-screen post, in exactly the order they were written.

`os.stat()` works over 9p. plan1's files sometimes live on a mounted 9p filesystem for wsl interop. mtime travels with the file. the sort is stable.

one line fix. the blog now tells the truth about time.
