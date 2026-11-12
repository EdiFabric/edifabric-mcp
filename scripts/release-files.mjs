// The files that carry the server's version, which package.json owns. sync-version.mjs copies it into them and
// check-release.mjs checks they agree.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function readJson(file) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}

export function writeJson(file, value) {
    fs.writeFileSync(path.join(ROOT, file), JSON.stringify(value, null, 2) + '\n');
}

/** Each file, with how to read and set the version in it. */
export const VERSIONED = [
    {
        file: 'server.json',
        get: (json) => [json.version, ...json.packages.map((p) => p.version)],
        set: (json, version) => {
            json.version = version;
            for (const p of json.packages) p.version = version;
        },
    },
    { file: '.claude-plugin/plugin.json', get: (json) => [json.version], set: (json, version) => { json.version = version; } },
    { file: 'mcpb/manifest.json', get: (json) => [json.version], set: (json, version) => { json.version = version; } },
];
