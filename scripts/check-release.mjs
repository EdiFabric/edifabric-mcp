// Checks that everything a release publishes agrees: the version in every file, the release tag, the npm package
// and the MCP Registry name, the CHANGELOG entry, and the registry's limits.
//
//   node scripts/check-release.mjs [--tag v1.2.3]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, VERSIONED, readJson } from './release-files.mjs';

const problems = [];
const pkg = readJson('package.json');
const { version } = pkg;

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version))
    problems.push(`package.json version ${version} isn't semantic (x.y.z or x.y.z-pre).`);

for (const { file, get } of VERSIONED) {
    for (const found of get(readJson(file))) {
        if (found !== version)
            problems.push(`${file} has version ${found}, package.json has ${version}. Run npm run sync-version.`);
    }
}

const tagIndex = process.argv.indexOf('--tag');
if (tagIndex > 0) {
    const tag = process.argv[tagIndex + 1] || '';
    if (tag !== `v${version}`)
        problems.push(`The release tag ${tag} doesn't match the version: it must be v${version}.`);
}

const server = readJson('server.json');
if (server.name !== pkg.mcpName)
    problems.push(`server.json name ${server.name} must equal package.json mcpName ${pkg.mcpName}, or the registry refuses it.`);
for (const p of server.packages.filter((p) => p.registryType === 'npm')) {
    if (p.identifier !== pkg.name)
        problems.push(`server.json package ${p.identifier} must equal the npm package ${pkg.name}.`);
}
if (server.description.length > 100)
    problems.push(`server.json description is ${server.description.length} characters; the registry allows 100.`);

const changelog = path.join(ROOT, 'CHANGELOG.md');
if (fs.existsSync(changelog) && !new RegExp(`^## \\[?${version.replace(/\./g, '\\.')}\\]?( |$)`, 'm').test(fs.readFileSync(changelog, 'utf8')))
    problems.push(`CHANGELOG.md has no "## ${version}" entry.`);

if (problems.length) {
    console.error(problems.map((p) => `- ${p}`).join('\n'));
    process.exit(1);
}
console.log(`Release ${version} is consistent.`);
