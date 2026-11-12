// A second format and the license rules, with a stand-in for the native library, so no license calls are made.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { call, connect, makeWorkFolder, useEnvironment } from './helpers.js';
import { DEMO_SERIAL, Engine } from '../src/native.js';
import { allFormats, chooseFormat, chooseFormatForJson, registerFormat } from '../src/formats/index.js';

const folder = makeWorkFolder();
useEnvironment(folder);

function fakeBinding(overrides = {}) {
    const calls = [];
    const record = (name) => (...args) => { calls.push([name, ...args]); };
    return {
        calls,
        ParseMode: { JSON: 1, JSON_VALIDATE: 2, JSON_VALIDATE_ACK: 3 },
        loadLibrary: () => ({ path: 'edifabric-edifact-tools.dll' }),
        getAppVersion: () => 120,
        setMap: record('setMap'),
        setToken: record('setToken'),
        setSerial: record('setSerial'),
        ensureToken: record('ensureToken'),
        getTokenExpiration: () => 0n,
        parse: (edi, mode) => {
            calls.push(['parse', mode]);
            return { output: JSON.stringify([{ UNB: {}, Messages: [{ UNH: { Id: 'ONE' } }, { UNH: { Id: 'TWO' } }] }]), offset: 0 };
        },
        build: (json) => { calls.push(['build']); return `UNB built from ${json.length}`; },
        ...overrides,
    };
}

function fakeFormat(binding) {
    return {
        id: 'edifact',
        name: 'EDIFACT',
        loadBinding: () => binding,
        libraryVariable: 'EDIFABRIC_EDIFACT_LIBRARY',
        mapVariable: 'EDIFABRIC_EDIFACT_MAP',
        detect: (text) => /^(UNA|UNB)/.test(text),
        detectJson: (json) => Boolean((Array.isArray(json) ? json[0] : json)?.UNB),
        wrongFileMessage: 'An EDIFACT file must start with UNA or UNB.',
        invalidJsonHint: 'The JSON must be an EDIFACT interchange.',
        fileExtension: 'edi',
        describeTransactions: () => '',
        summarize: (json) => ({ transaction_count: json[0].Messages.length }),
        describeErrors: () => ({ valid: true, error_count: 0 }),
        splitTransactions: function* (json) {
            for (const message of json[0].Messages)
                yield { type: 'INVOIC', control_number: message.UNH.Id, json: { ...json[0], Messages: [message] } };
        },
        countSegments: () => 7,
        validateConfig: () => ({}),
        modelFormat: 'EDIFACT',
        spec: {
            modelQuery: (transaction, version) => ({ id: transaction, message: transaction, version }),
            about: (model, query, source) => ({ transaction: query.id, version: query.version, model: model.Name, model_source: source }),
            outline: () => 'UNH (segment UNH, required)',
            segmentDetail: () => ({ segment: 'UNH' }),
            skeleton: () => [{ UNB: {} }],
            libraryEntry: async () => ({ name: 'Invoice' }),
        },
    };
}

