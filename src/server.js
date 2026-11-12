import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RootsListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { AllowedFolders } from './files.js';
import { registerTools } from './tools.js';

const { version } = createRequire(import.meta.url)('../package.json');

const INSTRUCTIONS = `Tools for EDI files, currently X12 and HIPAA, run locally with ediFabric Native. Files stay on this machine.
- To read or check a file: validate_edi, then parse_edi for the JSON.
- To create EDI: describe_spec with output skeleton, fill in the JSON (describe_spec with segment gives each segment's elements and codes), build_edi, then validate_edi on the result.
- To change EDI: parse_edi, edit the JSON, build_edi, then validate_edi.
- To answer a trading partner: acknowledge_edi (999 for HIPAA, 997 otherwise).
Paths must be inside the allowed folders; get_status lists them.`;

export function createServer(env = process.env) {
    const server = new McpServer({ name: 'edifabric-mcp', version }, { instructions: INSTRUCTIONS });
    const folders = new AllowedFolders(env);

    // Use the folders the client shares, when it supports roots and none are set in EDIFABRIC_ALLOWED_DIRS.
    const refreshRoots = async () => {
        if (!server.server.getClientCapabilities()?.roots)
            return;
        try {
            const { roots } = await server.server.listRoots();
            folders.setClientRoots(roots);
        } catch {
            // Keep the folders from before.
        }
    };
    server.server.oninitialized = refreshRoots;
    server.server.setNotificationHandler(RootsListChangedNotificationSchema, refreshRoots);

    registerTools(server, folders);
    return { server, folders };
}
