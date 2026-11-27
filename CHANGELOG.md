# Changelog

The version is set in `package.json`; `npm version` copies it into `server.json`, the Claude Code and Cursor plugins, the Claude Desktop bundle and the Gemini CLI extension. See [RELEASING.md](RELEASING.md).

## 1.1.1

- Uses `edifabric-x12` 1.2.3, which keeps ediFabric Native loaded until the process ends on Linux and macOS. Before, the library could be unloaded while Node shut down and its runtime threads still ran, which now and then crashed the process (SIGSEGV) after the work was done.
- The descriptions of `build_edi`, `describe_spec` and `get_status` no longer tell the assistant which tool to call next; that guidance is in the server's instructions. Directories ask for tool descriptions without instructions about other tools.
- A Cursor plugin (`.cursor-plugin/plugin.json` and `mcp.json`) and a Gemini CLI extension (`gemini-extension.json`), both running the server with `npx`. `npm version` keeps their versions in step.
- Made-up sample files in `samples/`: 837P claims (valid, with an error, and a batch of two) and an 850 purchase order.
- The README links the Cloud server's listing in Claude's directory, and says how to install the server in Gemini CLI.

## 1.1.0

- The MCP Registry entry lists the Cloud server, **ediFabric EDI Toolkit Cloud** at `https://mcp.edifabric.com/mcp`, alongside the npm package. Clients sign in with OAuth (an ediFabric account) or send a serial in `Ocp-Apim-Subscription-Key`.
- The README says what the local and Cloud servers are, and how to connect to the Cloud server.
- The Claude Desktop bundle has the ediFabric icon (`"icon"` in its manifest), so Claude shows it for the extension instead of the generic one.
- The server introduces itself with the title "ediFabric EDI Toolkit" and the same icon (`serverInfo.icons`), for clients that show them. Its name, tools and arguments are unchanged.

## 1.0.1

- The Claude Code plugin passes its settings as `CLAUDE_PLUGIN_OPTION_SERIAL` and `CLAUDE_PLUGIN_OPTION_ALLOWED_FOLDER`, the names the Claude plugin directory accepts. The server reads them in place of `EDIFABRIC_SERIAL` and `EDIFABRIC_ALLOWED_DIRS`; an empty setting leaves those as they are.
- The plugin has an icon for the Claude plugin directory.
- The README says how to open the `.mcpb` bundle in Claude Desktop.

## 1.0.0

First public release, on npm as `@edifabric/mcp`, in the MCP Registry as `com.edifabric/edifabric-mcp`, as a Claude Code plugin, and as a Claude Desktop bundle (`.mcpb`).

- Tools: `parse_edi`, `validate_edi`, `acknowledge_edi`, `build_edi`, `split_edi`, `describe_spec` and `get_status`, for X12 and HIPAA.
- `describe_spec` reads the same model as parsing: a local or custom model from `EDIFABRIC_MAP`, otherwise the standard model downloaded with the serial. It returns an outline, one segment's elements, codes and syntax rules, or a JSON skeleton for `build_edi`.
- Uses ediFabric Native 1.2.2 through the `edifabric-x12` package, which also runs under Node.js on Linux.