describe('license', () => {
    const format = (binding) => fakeFormat(binding);

    test('a serial uses ensure_token, and only on first use', () => {
        const binding = fakeBinding();
        const engine = new Engine(format(binding), { EDIFABRIC_SERIAL: 'my-serial' });
        assert.equal(binding.calls.some((c) => c[0] === 'ensureToken'), false, 'not before the first use');

        engine.parse('UNB', 1);
        engine.parse('UNB', 1);

        assert.deepEqual(binding.calls.filter((c) => c[0] === 'ensureToken'), [['ensureToken', 'my-serial', 3600]]);
        assert.equal(binding.calls.some((c) => c[0] === 'setSerial'), false);
    });

    test('the refresh window is shorter than a one-day Developer token', () => {
        const binding = fakeBinding();
        new Engine(format(binding), { EDIFABRIC_SERIAL: 's' }).ensureLicensed();

        assert.ok(binding.calls.find((c) => c[0] === 'ensureToken')[2] < 24 * 3600);
    });

    test('the demo serial is the default', () => {
        const binding = fakeBinding();
        const engine = new Engine(format(binding), {});

        engine.ensureLicensed();

        assert.deepEqual(binding.calls.find((c) => c[0] === 'ensureToken'), ['ensureToken', DEMO_SERIAL, 3600]);
        assert.match(engine.status().license, /Demo serial/);
    });

    test('EDIFABRIC_TOKEN uses set_token and makes no license calls', () => {
        const binding = fakeBinding();
        const engine = new Engine(format(binding), { EDIFABRIC_TOKEN: 'efp1_token', EDIFABRIC_SERIAL: 'also-set' });

        engine.parse('UNB', 1);

        assert.deepEqual(binding.calls.find((c) => c[0] === 'setToken'), ['setToken', 'efp1_token']);
        assert.equal(binding.calls.some((c) => c[0] === 'ensureToken' || c[0] === 'setSerial'), false);
    });

    test('a token alone has no online models, because they need a serial', () => {
        const binding = fakeBinding();

        const engine = new Engine(format(binding), { EDIFABRIC_TOKEN: 'efp1_token' });

        assert.equal(engine.map.default, '');
        assert.equal(engine.status().online_models, 'Off');
    });

    test('a failure is explained, and retried on the next call', () => {
        let refuse = true;
        const binding = fakeBinding({
            ensureToken: () => {
                if (refuse)
                    throw Object.assign(new Error('Too many'), { code: 633 });
            },
        });
        const engine = new Engine(format(binding), { EDIFABRIC_SERIAL: 's' });

        assert.throws(() => engine.parse('UNB', 1), /maximum number of machines/);
        refuse = false;
        assert.doesNotThrow(() => engine.parse('UNB', 1));
    });

    test('each license problem has its own explanation', () => {
        const cases = { 630: /maintenance term/, 631: /new token/, 636: /wait a minute/, 639: /quota/, 628: /Check EDIFABRIC_SERIAL/ };
        for (const [code, message] of Object.entries(cases)) {
            const binding = fakeBinding({ ensureToken: () => { throw Object.assign(new Error('x'), { code: Number(code) }); } });
            assert.throws(() => new Engine(format(binding), { EDIFABRIC_SERIAL: 's' }).ensureLicensed(), message, code);
        }
    });

    test('a license call that fails is explained', () => {
        const binding = fakeBinding({ ensureToken: () => { throw Object.assign(new Error('Unexpected'), { code: 501 }); } });

        assert.throws(() => new Engine(format(binding), { EDIFABRIC_SERIAL: 's' }).ensureLicensed(), /Check the internet connection/);
    });

    test('get_status reports a license problem instead of failing', () => {
        const binding = fakeBinding({ ensureToken: () => { throw Object.assign(new Error('Too many'), { code: 633 }); } });

        const status = new Engine(format(binding), { EDIFABRIC_SERIAL: 's' }).status();

        assert.match(status.license_problem, /maximum number of machines/);
        assert.equal(status.native_version, 120);
    });

    test('get_status shows how the license is checked', () => {
        const online = new Engine(format(fakeBinding()), { EDIFABRIC_SERIAL: 's' }).status();
        // 2030-01-01 in .NET ticks.
        const withToken = new Engine(format(fakeBinding({ getTokenExpiration: () => 640556640000000000n })), { EDIFABRIC_SERIAL: 's' }).status();

        assert.match(online.license_check, /Online on every operation/);
        assert.equal(online.token_expires, undefined);
        assert.match(withToken.license_check, /Locally/);
        assert.equal(withToken.token_expires, '2030-11-05');
    });
});

