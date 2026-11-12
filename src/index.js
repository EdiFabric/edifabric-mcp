#!/usr/bin/env node
// Runs the server over stdio. Standard output carries the protocol, so diagnostics go to standard error.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DEMO_SERIAL, getEngine } from './native.js';
import { allFormats } from './formats/index.js';
import { createServer } from './server.js';

try {
    // Checks the native library. The license is applied on first use, so a tool can report a problem with it.
    const [engine] = allFormats().map((format) => getEngine(format));
    if (engine.serial === DEMO_SERIAL)
        console.error('edifabric-mcp: using the demo serial, which has a limited quota. Set EDIFABRIC_SERIAL to your own serial.');
} catch (error) {
    console.error(`edifabric-mcp: couldn't start ediFabric Native: ${error.message}`);
    process.exit(1);
}

const { server } = createServer();
await server.connect(new StdioServerTransport());
