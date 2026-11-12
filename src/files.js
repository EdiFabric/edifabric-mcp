// File access, limited to the folders the user allows.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EdiError } from './errors.js';

const MAX_INPUT_BYTES = 50 * 1024 * 1024;

/**
 * The folders the server may read and write, in this order of preference:
 * EDIFABRIC_ALLOWED_DIRS, then the roots the MCP client shares, then the user's home folder.
 */
export class AllowedFolders {
    constructor(env = process.env) {
        this.fromEnv = (env.EDIFABRIC_ALLOWED_DIRS || '')
            .split(path.delimiter)
            .map((d) => d.trim())
            .filter(Boolean)
            .map((d) => path.resolve(d));
        this.fromClient = null;
    }

    setClientRoots(roots) {
        this.fromClient = roots
            .map((root) => root.uri)
            .filter((uri) => uri && uri.startsWith('file:'))
            .map((uri) => path.resolve(fileURLToPath(uri)));
    }

    get folders() {
        if (this.fromEnv.length)
            return this.fromEnv;
        if (this.fromClient && this.fromClient.length)
            return this.fromClient;
        return [os.homedir()];
    }

    /** Resolves a path, relative paths against the first folder, and checks that it is inside an allowed folder. */
    resolve(filePath) {
        if (!filePath)
            throw new EdiError('A file path is required.', 'path');

        const folders = this.folders;
        const full = path.resolve(folders[0], filePath);
        const inside = folders.some((folder) => {
            const relative = path.relative(folder, full);
            return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
        });
        if (!inside)
            throw new EdiError(`${full} is outside the allowed folders: ${folders.join(', ')}. Set EDIFABRIC_ALLOWED_DIRS to allow another folder.`, 'path');

        return full;
    }
}

export async function readText(fullPath) {
    let stat;
    try {
        stat = await fs.stat(fullPath);
    } catch {
        throw new EdiError(`File not found: ${fullPath}`, 'not_found');
    }
    if (!stat.isFile())
        throw new EdiError(`Not a file: ${fullPath}`, 'not_found');
    if (stat.size > MAX_INPUT_BYTES)
        throw new EdiError(`${fullPath} is larger than 50 MB.`, 'too_large');
    return fs.readFile(fullPath, 'utf8');
}

/** Writes a file, refusing to replace an existing one unless overwrite is set. */
export async function writeText(fullPath, text, overwrite) {
    if (!overwrite) {
        try {
            await fs.access(fullPath);
            throw new EdiError(`${fullPath} already exists. Set overwrite to true to replace it, or choose another output path.`, 'exists');
        } catch (error) {
            if (error instanceof EdiError)
                throw error;
        }
    }
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, text, 'utf8');
    return fullPath;
}

/** A path next to the input, such as claims.837 -> claims.837.json. */
export function besideInput(inputPath, suffix) {
    return `${inputPath}${suffix}`;
}
