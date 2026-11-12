// Builds dist/edifabric-mcp-<version>.mcpb, the one-click bundle for Claude Desktop. It holds the server, its
// dependencies, and the native libraries for every platform the bindings ship: ediFabric Native's and koffi's.
// npm installs only the current platform's, so the others are fetched with npm pack and unpacked beside them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { ROOT, readJson } from './release-files.mjs';

const PLATFORMS = ['win32-x64', 'linux-x64', 'linux-arm64', 'darwin-arm64'];
const MCPB_CLI = '@anthropic-ai/mcpb@2.1.2';

/** Runs a command and returns its output. Tried up to three times, as registry downloads sometimes drop. */
function run(command, args, cwd) {
    let result;
    for (let attempt = 1; attempt <= 3; attempt++) {
        // npm and npx are .cmd files on Windows, which only run through a shell.
        result = spawnSync(command, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', shell: process.platform === 'win32' });
        if (result.status === 0)
            return result.stdout.trim();
        console.warn(`${command} ${args.join(' ')} failed (attempt ${attempt})`);
    }
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
}

/**
 * Unpacks an npm tarball into a folder, without its top-level "package/" folder. In Node, as the tar commands of
 * Windows and of Git for Windows read paths differently.
 */
function unpack(tarball, target) {
    const data = zlib.gunzipSync(fs.readFileSync(tarball));
    const text = (start, length) => data.toString('utf8', start, start + length).replace(/\0.*$/s, '');
    for (let offset = 0; offset + 512 <= data.length;) {
        const name = text(offset, 100);
        if (!name)
            break;
        const prefix = text(offset + 345, 155);
        const size = parseInt(text(offset + 124, 12).trim() || '0', 8);
        const type = String.fromCharCode(data[offset + 156] || 48);
        const relative = (prefix ? `${prefix}/${name}` : name).split('/').slice(1).join('/');
        const file = path.join(target, relative);
        if (!file.startsWith(target + path.sep))
            throw new Error(`${tarball} has an entry outside its folder: ${relative}`);
        if (type === '0' || type === '\0') {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, data.subarray(offset + 512, offset + 512 + size));
        }
        offset += 512 + Math.ceil(size / 512) * 512;
    }
}

const { version } = readJson('package.json');
const build = path.join(ROOT, 'build', 'mcpb');
const dist = path.join(ROOT, 'dist');
fs.rmSync(build, { recursive: true, force: true });
fs.mkdirSync(build, { recursive: true });
fs.mkdirSync(dist, { recursive: true });

for (const item of ['src', 'package.json', 'package-lock.json', 'README.md', 'LICENSE.md'])
    fs.cpSync(path.join(ROOT, item), path.join(build, item), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'mcpb', 'manifest.json'), path.join(build, 'manifest.json'));

run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], build);

// The platform packages of each native dependency, at the versions the lockfile installed.
const lock = readJson('package-lock.json').packages;
const nativePackages = PLATFORMS.flatMap((platform) => [`@edifabric/x12-${platform}`, `@koromix/koffi-${platform}`]);
const packs = fs.mkdtempSync(path.join(os.tmpdir(), 'edifabric-mcpb-'));
for (const name of nativePackages) {
    const target = path.join(build, 'node_modules', ...name.split('/'));
    if (fs.existsSync(target))
        continue;
    const pinned = lock[`node_modules/${name}`]?.version;
    if (!pinned)
        throw new Error(`${name} isn't in package-lock.json.`);
    const tarball = run('npm', ['pack', `${name}@${pinned}`, '--pack-destination', packs, '--silent'], build).split(/\r?\n/).pop();
    fs.mkdirSync(target, { recursive: true });
    unpack(path.join(packs, tarball), target);
    console.log(`Added ${name}@${pinned}`);
}
fs.rmSync(packs, { recursive: true, force: true });

const output = path.join(dist, `edifabric-mcp-${version}.mcpb`);
run('npx', ['--yes', MCPB_CLI, 'validate', path.join(build, 'manifest.json')], ROOT);
run('npx', ['--yes', MCPB_CLI, 'pack', build, output], ROOT);
console.log(`Built ${path.relative(ROOT, output)} (${(fs.statSync(output).size / 1048576).toFixed(1)} MB)`);