describe('format detection', () => {
    test('with X12 alone, other EDI is named and refused', () => {
        assert.throws(() => chooseFormat(undefined, 'UNB+UNOA:1+'), /looks like an EDIFACT file. This version supports X12/);
        assert.throws(() => chooseFormat(undefined, 'MSH|^~'), /looks like an HL7 file/);
        assert.throws(() => chooseFormat(undefined, 'hello'), /must start with an ISA/);
        assert.throws(() => chooseFormat('hl7', 'MSH|^~'), /The format hl7 isn't supported/);
        assert.equal(chooseFormat(undefined, '﻿  ISA*00').id, 'x12');
        assert.throws(() => chooseFormat('x12', 'UNB+'), /must start with an ISA/);
    });
});

describe('a second format, added by registering its module', () => {
    let client;
    let binding;
    before(async () => {
        binding = fakeBinding();
        registerFormat(fakeFormat(binding));
        // Its own map, with a local model for describe_spec.
        fs.writeFileSync(path.join(folder, 'edifact-model.json'), '{"Name":"EdifactInvoice"}');
        fs.writeFileSync(path.join(folder, 'edifact-map.json'), '{"maps":{"INVOIC:D96A":{"type":1,"name":"edifact-model.json","location":"."}}}');
        process.env.EDIFABRIC_EDIFACT_MAP = path.join(folder, 'edifact-map.json');
        client = await connect();
        fs.writeFileSync(path.join(folder, 'invoice.edi'), 'UNB+UNOA:1+SENDER+RECEIVER~');
        fs.writeFileSync(path.join(folder, 'invoice.json'), '[{"UNB":{}}]');
    });
    after(async () => {
        await client.close();
        fs.rmSync(folder, { recursive: true, force: true });
    });

    test('is detected from files and JSON', () => {
        assert.deepEqual(allFormats().map((f) => f.id), ['x12', 'edifact']);
        assert.equal(chooseFormat(undefined, 'UNB+').id, 'edifact');
        assert.equal(chooseFormatForJson(undefined, '[{"UNB":{}}]').id, 'edifact');
        assert.equal(chooseFormatForJson(undefined, '{"ISA":{}}').id, 'x12');
        assert.throws(() => chooseFormatForJson(undefined, '{"x":1}'), /Set format to one of: x12, edifact/);
    });

    test('appears in the tools', async () => {
        const { tools } = await client.listTools();
        const parse = tools.find((t) => t.name === 'parse_edi');

        assert.deepEqual(parse.inputSchema.properties.format.enum, ['x12', 'edifact']);
        assert.match(parse.description, /X12, EDIFACT/);
    });

    test('parse, validate, build and split go to its library', async () => {
        const parsed = await call(client, 'parse_edi', { input_path: 'invoice.edi' });
        const validated = await call(client, 'validate_edi', { input_path: 'invoice.edi' });
        const built = await call(client, 'build_edi', { input_path: 'invoice.json', output_path: 'built.edi' });
        const split = await call(client, 'split_edi', { input_path: 'invoice.edi' });

        assert.equal(parsed.format, 'edifact');
        assert.equal(parsed.transaction_count, 2);
        assert.equal(validated.valid, true);
        assert.equal(built.segment_count, 7);
        assert.equal(split.file_count, 2);
        assert.deepEqual(split.files.map((f) => f.control_number), ['ONE', 'TWO']);
        assert.equal(binding.calls.filter((c) => c[0] === 'ensureToken').length, 1, 'licensed once');
    });

    test('a format without acknowledgments says so', async () => {
        const result = await call(client, 'acknowledge_edi', { input_path: 'invoice.edi' });

        assert.match(result.error, /aren't available for EDIFACT/);
    });

    test('describe_spec reads its models', async () => {
        const result = await call(client, 'describe_spec', { format: 'edifact', transaction: 'INVOIC', version: 'D96A' });

        assert.equal(result.model, 'EdifactInvoice');
        assert.match(result.model_source, /^local: .*edifact-model\.json$/);
        assert.equal(result.outline, 'UNH (segment UNH, required)');
    });

    test('X12 still works next to it', async () => {
        const result = await call(client, 'validate_edi', { input_path: '837p.txt' });

        assert.equal(result.format, 'x12');
        assert.equal(result.valid, true);
    });

    test('get_status lists both', async () => {
        const status = await call(client, 'get_status');

        assert.deepEqual(status.formats.map((f) => f.format), ['x12', 'edifact']);
        assert.equal(status.formats[1].native_library, 'edifabric-edifact-tools.dll');
    });
});
