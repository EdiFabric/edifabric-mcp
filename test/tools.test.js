import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FIXTURES, call, connect, makeWorkFolder, useEnvironment } from './helpers.js';

const folder = makeWorkFolder();
useEnvironment(folder);
const file = (name) => path.join(folder, name);
const original = fs.readFileSync(path.join(FIXTURES, '837p.txt'), 'utf8');
const withoutLineBreaks = (text) => text.replace(/[\r\n]/g, '');

let client;
before(async () => { client = await connect(); });
after(async () => {
    await client.close();
    fs.rmSync(folder, { recursive: true, force: true });
});

describe('tools', () => {
    test('are listed with descriptions and input schemas', async () => {
        const { tools } = await client.listTools();
        const names = tools.map((t) => t.name).sort();
        assert.deepEqual(names, ['acknowledge_edi', 'build_edi', 'describe_spec', 'get_status', 'parse_edi', 'split_edi', 'validate_edi']);
        for (const tool of tools) {
            assert.ok(tool.description.length > 40, `${tool.name} needs a description`);
            assert.equal(tool.inputSchema.type, 'object');
        }
    });

    test('the server tells the client how to use them', async () => {
        assert.match(client.getInstructions(), /validate_edi/);
    });
});

describe('parse_edi', () => {
    test('saves the JSON next to the input and summarizes it', async () => {
        const result = await call(client, 'parse_edi', { input_path: '837p.txt' });

        assert.equal(result.output_path, file('837p.txt.json'));
        assert.equal(result.transaction_count, 1);
        const transaction = result.interchanges[0].groups[0].transactions[0];
        assert.deepEqual(transaction, { type: '837', control_number: '0021', version: '005010X222A1', model: 'Local837P' });
        assert.equal(result.interchanges[0].usage, 'production');
        assert.ok(JSON.parse(fs.readFileSync(result.output_path, 'utf8'))[0].Groups);
    });

    test('doesn\'t replace an existing file unless asked to', async () => {
        await call(client, 'parse_edi', { input_path: '837p.txt', output_path: 'again.json' });

        const refused = await call(client, 'parse_edi', { input_path: '837p.txt', output_path: 'again.json' });
        const replaced = await call(client, 'parse_edi', { input_path: '837p.txt', output_path: 'again.json', overwrite: true });

        assert.match(refused.error, /already exists/);
        assert.equal(replaced.output_path, file('again.json'));
    });

    test('explains a file that isn\'t X12', async () => {
        fs.writeFileSync(file('notes.txt'), 'hello');

        const result = await call(client, 'parse_edi', { input_path: 'notes.txt' });

        assert.match(result.error, /must start with an ISA segment/);
    });

    // Online, the model is downloaded, so this needs online models off.
    test('explains a transaction without a model', { skip: Boolean(process.env.EDIFABRIC_ONLINE_TESTS) && 'needs online models off' }, async () => {
        fs.writeFileSync(file('unknown.txt'), original.replace('ST*837*0021*005010X222A1', 'ST*999*0021*005010X231A1'));

        const result = await call(client, 'parse_edi', { input_path: 'unknown.txt' });

        assert.match(result.error, /no model was found/);
        assert.match(result.error, /999 005010X231A1/);
    });

    test('reports a missing file', async () => {
        const result = await call(client, 'parse_edi', { input_path: 'missing.txt' });

        assert.match(result.error, /File not found/);
    });
});

describe('validate_edi', () => {
    test('passes a valid file', async () => {
        const result = await call(client, 'validate_edi', { input_path: '837p.txt', snip_level: 4 });

        assert.equal(result.valid, true);
        assert.equal(result.error_count, 0);
        assert.equal(result.segment_count, 46);
    });

    test('reports each error with the segment it is in', async () => {
        const result = await call(client, 'validate_edi', { input_path: '837p_error.txt', snip_level: 4 });

        assert.equal(result.valid, false);
        assert.equal(result.error_count, 1);
        const [error] = result.errors;
        assert.equal(error.segment_position, 9);
        assert.equal(error.segment, 'PRV*BI*PX*203BF0100Y');
        assert.equal(error.element_position, 2);
        assert.equal(error.message, 'Invalid EDI code');
    });

    test('doesn\'t write any files', async () => {
        const before = fs.readdirSync(folder).sort();

        await call(client, 'validate_edi', { input_path: '837p_error.txt' });

        assert.deepEqual(fs.readdirSync(folder).sort(), before);
    });
});

describe('acknowledge_edi', () => {
    test('saves a 999 with a TA1 by default', async () => {
        const result = await call(client, 'acknowledge_edi', { input_path: '837p.txt' });
        const ack = fs.readFileSync(result.output_path, 'utf8');

        assert.equal(result.output_path, file('837p.txt.999'));
        assert.match(ack, /ST\*999\*/);
        assert.match(ack, /TA1\*/);
        assert.match(ack, /IK5\*A/);
    });

    test('saves a 997 on request, without the TA1', async () => {
        const result = await call(client, 'acknowledge_edi', { input_path: '837p_error.txt', ack_type: '997', suppress_ta1: true });
        const ack = fs.readFileSync(result.output_path, 'utf8');

        assert.match(ack, /ST\*997\*/);
        assert.doesNotMatch(ack, /TA1\*/);
        assert.match(ack, /AK3\*PRV\*/);
        assert.match(ack, /AK4\*2\*/);
        assert.equal(result.error_count, 1);
    });

    test('reports the segment position within the transaction set', async () => {
        const result = await call(client, 'acknowledge_edi', { input_path: '837p_error.txt', output_path: 'position.997', ack_type: '997' });

        const ack = fs.readFileSync(result.output_path, 'utf8');
        assert.match(ack, /AK3\*PRV\*7\*/);
        assert.match(ack, /AK4\*2\*128\*7\*PX/, 'with the data element number');
        assert.match(ack, /AK1\*HC\*/, 'and the functional ID from GS01');
    });

    test('rejects a transaction set with errors', async () => {
        const result = await call(client, 'acknowledge_edi', { input_path: '837p_error.txt', output_path: 'status.997', ack_type: '997' });

        assert.match(fs.readFileSync(result.output_path, 'utf8'), /AK5\*R\*5~AK9\*R\*1\*1\*0~/);
    });
});

