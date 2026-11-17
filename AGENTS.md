# AGENTS.md: ediFabric MCP server

Guidance for AI coding assistants that work in this repository. README.md covers installing and using the server.

## What this is

`@edifabric/mcp`, an MCP server (Node.js 18+, ES modules) that gives AI assistants EDI tools: `parse_edi`,
`validate_edi`, `acknowledge_edi`, `build_edi`, `split_edi`, `describe_spec` and `get_status`. It runs
ediFabric Native locally through the `edifabric-x12` package, so EDI files stay on the user's machine; tools read
and write files and return summaries rather than whole files.

## Layout

- `src/index.js`: the server entry point (`bin: edifabric-mcp`).
- `src/formats/`: one module per EDI format, registered in `src/formats/index.js`. X12 is `src/formats/x12/index.js`.
- `test/`: Node test runner tests; `test/fixtures` holds the sample model.
- `server.json`, `.claude-plugin/plugin.json` and `mcpb/manifest.json` carry the version; `npm version` syncs them.

## Commands

- `npm install`, then `npm test` (Node.js 22.9+ for `--env-file-if-exists`).
- Tests need a serial with quota left: put `EDIFABRIC_SERIAL=...` in `.env.local` (git ignores it). The demo
  serial `bd96a836feca45cb91c86ee65d281f52` works but has a small daily quota. `EDIFABRIC_ONLINE_TESTS=1` adds the tests that download models.
- `npm run inspect` opens the MCP Inspector against the server.

## Rules

- Keep tool names and input schemas stable: assistants and users' configs depend on them. Add optional inputs
  instead of renaming or removing.
- Licensing goes through `ensure_token` with `EDIFABRIC_SERIAL`, defaulting to the demo serial. Never log or return
  the serial in a tool result.
- When the quota is used up (error 639), return a short message that tells the user to sign up free for Community
  or upgrade at https://www.edifabric.com/pricing.html.
- A new format is a module with the same members as `src/formats/x12/index.js`, with its bindings package as an
  optional dependency (see README.md, Adding a format).
- Releases follow `RELEASING.md`. Don't publish to npm or the MCP Registry, or push tags, yourself.

## More

- Docs as markdown: https://www.edifabric.com/docs/edifabric-native/mcp-server.html.md
- ediFabric Native API: https://www.edifabric.com/docs/edifabric-native/introduction.html.md
