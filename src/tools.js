// The MCP tools. They work on files, so EDI never has to pass through the conversation.
// Everything specific to an EDI format is in its module, in formats/.
import path from 'node:path';
import { z } from 'zod';
import { EdiError } from './errors.js';
import { getEngine } from './native.js';
import { allFormats, chooseFormat, chooseFormatForJson, getFormat } from './formats/index.js';
import { besideInput, readText, writeText } from './files.js';

const overwrite = z.boolean().default(false).describe('Replace the output file if it already exists.');

function result(value) {
    return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function failure(error) {
    const message = error instanceof EdiError ? error.message : `Unexpected error: ${error.message}`;
    return { isError: true, content: [{ type: 'text', text: message }] };
}

// Every tool reports problems as tool errors, which the assistant can read and act on.
function handler(fn) {
    return async (args) => {
        try {
            return result(await fn(args));
        } catch (error) {
            return failure(error);
        }
    };
}

function enumOf(values) {
    return z.enum([values[0], ...values.slice(1)]);
}

export function registerTools(server, folders) {
    const formats = allFormats();
    const names = formats.map((f) => f.name).join(', ');
    const ids = formats.map((f) => f.id);
    const formatOption = enumOf(ids).optional().describe('The EDI format. The default is to detect it from the file.');

    const validationOptions = {
        snip_level: z.number().int().min(1).max(4).default(2)
            .describe('HIPAA SNIP level: 1 syntax, 2 limits and codes, 3 balancing, 4 situational rules. The default is 2.'),
        max_errors: z.number().int().min(1).max(1000).default(100)
            .describe('Stop after this many errors.'),
    };

    server.registerTool('parse_edi', {
        title: 'Convert EDI to JSON',
        description: `Converts an EDI file (${names}, including HIPAA) to JSON and saves it to a file. Returns a summary of its contents. `
            + 'The JSON uses the same property names as describe_spec, and build_edi converts it back.',
        inputSchema: {
            input_path: z.string().describe('The EDI file to convert.'),
            output_path: z.string().optional().describe('Where to save the JSON. The default is the input path with .json added.'),
            format: formatOption,
            overwrite,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, handler(async ({ input_path, output_path, format, overwrite }) => {
        const input = folders.resolve(input_path);
        const edi = await readText(input);
        const chosen = chooseFormat(format, edi);
        const engine = getEngine(chosen);
        const { json } = engine.parse(edi, engine.ParseMode.JSON);
        const output = await writeText(folders.resolve(output_path || besideInput(input, '.json')), json, overwrite);
        return { format: chosen.id, output_path: output, ...chosen.summarize(JSON.parse(json)) };
    }));

    server.registerTool('validate_edi', {
        title: 'Validate EDI',
        description: `Validates an EDI file (${names}, including HIPAA) against its implementation guide, up to the chosen SNIP level. `
            + 'Returns each error with the text of the segment, and its segment and element position. Doesn\'t write any files.',
        inputSchema: {
            input_path: z.string().describe('The EDI file to validate.'),
            format: formatOption,
            ...validationOptions,
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
    }, handler(async ({ input_path, format, ...options }) => {
        const input = folders.resolve(input_path);
        const edi = await readText(input);
        const chosen = chooseFormat(format, edi);
        const engine = getEngine(chosen);
        const { json, report } = engine.parse(edi, engine.ParseMode.JSON_VALIDATE, chosen.validateConfig(options));
        return { format: chosen.id, ...chosen.describeErrors(report, edi), ...chosen.summarize(JSON.parse(json)) };
    }));

    const ackFormats = formats.filter((f) => f.acknowledgment);
    server.registerTool('acknowledge_edi', {
        title: 'Generate an acknowledgment',
        description: 'Validates an EDI file and saves the acknowledgment for it. For X12: a 999 by default, or a 997, '
            + 'with a TA1 when the interchange asks for one. Returns the validation errors too.',
        inputSchema: {
            input_path: z.string().describe('The EDI file to acknowledge.'),
            output_path: z.string().optional().describe('Where to save the acknowledgment. The default is the input path with the acknowledgment type added.'),
            format: formatOption,
            ack_type: enumOf([...new Set(ackFormats.flatMap((f) => f.acknowledgment.types))]).optional().describe('The acknowledgment. For X12, 999 for HIPAA and 997 for other X12. The default is 999.'),
            include_accepted: z.boolean().default(true).describe('Acknowledge accepted transaction sets as well as rejected ones.'),
            suppress_ta1: z.boolean().default(false).describe('X12: leave out the TA1 even if the interchange asks for one.'),
            ...validationOptions,
            overwrite,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, handler(async ({ input_path, output_path, format, ack_type, include_accepted, suppress_ta1, overwrite, ...options }) => {
        const input = folders.resolve(input_path);
        const edi = await readText(input);
        const chosen = chooseFormat(format, edi);
        const ack = chosen.acknowledgment;
        if (!ack)
            throw new EdiError(`Acknowledgments aren't available for ${chosen.name} yet.`, 'not_available');

        const type = ack_type || ack.defaultType;
        if (!ack.types.includes(type))
            throw new EdiError(`${chosen.name} acknowledgments can be ${ack.types.join(' or ')}.`, 'not_available');

        const engine = getEngine(chosen);
        const config = { ...chosen.validateConfig(options), ...ack.config({ ack_type: type, include_accepted, suppress_ta1 }) };
        const { report } = engine.parse(edi, engine.ParseMode.JSON_VALIDATE_ACK, config);
        if (!report.ack)
            throw new EdiError('No acknowledgment was generated. Set include_accepted to true to acknowledge a file without errors.', 'no_ack');

        const output = await writeText(folders.resolve(output_path || besideInput(input, `.${type}`)), report.ack, overwrite);
        return { format: chosen.id, output_path: output, ack_type: type, ...chosen.describeErrors(report, edi) };
    }));

    server.registerTool('build_edi', {
        title: 'Convert JSON to EDI',
        description: 'Converts EDI JSON, as produced by parse_edi or written to match describe_spec, to an EDI file. '
            + 'The segments are written as they are in the JSON, so include the trailer segments with the correct counts, and run validate_edi on the result.',
        inputSchema: {
            input_path: z.string().describe('The JSON file: one interchange or an array of them.'),
            output_path: z.string().describe('Where to save the EDI file.'),
            format: enumOf(ids).optional().describe('The EDI format. The default is to detect it from the JSON.'),
            line_breaks: z.boolean().default(true).describe('Put each segment on its own line.'),
            overwrite,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, handler(async ({ input_path, output_path, format, line_breaks, overwrite }) => {
        const input = folders.resolve(input_path);
        const json = await readText(input);
        const chosen = chooseFormatForJson(format, json);
        const edi = getEngine(chosen).build(json, line_breaks ? '\n' : null);
        const output = await writeText(folders.resolve(output_path), edi, overwrite);
        return { format: chosen.id, output_path: output, segment_count: chosen.countSegments(edi) };
    }));

    server.registerTool('split_edi', {
        title: 'Split EDI into transactions',
        description: 'Splits an EDI file into one file per transaction, such as one claim batch into separate files. '
            + 'Each file keeps the original envelopes, with their counts set to 1.',
        inputSchema: {
            input_path: z.string().describe('The EDI file to split.'),
            output_folder: z.string().optional().describe('Where to save the files. The default is a folder next to the input, named after it.'),
            format: formatOption,
            overwrite,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, handler(async ({ input_path, output_folder, format, overwrite }) => {
        const input = folders.resolve(input_path);
        const edi = await readText(input);
        const chosen = chooseFormat(format, edi);
        const engine = getEngine(chosen);
        const interchanges = JSON.parse(engine.parse(edi, engine.ParseMode.JSON).json);
        const folder = folders.resolve(output_folder || besideInput(input, '-split'));
        const base = path.basename(input).replace(/\.[^.]+$/, '');

        const files = [];
        for (const part of chosen.splitTransactions(interchanges)) {
            const name = `${base}-${part.type}-${part.control_number || files.length + 1}.${chosen.fileExtension}`;
            const output = await writeText(path.join(folder, name), engine.build(JSON.stringify(part.json), '\n'), overwrite);
            files.push({ path: folders.resolve(output), type: part.type, control_number: part.control_number });
        }
        return { format: chosen.id, file_count: files.length, files };
    }));

    server.registerTool('describe_spec', {
        title: 'Describe a transaction',
        description: `Describes a transaction (${names}, including HIPAA) from the model parse_edi and build_edi use: a local or custom model `
            + 'in the map file, otherwise the standard model. The outline lists its loops and segments with the JSON property names. '
            + 'Give segment for one segment\'s elements, types, lengths, codes and syntax rules. Set output to skeleton for JSON to fill in and pass to build_edi.',
        inputSchema: {
            // Assistants sometimes send 850 or 004010 as numbers, so both are accepted.
            transaction: z.coerce.string().describe('The transaction, such as 850, 856, 837P, 837I or 835.'),
            version: z.coerce.string().describe('The version: 004010 or 005010 for X12, or a HIPAA version such as 005010X222A1.'),
            format: enumOf(ids).default(ids[0]).describe('The EDI format.'),
            segment: z.string().optional().describe('A segment property name from the outline, such as BHT_BeginningOfHierarchicalTransaction, or a segment ID such as BEG.'),
            output: z.enum(['outline', 'skeleton']).default('outline')
                .describe('outline: the loops and segments. skeleton: an interchange with the required loops, segments and elements, with empty values to fill in.'),
            output_path: z.string().optional().describe('Skeleton only: save it to this file instead of returning it.'),
            max_depth: z.number().int().min(1).max(12).default(6).describe('How many levels of loops the outline shows.'),
            overwrite,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, handler(async ({ transaction, version, format, segment, output, output_path, max_depth, overwrite }) => {
        const chosen = getFormat(format);
        const spec = chosen.spec;
        const query = spec.modelQuery(transaction, version);
        const engine = getEngine(chosen);
        const { model, source } = await engine.model(query);
        const described = spec.about(model, query, source);
        // The name and page come from the public Spec Library, so not when online models are off.
        const entry = engine.online ? await spec.libraryEntry(described.transaction, described.version) : {};
        const header = { ...described, ...entry };

        if (segment)
            return { ...header, ...spec.segmentDetail(model, query, segment) };
        if (output === 'skeleton') {
            const json = spec.skeleton(model, query);
            const note = 'Fill in the empty values, add the optional segments you need, then run build_edi and validate_edi. '
                + 'Set the trailer counts, such as SE01, to match the result.';
            if (!output_path)
                return { ...header, skeleton: json, note };
            const saved = await writeText(folders.resolve(output_path), JSON.stringify(json, null, 2), overwrite);
            return { ...header, output_path: saved, note };
        }
        return { ...header, outline: spec.outline(model, query, max_depth) };
    }));

    server.registerTool('get_status', {
        title: 'Check the ediFabric setup',
        description: 'Shows the license and how it\'s checked, where models come from and which folders the tools can use. Use it when a tool reports a setup problem.',
        inputSchema: {},
        annotations: { readOnlyHint: true, openWorldHint: false },
    }, handler(async () => ({
        formats: allFormats().map((format) => {
            try {
                return getEngine(format).status();
            } catch (error) {
                return { format: format.id, problem: error.message };
            }
        }),
        allowed_folders: folders.folders,
    })));
}