describe('build_edi', () => {
    test('converts parsed JSON back to the same X12', async () => {
        await call(client, 'parse_edi', { input_path: '837p.txt', output_path: 'roundtrip.json' });

        const compact = await call(client, 'build_edi', { input_path: 'roundtrip.json', output_path: 'compact.edi', line_breaks: false });
        const lines = await call(client, 'build_edi', { input_path: 'roundtrip.json', output_path: 'lines.edi' });

        assert.equal(fs.readFileSync(compact.output_path, 'utf8'), withoutLineBreaks(original));
        assert.equal(withoutLineBreaks(fs.readFileSync(lines.output_path, 'utf8')), withoutLineBreaks(original));
        assert.equal(lines.segment_count, 46);
    });

    test('explains JSON that isn\'t an interchange', async () => {
        fs.writeFileSync(file('bad.json'), '{"x":1}');

        const result = await call(client, 'build_edi', { input_path: 'bad.json', output_path: 'bad.edi' });

        assert.match(result.error, /must be an X12 interchange/);
    });
});

describe('describe_spec', () => {
    test('outlines the local model the other tools use', async () => {
        const result = await call(client, 'describe_spec', { transaction: '837P', version: '005010', max_depth: 2 });

        assert.equal(result.transaction, '837P');
        assert.equal(result.version, '005010X222A1');
        assert.equal(result.model, 'Local837P');
        assert.match(result.model_source, /^local: /);
        // The name comes from the public Spec Library, which is only read when online models are on.
        assert.equal(result.name, process.env.EDIFABRIC_ONLINE_TESTS ? 'Health Care Claim: Professional' : undefined);
        assert.match(result.outline, /^ {2}Loop1000A \(loop 1000A, required\)$/m);
    });

    test('describes a segment', async () => {
        const result = await call(client, 'describe_spec', { transaction: '837P', version: '005010X222A1', segment: 'BHT' });

        assert.equal(result.segment, 'BHT');
        assert.equal(result.name, 'BHT_BeginningOfHierarchicalTransaction');
        assert.deepEqual(result.elements[0].codes, ['0019']);
    });

    test('saves a skeleton that build_edi converts to X12', async () => {
        const result = await call(client, 'describe_spec', { transaction: '837P', version: '005010', output: 'skeleton', output_path: 'skeleton.json' });
        const built = await call(client, 'build_edi', { input_path: 'skeleton.json', output_path: 'skeleton.edi' });

        assert.match(result.note, /Fill in the empty values/);
        assert.equal(built.error, undefined);
        const edi = fs.readFileSync(built.output_path, 'utf8');
        assert.match(edi, /^ST\*837\*\*005010X222A1~$/m);
        assert.match(edi, /^NM1\*41\*/m);
    });

    test('returns the skeleton without output_path', async () => {
        const result = await call(client, 'describe_spec', { transaction: '837P', version: '005010', output: 'skeleton' });

        assert.equal(result.skeleton[0].Groups[0].Transactions[0].ST.TransactionSetIdentifierCode_01, '837');
    });

    test('explains a transaction that has no model when online models are off', { skip: Boolean(process.env.EDIFABRIC_ONLINE_TESTS) && 'needs online models off' }, async () => {
        const result = await call(client, 'describe_spec', { transaction: '850', version: '004010' });

        assert.match(result.error, /no model for 850 004010 in EDIFABRIC_MAP/);
    });
});

describe('split_edi', () => {
    test('saves each transaction set as a valid X12 file', async () => {
        const result = await call(client, 'split_edi', { input_path: '837p_two.txt' });

        assert.equal(result.file_count, 2);
        assert.deepEqual(result.files.map((f) => f.control_number), ['0021', '0022']);
        for (const part of result.files) {
            const text = fs.readFileSync(part.path, 'utf8');
            assert.match(text, /GE\*1\*/);
            assert.match(text, /IEA\*1\*/);
            const check = await call(client, 'validate_edi', { input_path: part.path, snip_level: 4 });
            assert.equal(check.valid, true, JSON.stringify(check.errors));
        }
    });
});

describe('allowed folders', () => {
    test('paths outside them are refused', async () => {
        const outside = path.join(os.tmpdir(), 'outside.txt');

        const read = await call(client, 'validate_edi', { input_path: outside });
        const write = await call(client, 'parse_edi', { input_path: '837p.txt', output_path: '../escaped.json' });

        assert.match(read.error, /outside the allowed folders/);
        assert.match(write.error, /outside the allowed folders/);
    });

    test('get_status lists them', async () => {
        const status = await call(client, 'get_status');

        assert.deepEqual(status.allowed_folders, [path.resolve(folder)]);
        const [x12] = status.formats;
        assert.equal(x12.format, 'x12');
        assert.ok(x12.native_version >= 120, `native_version ${x12.native_version}`);
        assert.ok(x12.local_models.includes('837:005010X222A1'));
    });
});
