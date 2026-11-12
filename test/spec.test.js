import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES } from './helpers.js';
import { about, libraryEntry, modelQuery, outline, segmentDetail, skeleton } from '../src/formats/x12/spec.js';
import { Engine, matchMap } from '../src/native.js';
import x12 from '../src/formats/x12/index.js';

// The local 837P model the tools tests use, as ediFabric Native reads it.
const MAP = path.join(FIXTURES, 'map', 'map.json');
const model = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'map', 'model837P.json'), 'utf8').replace(/^﻿/, ''));
const query = modelQuery('837P', '005010X222A1');

test('finds the model by the message and version in ST and GS', () => {
    assert.deepEqual(modelQuery('850', '004010'), { id: '850', message: '850', version: '004010' });
    assert.deepEqual(modelQuery(850, 4010), { id: '850', message: '850', version: '004010' }, 'numbers lose their leading zeros');
    assert.deepEqual(modelQuery('837P', '005010'), { id: '837P', message: '837', version: '005010X222A1' }, 'HIPAA with the plain version');
    assert.deepEqual(modelQuery('837', '005010X222A1'), { id: '837', message: '837', version: '005010X222A1' });
    assert.equal(modelQuery('277CA', '005010').version, '005010X214');
    assert.equal(modelQuery('835', '005010').version, '005010', 'the standard 835 without a HIPAA suffix');
    assert.throws(() => modelQuery('PO', '004010'), /isn't an X12 transaction set/);
});

test('says which transaction the model is', () => {
    assert.deepEqual(about(model, query, 'local'), {
        transaction: '837P', version: '005010X222A1', model: 'Local837P', model_source: 'local',
    });
});

test('outlines the transaction with the JSON property names', () => {
    const text = outline(model, query, 3);

    assert.match(text, /^ST \(segment ST, required\)$/m);
    assert.match(text, /^BHT_BeginningOfHierarchicalTransaction \(segment BHT, required\)$/m);
    assert.match(text, /^AllNM1 \(loops in any order, required\)$/m);
    assert.match(text, /^ {2}Loop1000A \(loop 1000A, required\)$/m);
    assert.match(text, /^ {4}PER_SubmitterEDIContactInformation \(segment PER, required, repeats up to 2\)$/m);
    assert.match(text, /^Loop2000A \(loop 2000A, required, repeats any number of times\)$/m);
    assert.match(text, /^SE \(segment SE, required\)$/m);
    assert.doesNotMatch(outline(model, query, 1), /^ /m, 'max_depth 1 shows the top level only');
});

test('describes a segment\'s elements, codes and syntax rules', () => {
    const detail = segmentDetail(model, query, 'NM1_SubmitterName');

    assert.equal(detail.segment, 'NM1');
    assert.equal(detail.in_loop, 'AllNM1 > Loop1000A');
    assert.deepEqual(detail.elements[0], { name: 'EntityIdentifierCode_01', required: true, element_id: '98', type: 'X12_ID_98_21', codes: ['41'] });
    const name = detail.elements.find((e) => e.name === 'ResponseContactLastorOrganizationName_03');
    assert.equal(name.type, 'X12_AN');
    assert.equal(name.length, '1-60');
    assert.ok(detail.rules.includes('P0809: 08 and 09: if any is present, all are required'));
    assert.ok(detail.rules.includes('C1110: if 11 is present, 10 is required'));
});

test('finds a segment by its ID when only one segment has it', () => {
    assert.equal(segmentDetail(model, query, 'BHT').property, 'BHT_BeginningOfHierarchicalTransaction');
    assert.throws(() => segmentDetail(model, query, 'NM1'), /several NM1 segments: NM1_SubmitterName, NM1_ReceiverName/);
    assert.throws(() => segmentDetail(model, query, 'XYZ'), /No segment named XYZ/);
});

test('describes a composite\'s components', () => {
    const clm = segmentDetail(model, query, 'CLM_ClaimInformation');
    const composite = clm.elements.find((e) => e.components);

    assert.ok(composite.composite_id);
    assert.ok(composite.components.every((c) => c.name && 'required' in c));
});

test('makes a skeleton of the required parts in an interchange', () => {
    const [interchange] = skeleton(model, query);
    const transaction = interchange.Groups[0].Transactions[0];

    assert.equal(interchange.ISA.InterchangeControlVersionNumber_12, '00501');
    assert.equal(interchange.ISA.InterchangeControlStandardsIdentifier_11, '^');
    assert.equal(interchange.Groups[0].GS.VersionAndRelease_8, '005010X222A1');
    assert.deepEqual(transaction.ST, { TransactionSetIdentifierCode_01: '837', TransactionSetControlNumber_02: '', ImplementationConventionPreference_03: '005010X222A1' });
    // A code is filled in where only one is allowed, and the rest is left empty.
    assert.equal(transaction.AllNM1.Loop1000A.NM1_SubmitterName.EntityIdentifierCode_01, '41');
    assert.equal(transaction.AllNM1.Loop1000A.NM1_SubmitterName.ResponseContactLastorOrganizationName_03, '');
    // Repeating parts are arrays, and optional ones are left out.
    assert.ok(Array.isArray(transaction.AllNM1.Loop1000A.PER_SubmitterEDIContactInformation));
    assert.ok(Array.isArray(transaction.Loop2000A));
    assert.equal(transaction.AllNM1.Loop1000A.NM1_SubmitterName.ResponseContactFirstName_04, undefined);
    assert.ok(transaction.SE);
});

test('uses the 004010 envelope for 004010', () => {
    const key = Object.keys(model.Messages)[0];
    const in4010 = { ...model, Messages: { [key]: { ...model.Messages[key], Version: '004010' } } };

    const [interchange] = skeleton(in4010, { id: '837', message: '837', version: '004010' });

    assert.equal(interchange.ISA.InterchangeControlVersionNumber_12, '00401');
    assert.equal(interchange.ISA.InterchangeControlStandardsIdentifier_11, 'U');
});

test('finds the map entry as ediFabric Native does', () => {
    const maps = {
        '850': { name: 'any.json' },
        '850:004010': { name: 'version.json' },
        '850::ACME': { name: 'sender.json' },
        '837:005010X222A1': { name: '837p.json' },
    };

    assert.equal(matchMap(maps, '850', '004010').entry.name, 'version.json');
    assert.equal(matchMap(maps, '850', '005010').entry.name, 'any.json');
    assert.equal(matchMap(maps, '837', '005010X222A1').entry.name, '837p.json');
    assert.equal(matchMap(maps, '837', '005010X223A2'), null);
    assert.equal(matchMap({ '850::ACME': {} }, '850', '004010'), null, 'keys that need a sender don\'t match');
    assert.equal(matchMap({ '850:004010': { name: 'x' } }, '850', '004010').key, '850:004010');
});

function fakeFetch(responses) {
    const requested = [];
    const fetchImpl = async (url) => {
        requested.push(url);
        const { status = 200, body = '' } = responses(url) || { status: 404 };
        return { status, ok: status === 200, text: async () => body, json: async () => JSON.parse(body) };
    };
    return { fetchImpl, requested };
}

test('reads a model from the map file', async () => {
    const engine = new Engine(x12, { EDIFABRIC_MAP: MAP, EDIFABRIC_OFFLINE: 'true' });
    const { fetchImpl, requested } = fakeFetch(() => null);

    const { model: local, source } = await engine.model(query, fetchImpl);

    assert.equal(local.Messages[Object.keys(local.Messages)[0]].Model, 'Local837P');
    assert.match(source, /^local: .*model837P\.json$/);
    assert.equal(requested.length, 0);
});

test('downloads a model that isn\'t in the map, as ediFabric Native does, and keeps it in memory', async () => {
    const engine = new Engine(x12, { EDIFABRIC_SERIAL: 'serial-1' });
    const { fetchImpl, requested } = fakeFetch(() => ({ body: '﻿' + JSON.stringify(model) }));

    const first = await engine.model(modelQuery('850', '004010'), fetchImpl);
    await engine.model(modelQuery('850', '004010'), fetchImpl);

    assert.equal(first.source, 'online');
    assert.equal(requested.length, 1);
    const url = new URL(requested[0]);
    assert.equal(url.origin + url.pathname, 'https://api.edination.com/aot/v1/format');
    assert.deepEqual(Object.fromEntries(url.searchParams), { format: 'X12', version: '004010', message: '850', 'subscription-key': 'serial-1' });
});

test('downloads models with the demo serial too', async () => {
    const engine = new Engine(x12, {});
    const { fetchImpl, requested } = fakeFetch(() => ({ body: JSON.stringify(model) }));

    await engine.model(modelQuery('810', '005010'), fetchImpl);

    assert.equal(new URL(requested[0]).searchParams.get('subscription-key'), 'bd96a836feca45cb91c86ee65d281f52');
});

test('explains a model that can\'t be found or downloaded', async () => {
    const engine = new Engine(x12, { EDIFABRIC_SERIAL: 'serial-1' });

    const missing = fakeFetch(() => ({ status: 400 }));
    await assert.rejects(engine.model(modelQuery('999', '009999'), missing.fetchImpl), /There's no X12 model for 999 in version 009999/);

    const refused = fakeFetch(() => ({ status: 401 }));
    await assert.rejects(engine.model(modelQuery('850', '003050'), refused.fetchImpl), /refused the serial/);

    const down = { fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); } };
    await assert.rejects(engine.model(modelQuery('850', '003040'), down.fetchImpl), /Couldn't download the model.*ENOTFOUND/);

    // A failure isn't kept, so the next call tries again.
    const ok = fakeFetch(() => ({ body: JSON.stringify(model) }));
    assert.equal((await engine.model(modelQuery('850', '003050'), ok.fetchImpl)).source, 'online');
});

test('doesn\'t download models when online models are off', async () => {
    const engine = new Engine(x12, { EDIFABRIC_MAP: MAP, EDIFABRIC_OFFLINE: 'true' });
    const { fetchImpl, requested } = fakeFetch(() => null);

    await assert.rejects(engine.model(modelQuery('850', '004010'), fetchImpl), /no model for 850 004010 in EDIFABRIC_MAP, and online models are off because EDIFABRIC_OFFLINE is on/);
    assert.equal(requested.length, 0);
});

test('names the transaction from the Spec Library, when it\'s there', async () => {
    const index = {
        v: [['X12 004010', 'x12/004010/', 'EdiNation.X12.ASC.004010'], ['X12 HIPAA 005010', 'x12/hipaa/005010/', 'EdiNation.X12.HIPAA.005010']],
        s: ['Purchase Order', 'Health Care Claim: Professional'],
        t: [[0, '850', 0, 1], [1, '837P', 1, 1]],
    };
    const { fetchImpl } = fakeFetch((url) => url.endsWith('search-index.json') ? { body: JSON.stringify(index) } : null);

    assert.deepEqual(await libraryEntry('837P', '005010X222A1', fetchImpl),
        { name: 'Health Care Claim: Professional', spec_page: 'https://www.edifabric.com/specs/x12/hipaa/005010/837p.html' });
    assert.deepEqual(await libraryEntry('LOCAL1', '004010', fetchImpl), {}, 'a custom model isn\'t in the library');
    assert.deepEqual(await libraryEntry('850', '004010', async () => { throw new Error('offline'); }), {}, 'it\'s only for reference');
});

test('works against the live models', { skip: !process.env.EDIFABRIC_ONLINE_TESTS && 'set EDIFABRIC_ONLINE_TESTS=1' }, async () => {
    const engine = new Engine(x12, { EDIFABRIC_SERIAL: process.env.EDIFABRIC_SERIAL || '' });
    const live = modelQuery('810', '005010');

    const { model: downloaded, source } = await engine.model(live);

    assert.equal(source, 'online');
    assert.match(outline(downloaded, live, 1), /^BIG \(segment BIG, required\)$/m);
    assert.equal(segmentDetail(downloaded, live, 'BIG').elements[0].type, 'X12_DT');
    assert.deepEqual(await libraryEntry('810', '005010'), { name: 'Invoice', spec_page: 'https://www.edifabric.com/specs/x12/005010/810.html' });
});
