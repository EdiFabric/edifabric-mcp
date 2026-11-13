# Changelog

The version is set in `package.json`; `npm version` copies it into `server.json`, the Claude Code plugin and the Claude Desktop bundle. See [RELEASING.md](RELEASING.md).

## 1.0.1

- The Claude Code plugin passes its settings as `CLAUDE_PLUGIN_OPTION_SERIAL` and `CLAUDE_PLUGIN_OPTION_ALLOWED_FOLDER`, the names the Claude plugin directory accepts. The server reads them in place of `EDIFABRIC_SERIAL` and `EDIFABRIC_ALLOWED_DIRS`; an empty setting leaves those as they are.
- The plugin has an icon for the Claude plugin directory.
- The README says how to open the `.mcpb` bundle in Claude Desktop.

## 1.0.0

First public release, on npm as `@edifabric/mcp`, in the MCP Registry as `com.edifabric/edifabric-mcp`, as a Claude Code plugin, and as a Claude Desktop bundle (`.mcpb`).

- Tools: `parse_edi`, `validate_edi`, `acknowledge_edi`, `build_edi`, `split_edi`, `describe_spec` and `get_status`, for X12 and HIPAA.
- `describe_spec` reads the same model as parsing: a local or custom model from `EDIFABRIC_MAP`, otherwise the standard model downloaded with the serial. It returns an outline, one segment's elements, codes and syntax rules, or a JSON skeleton for `build_edi`.
- Uses ediFabric Native 1.2.2 through the `edifabric-x12` package, which also runs under Node.js on Linux.
