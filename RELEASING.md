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

### 1. GitHub repository

- **Push access.** Push as an account with write access to `EdiFabric/edifabric-mcp`. A credential for another account makes git report "Repository not found".
- **Visibility:** Settings, General, Danger Zone, **Change visibility**, Public. npm only adds provenance for packages built from a public repository, so do this before the first release. Check the history first for anything that shouldn't be public; `.env.local` is ignored by git.
- **Actions:** Settings, Actions, General. Allow GitHub's actions and `sigstore/cosign-installer`, and keep **Workflow permissions** at read-only; the workflows ask for more where they need it.
- **Branch protection:** Settings, Rules, Rulesets, a ruleset for `main`. Block force pushes and deletion, and require the **CI** checks. The Claude Code plugin installs from `main`, so `main` must always be releasable.
- **Tag protection:** a second ruleset for tags matching `v*`. Only you may create or update them.

### 2. npm

`@edifabric/mcp` is published under the `edifabric` npm organization, like the `edifabric-x12` platform packages.

1. **Organization:** check that your npm account is an owner of the `edifabric` organization, under Organizations, edifabric, Members.
2. **Token for the first publish.** Trusted publishing can only be configured on a package that exists, so the first publish uses a token. On npmjs.com: your avatar, **Access Tokens**, **Generate New Token**, **Granular Access Token**:
   - Permissions: **Read and write**, for packages and scopes, scope `@edifabric`.
   - Expiration: 7 days.
   - Allow it to bypass two-factor authentication, or publishing from CI fails.
3. **Store the token** as the `NPM_TOKEN` secret of the `npm` environment (step 4).
4. **After the first release**, switch to trusted publishing:
   - On npmjs.com, open `@edifabric/mcp`, **Settings**, **Trusted Publisher**, **GitHub Actions**.
   - Organization `EdiFabric`, repository `edifabric-mcp`, workflow `release.yml`, environment `npm`.
   - In the same settings, under **Publishing access**, require two-factor authentication and disallow tokens.
   - Delete the `NPM_TOKEN` secret and revoke the token.

### 3. MCP Registry key

The registry name `com.edifabric/edifabric-mcp` is proven by a DNS record on edifabric.com, signed with a key only the release workflow has.

1. **Generate the key** in Git Bash. Its OpenSSL 1.1.1 supports Ed25519. Use a folder outside any repository:
   ```bash
   openssl genpkey -algorithm Ed25519 -out mcp-registry-key.pem
   echo "v=MCPv1; k=ed25519; p=$(openssl pkey -in mcp-registry-key.pem -pubout -outform DER | tail -c 32 | base64)"
   openssl pkey -in mcp-registry-key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n'
   ```
   The second command prints the DNS record, `v=MCPv1; k=ed25519; p=<44 characters>`. The third prints the private key as 64 hex characters.
2. **Add the DNS record** where edifabric.com's DNS is managed:
   - Type **TXT**, name **`@`** (edifabric.com itself, not `www` or another subdomain), value the whole `v=MCPv1; ...` line.
   - Add it as a new record. Leave the existing TXT records, such as Stripe's, as they are.
3. **Check it has propagated**, which can take minutes to hours:
   ```bash
   nslookup -type=TXT edifabric.com 8.8.8.8
   ```
4. **Store the private key** (the 64 hex characters) as the `MCP_PRIVATE_KEY` secret of the `mcp-registry` environment (step 4).
5. **Keep the `.pem` file** in your password manager, and delete it from disk. To rotate the key, repeat these steps and remove the old TXT record: the registry fails on a stale one.

### 4. GitHub environments

In the repository, Settings, **Environments**, **New environment**, create:

- **`npm`**, with secret `NPM_TOKEN` (until trusted publishing is on).
- **`mcp-registry`**, with secret `MCP_PRIVATE_KEY`.

For each one:
- Under **Deployment branches and tags**, choose **Selected branches and tags** and add the tag rule `v*`.
- Under **Required reviewers**, add yourself. Every publish then waits for your approval in the workflow run.

Secrets stored on an environment are only given to jobs that name it, which is what keeps the keys away from pull requests.

### 5. Test serial

Repository secret `EDIFABRIC_SERIAL`: a serial with quota, for the tests in CI. Settings, Secrets and variables, Actions, **New repository secret**. Without it, the tests use the demo serial and may run into its limits.

## Releasing a version

1. Update `CHANGELOG.md` with a `## <x.y.z>` entry, and commit it.
2. Run `npm version <x.y.z>`. It updates the version files, commits, and tags `v<x.y.z>`.
   If you set the version another way, run `npm run sync-version`, commit, and tag `v<x.y.z>` yourself.
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
