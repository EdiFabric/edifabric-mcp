// A connected client and a temporary folder of sample files for each test file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Copies the sample files into a new temporary folder, which the server is limited to. */
export function makeWorkFolder() {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'edifabric-mcp-'));
    for (const name of ['837p.txt', '837p_error.txt', '837p_two.txt'])
        fs.copyFileSync(path.join(FIXTURES, name), path.join(folder, name));
    return folder;
}

/** Sets up the environment before the server modules load, as they read it once. */
export function useEnvironment(folder) {
    process.env.EDIFABRIC_ALLOWED_DIRS = folder;
    process.env.EDIFABRIC_MAP = path.join(FIXTURES, 'map', 'map.json');
    process.env.EDIFABRIC_OFFLINE = process.env.EDIFABRIC_ONLINE_TESTS ? '' : 'true';
}

export async function connect() {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { createServer } = await import('../src/server.js');

    const { server } = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return client;
}

/** Calls a tool and returns its JSON result, or the error text for a failed call. */
export async function call(client, name, args = {}) {
    const response = await client.callTool({ name, arguments: args });
    const text = response.content[0].text;
    return response.isError ? { error: text } : JSON.parse(text);
}
