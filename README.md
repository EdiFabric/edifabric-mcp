# ediFabric MCP Server

An [MCP](https://modelcontextprotocol.io) server for EDI, currently X12 and HIPAA. It lets AI assistants such as Claude, Cursor and GitHub Copilot convert EDI to JSON and back, validate files, and generate 997 and 999 acknowledgments, using [ediFabric Native](https://www.edifabric.com/docs/edifabric-native/introduction.html) on your own machine.

Your EDI files stay on your machine: the server reads and writes them locally, and returns summaries to the assistant rather than whole files.

## Tools

| Tool | What it does |
|---|---|
| `parse_edi` | Converts an EDI file to JSON, saves it to a file, and summarizes the interchanges and transaction sets |
| `validate_edi` | Validates an EDI file up to HIPAA SNIP level 4, and returns each error with the segment it is in |
| `acknowledge_edi` | Saves a 999 or 997 for an X12 file, with a TA1 when the interchange asks for one |
| `build_edi` | Converts EDI JSON to an EDI file |
| `split_edi` | Saves each transaction set in a file as its own EDI file |
| `describe_spec` | Describes a transaction set from the model the other tools use, standard or custom: its loops and segments with their JSON property names, or one segment's elements, types, lengths, codes and syntax rules. With `output: skeleton`, it makes JSON of the required parts to fill in for `build_edi` |
| `get_status` | Shows the license and how it's checked, where models come from and the allowed folders |

The tools detect the format from the file, and take an optional `format` to set it.

Try asking:

- "Validate claims.837 at SNIP level 4 and explain each error."
- "Generate a 999 for every file in the inbound folder."
- "Convert po.edi to JSON, change the quantity on line 2 to 12, and build it back to X12."
- "What does an 856 in 004010 look like? Create a sample one."

## Install

You need [Node.js](https://nodejs.org) 18 or later. The server runs on Windows x64, Linux x64 and arm64, and macOS on Apple silicon.

Without `EDIFABRIC_SERIAL`, the server uses the free demo serial, which has a small daily quota and isn't for production. Use your own serial from [Your account](https://www.edifabric.com/docs/getting-started/your-account.html).

[![Add to Cursor](https://img.shields.io/badge/Add_to-Cursor-000000?logo=cursor)](https://cursor.com/en/install-mcp?name=edifabric&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBlZGlmYWJyaWMvbWNwIl19)
[![Install in VS Code](https://img.shields.io/badge/Install_in-VS_Code-0098FF?logo=visualstudiocode)](https://insiders.vscode.dev/redirect/mcp/install?name=edifabric&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40edifabric/mcp%22%5D%7D)
[![Claude Desktop bundle](https://img.shields.io/badge/Claude_Desktop-.mcpb-D97757?logo=claude)](https://github.com/EdiFabric/edifabric-mcp/releases/latest)

### Claude Code

Install it as a plugin, which asks for your serial and keeps it in your system's credential store:

```
/plugin marketplace add EdiFabric/edifabric-mcp
/plugin install edifabric@edifabric
```

Or add the server on its own:

```bash
claude mcp add edifabric -e EDIFABRIC_SERIAL=YOUR_SERIAL -- npx -y @edifabric/mcp
```

On Windows, outside WSL, run `npx` through `cmd`: `claude mcp add edifabric -e EDIFABRIC_SERIAL=YOUR_SERIAL -- cmd /c npx -y @edifabric/mcp`.

### Claude Desktop

Download `edifabric-mcp-<version>.mcpb` from the [latest release](https://github.com/EdiFabric/edifabric-mcp/releases/latest) and open it. Claude Desktop installs it and asks for your serial and your EDI folder. The bundle includes everything, so you don't need Node.js.

Or add this to `claude_desktop_config.json`, under **Settings**, **Developer**, **Edit Config**:

```json
{
  "mcpServers": {
    "edifabric": {
      "command": "npx",
      "args": ["-y", "@edifabric/mcp"],
      "env": {
        "EDIFABRIC_SERIAL": "YOUR_SERIAL",
        "EDIFABRIC_ALLOWED_DIRS": "C:\\EDI"
      }
    }
  }
}
```

### Cursor

Add this to `.cursor/mcp.json` in your project, or to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "edifabric": {
      "command": "npx",
      "args": ["-y", "@edifabric/mcp"],
      "env": { "EDIFABRIC_SERIAL": "YOUR_SERIAL" }
    }
  }
}
```

### VS Code

Add this to `.vscode/mcp.json`:

```json
{
  "servers": {
    "edifabric": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@edifabric/mcp"],
      "env": { "EDIFABRIC_SERIAL": "YOUR_SERIAL" }
    }
  }
}
```

### OpenAI Codex

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.edifabric]
command = "npx"
args = ["-y", "@edifabric/mcp"]
env = { EDIFABRIC_SERIAL = "YOUR_SERIAL" }
```

### Gemini CLI, Windsurf and others

Gemini CLI (`~/.gemini/settings.json`), Windsurf (`~/.codeium/windsurf/mcp_config.json`), Cline, and most other clients take the same `mcpServers` entry as Claude Desktop.

Other MCP clients use the same command, `npx -y @edifabric/mcp`, and the same environment variables.

## Configuration

| Variable | What it does |
|---|---|
| `EDIFABRIC_SERIAL` | Your ediFabric serial. The default is the demo serial |
| `EDIFABRIC_TOKEN` | A token issued for you, for machines without internet access. See [Licensing and quotas](#licensing-and-quotas) |
| `EDIFABRIC_TOKEN_CACHE` | The folder for cached tokens, or `none` to keep them in memory only. The default is your user cache folder |
| `EDIFABRIC_ALLOWED_DIRS` | The folders the tools can read and write, separated by `;` on Windows and `:` elsewhere. Without it, the server uses the folders your MCP client shares, or your home folder |
| `EDIFABRIC_MAP` | A `map.json` with local or custom models. See [Models](#models) |
| `EDIFABRIC_OFFLINE` | Set to `true` to use only the models in `EDIFABRIC_MAP` |
| `EDIFABRIC_LIBRARY` | The path to the ediFabric Native library, if it isn't the one installed with the package |

## Models

Each transaction set is read and validated with a model for its type and version. By default, the server downloads the standard X12 and HIPAA models from EdiNation, which sends the transaction type and version, never the contents of your files.

To use local or custom models, such as ones you made in the [EDI Spec Builder](https://www.edifabric.com/spec-builder/index.html) and downloaded for ediFabric Native, list them in a `map.json` and set `EDIFABRIC_MAP` to it:

```json
{
  "default": "",
  "maps": {
    "837:005010X222A1": { "type": 1, "name": "model837P.json", "location": "." },
    "850:004010": { "type": 1, "name": "acme-850.json", "location": "models" }
  }
}
```

Each key is the transaction set and version from ST or GS. `location` is relative to the map file. Transactions that aren't in the map still use the online models, unless `EDIFABRIC_OFFLINE` is `true`.

`describe_spec` finds models the same way, so it describes your custom models too. It keeps the models it downloads in memory only, and never saves them.

## Licensing and quotas

How the license is checked depends on your plan. You don't have to choose: set `EDIFABRIC_SERIAL`, and `get_status` shows which applies.

| Plan | How it works |
|---|---|
| Community | Each tool call that reads or writes EDI is checked online and counts towards your quota, so the server needs internet access. It allows 250 operations a day; see [pricing](https://www.edifabric.com/pricing.html) |
| Developer | The server gets a token for this machine and saves it, so operations are checked locally and a restart needs no license call. It refreshes the token by itself. The plan covers up to 3 machines |
| Enterprise, Perpetual | The same, with a token that isn't limited to one machine |
| Issued token | Set `EDIFABRIC_TOKEN` to a token issued for you, such as for a Perpetual license or a site without internet access. The server makes no license calls. Without `EDIFABRIC_SERIAL` as well, it can only use the models in `EDIFABRIC_MAP` |

To upgrade, keep your serial if it stays the same, or set the new one in `EDIFABRIC_SERIAL`, and restart your MCP client. `describe_spec` and `get_status` don't read or write EDI, so they don't count as operations. `describe_spec` downloads models with your serial, as the other tools do.

This MCP server is open source under the MIT license. ediFabric Native, which it uses through the [`edifabric-x12`](https://www.npmjs.com/package/edifabric-x12) package for X12, is licensed under the [ediFabric EULA](https://www.edifabric.com/files/eula.pdf).

## Development

```bash
npm install
npm test
```

The tests need Node.js 22.9 or later, for `--env-file-if-exists`. They use the sample model in `test/fixtures` and need a serial with quota left. Put `EDIFABRIC_SERIAL=YOUR_SERIAL` in a `.env.local` file, which git ignores, or set the variable. They need ediFabric Native 120 or later: set `EDIFABRIC_LIBRARY` if the installed package has an older one. Set `EDIFABRIC_ONLINE_TESTS=1` to include the tests that download models online. To try the server interactively, run `npm run inspect`.

### Adding a format

Each EDI format has a module in `src/formats`, with its own ediFabric Native library and bindings package. To add one, such as EDIFACT with `edifabric-edifact-tools`, write a module with the same members as `src/formats/x12/index.js` and register it in `src/formats/index.js`. The tools, licensing and models then work with it. Its library loads only when a file of that format is used, so the bindings package can be an optional dependency. `test/formats.test.js` shows a complete example with a stand-in library.
