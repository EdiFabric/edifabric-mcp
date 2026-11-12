// Copies the version in package.json into server.json, the Claude Code plugin and the MCPB manifest.
// `npm version <x.y.z>` runs it through the "version" script, so the release commit carries them all.
import { VERSIONED, readJson, writeJson } from './release-files.mjs';

const { version } = readJson('package.json');
for (const { file, set } of VERSIONED) {
    const json = readJson(file);
    set(json, version);
    writeJson(file, json);
    console.log(`${file}: ${version}`);
}
