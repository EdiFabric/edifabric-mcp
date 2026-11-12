# Releasing

## Versions

The server's version lives in **`package.json`**. Everything else copies it:

| File | What it's for |
|---|---|
| `package.json` | The npm package `@edifabric/mcp`, and the version the server reports to MCP clients (`src/server.js` reads it) |
| `server.json` | The MCP Registry entry `com.edifabric/edifabric-mcp`: `version` and `packages[].version` |
| `.claude-plugin/plugin.json` | The Claude Code plugin. Users get an update only when this version changes |
| `mcpb/manifest.json` | The Claude Desktop bundle |
| `CHANGELOG.md` | One `## <version>` entry per release |

`npm version <x.y.z>` sets `package.json`, runs `scripts/sync-version.mjs` to copy the version into the other three files, and commits and tags the result as `v<x.y.z>`. `scripts/check-release.mjs` fails the release if any of them disagree, if the tag doesn't match, or if the changelog has no entry.

The version is semantic and independent of ediFabric Native's (the `edifabric-x12` dependency):

- **Major**: a tool is removed or renamed, or its arguments or output change in a way that breaks existing prompts or clients.
- **Minor**: a new tool, format (such as EDIFACT) or option.
- **Patch**: fixes, and a new `edifabric-x12` patch.

Every published version is final: npm and the MCP Registry refuse to publish the same version twice.

## One-time setup

1. **GitHub repository**: make `EdiFabric/edifabric-mcp` public.
2. **npm**: `@edifabric/mcp` is published under the `edifabric` npm organization, like the bindings. Until the first publish, the workflow uses the `NPM_TOKEN` secret. After it, configure [trusted publishing](https://docs.npmjs.com/trusted-publishers) for `@edifabric/mcp` (repository `EdiFabric/edifabric-mcp`, workflow `release.yml`, environment `npm`) and delete the token.
3. **MCP Registry key**: the name `com.edifabric/...` is proven with a DNS record on edifabric.com.
   ```bash
   openssl genpkey -algorithm Ed25519 -out mcp-registry-key.pem
   echo "v=MCPv1; k=ed25519; p=$(openssl pkey -in mcp-registry-key.pem -pubout -outform DER | tail -c 32 | base64)"
   openssl pkey -in mcp-registry-key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n'
   ```
   Add the first output as a **TXT record on `edifabric.com` itself** (the apex, not a subdomain). Store the second output, the private key in hex, as the `MCP_PRIVATE_KEY` secret. Keep the `.pem` file offline, or delete it.
4. **GitHub environments** (Settings, Environments):
   - `npm`: secret `NPM_TOKEN` until trusted publishing is on.
   - `mcp-registry`: secret `MCP_PRIVATE_KEY`.
   For both, allow only `v*` tags and add yourself as a required reviewer, so every publish waits for your approval.
5. **Repository secret** `EDIFABRIC_SERIAL`: a serial with quota for the tests. Without it they use the demo serial.

## Releasing a version

1. Update `CHANGELOG.md` with a `## <x.y.z>` entry, and commit it.
2. Run `npm version <x.y.z>`. It updates the version files, commits, and tags `v<x.y.z>`.
3. Push: `git push --follow-tags`.
4. Create a GitHub release from the tag, with the changelog entry as its notes.
5. Approve the `npm` and `mcp-registry` deployments when the **Release** workflow asks.

The workflow then:

1. Checks the version, tag, names and changelog agree.
2. Runs the tests on Windows, Linux x64 and arm64, and macOS.
3. Packs the npm package and builds the Claude Desktop bundle, with the native libraries for all four platforms.
4. Publishes `@edifabric/mcp` to npm with provenance.
5. Attaches `edifabric-mcp-<x.y.z>.mcpb` to the GitHub release.
6. Waits for npm to serve the version, then publishes `server.json` to the MCP Registry.

The Claude Code plugin needs no step: it installs from the default branch, and users get the new version because `plugin.json` changed. Push the release commit to `main` only when it's ready to publish.

To check a release without publishing anything, run the **Release** workflow by hand with **dry-run** on.

## After a release

- Check https://www.npmjs.com/package/@edifabric/mcp and `https://registry.modelcontextprotocol.io/v0/servers?search=com.edifabric`.
- Install from each channel once: `npx -y @edifabric/mcp`, the plugin, and the `.mcpb`.
- Directories that read the MCP Registry, such as the GitHub MCP Registry and VS Code's MCP gallery, pick the new version up on their own.

## If something fails

- **A step failed after npm published**: rerun the workflow. The npm step skips a version that's already published.
- **The registry says the package isn't on npm**: npm can take a few minutes; rerun the `registry` job.
- **The registry refuses the DNS login**: check the TXT record is on the apex with `nslookup -type=TXT edifabric.com`, and that there's only one `v=MCPv1` record.
- **A version went out broken**: publish a new patch version. Use `npm deprecate @edifabric/mcp@<x.y.z> "<reason>"` for the bad one; the registry can't change a published version either.
