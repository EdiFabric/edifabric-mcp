// Runs the real command over stdio, as an MCP client would start it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { FIXTURES, makeWorkFolder } from './helpers.js';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');

test('starts over stdio and validates a file', async () => {
    const folder = makeWorkFolder();
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [entry],
        env: {
            ...process.env,
            EDIFABRIC_ALLOWED_DIRS: folder,
            EDIFABRIC_MAP: path.join(FIXTURES, 'map', 'map.json'),
            EDIFABRIC_OFFLINE: 'true',
        },
        stderr: 'pipe',
    });
    const client = new Client({ name: 'stdio-test', version: '1.0.0' });
    try {
        await client.connect(transport);

        const info = client.getServerVersion();
        const { tools } = await client.listTools();
        const response = await client.callTool({ name: 'validate_edi', arguments: { input_path: '837p_error.txt' } });

        assert.equal(info.name, 'edifabric-mcp');
        assert.equal(tools.length, 7);
        assert.equal(JSON.parse(response.content[0].text).error_count, 1);
    } finally {
        await client.close();
        fs.rmSync(folder, { recursive: true, force: true });
    }
});
