// Transaction structures from the ediFabric Native model, the same model parse_edi and build_edi use, as an outline,
// one segment's elements, or a JSON skeleton an assistant can fill in.
import { EdiError } from '../../errors.js';

const SPECS = 'https://www.edifabric.com/specs/';
const MAX_CODES = 40;

// Term types in a Native model.
const ELEMENT = 2;
const COMPOSITE = 4;
const SEGMENT = 5;
const LOOP = 6;
const ALL = 7;

// The HIPAA implementation guides, for a HIPAA transaction asked for with the plain version, such as 837P in 005010.
const HIPAA_GUIDES = {
    '270': 'X279A1', '271': 'X279A1', '276': 'X212', '277': 'X212', '277CA': 'X214', '278': 'X217', '820': 'X218',
    '834': 'X220A1', '835': 'X221A1', '837P': 'X222A1', '837I': 'X223A2', '837D': 'X224A2', '999': 'X231A1',
};

/**
 * The message and version a model is found by, as in the ST and GS segments, from what an assistant asks for:
 * 850 in 004010, 837P in 005010X222A1, or 837P in 005010.
 */
export function modelQuery(transaction, version) {
    const id = String(transaction).trim().toUpperCase();
    const message = id.match(/^\d+/)?.[0];
    if (!message)
        throw new EdiError(`${transaction} isn't an X12 transaction set. Use its number, such as 850, or a HIPAA one, such as 837P.`, 'spec_not_found');

    // A version sent as a number loses its leading zeros, such as 4010 for 004010.
    let full = String(version).trim().toUpperCase();
    if (/^\d{1,5}$/.test(full))
        full = full.padStart(6, '0');
    // A HIPAA transaction, such as 837P or 277CA, is in its implementation guide's version.
    if (/^\d{6}$/.test(full) && id !== message && HIPAA_GUIDES[id])
        full += HIPAA_GUIDES[id];
    return { id, message, version: full };
}

/** The model's message: its type, such as 837P, version and model name. */
function messageOf(model, query) {
    const messages = Object.values(model.Messages || {});
    if (!messages.length || !model.Terms)
        throw new EdiError('The model has no transaction set in it. Check the model file.', 'spec_not_found');

    const typeOf = (m) => String(m.Type || '').replace(/^TS/, '');
    return messages.find((m) => typeOf(m) === query.id) || messages.find((m) => typeOf(m).startsWith(query.message)) || messages[0];
}

function term(model, ordinal) {
    return model.Terms[String(ordinal)];
}

/** The terms inside a term: a loop's segments, a segment's elements, a composite's components. */
function childrenOf(model, parent) {
    const id = String(parent.Id);
    const owner = parent.T === SEGMENT ? model.Segments?.[id]
        : parent.T === COMPOSITE ? model.Composites?.[id]
            : model.Groups?.[id];
    return (owner?.S || []).map((ordinal) => term(model, ordinal)).filter(Boolean);
}

function rootTerms(model, message) {
    return (message.S || []).map((ordinal) => term(model, ordinal)).filter(Boolean);
}

function repeats(t) {
    if (!t.R || t.R === '1')
        return 1;
    return t.R.startsWith('>') ? 'unbounded' : Number(t.R) || t.R;
}

function codesOf(model, t) {
    const list = model.Codes?.[String(t.Id)]?.C;
    return list ? list.split(',').filter((c) => c.length > 0) : null;
}

/** What a transaction is: its type, version and model, and where the model came from. */
export function about(model, query, source) {
    const message = messageOf(model, query);
    return {
        transaction: String(message.Type || '').replace(/^TS/, '') || query.id,
        version: message.Version || query.version,
        model: message.Model,
        model_source: source,
    };
}

/**
 * The transaction as indented lines of JSON property names, each with what it is and whether it is required.
 * The names are the ones parse_edi produces and build_edi expects.
 */
export function outline(model, query, maxDepth = 6) {
    const lines = [];

    function walk(terms, depth) {
        for (const t of terms) {
            const tags = [];
            if (t.T === SEGMENT)
                tags.push(`segment ${model.Segments?.[String(t.Id)]?.Tag || t.D}`);
            else if (t.T === LOOP)
                tags.push(`loop ${model.Groups?.[String(t.Id)]?.Tag || t.D}`);
            else if (t.T === ALL)
                tags.push('loops in any order');
            else
                continue;
            tags.push(t.U === 'M' ? 'required' : 'optional');
            const repeat = repeats(t);
            if (repeat !== 1)
                tags.push(`repeats ${repeat === 'unbounded' ? 'any number of times' : `up to ${repeat}`}`);

            lines.push(`${'  '.repeat(depth)}${t.D} (${tags.join(', ')})`);
            if (t.T !== SEGMENT && depth + 1 < maxDepth)
                walk(childrenOf(model, t), depth + 1);
        }
    }

    walk(rootTerms(model, messageOf(model, query)), 0);
    return lines.join('\n');
}

/** The segments of the transaction in order, with the loops they are in. */
function* segments(model, terms, path = []) {
    for (const t of terms) {
        if (t.T === SEGMENT)
            yield { term: t, path };
        else if (t.T === LOOP || t.T === ALL)
            yield* segments(model, childrenOf(model, t), [...path, t.D]);
    }
}

/** The elements of one segment, by its JSON property name, or its ID when only one segment has it. */
export function segmentDetail(model, query, name) {
    const all = [...segments(model, rootTerms(model, messageOf(model, query)))];
    let found = all.find((s) => s.term.D === name);
    if (!found) {
        const id = String(name).trim().toUpperCase();
        const byId = all.filter((s) => model.Segments?.[String(s.term.Id)]?.Tag === id);
        const names = [...new Set(byId.map((s) => s.term.D))];
        if (names.length > 1)
            throw new EdiError(`${query.id} has several ${id} segments: ${names.join(', ')}. Give the property name of the one you want.`, 'spec_not_found');
        found = byId[0];
    }
    if (!found)
        throw new EdiError(`No segment named ${name} in ${query.id}. Use the property names from the outline, such as BHT_BeginningOfHierarchicalTransaction.`, 'spec_not_found');

    const segment = model.Segments[String(found.term.Id)];
    const detail = {
        segment: segment.Tag,
        name: found.term.D,
        in_loop: found.path.join(' > ') || null,
        elements: describeElements(model, found.term),
    };
    const rules = describeRules(segment.Rules);
    if (rules.length)
        detail.rules = rules;
    return detail;
}

function describeElements(model, owner) {
    return childrenOf(model, owner).map((t) => {
        const element = { name: t.D, required: t.U === 'M' };
        const repeat = repeats(t);
        if (repeat !== 1)
            element.repeats = repeat;

        if (t.T === COMPOSITE) {
            const composite = model.Composites[String(t.Id)];
            element.composite_id = composite.Tag;
            element.components = describeElements(model, t);
            const rules = describeRules(composite.Rules);
            if (rules.length)
                element.rules = rules;
            return element;
        }

        const definition = model.Elements?.[String(t.Id)] || {};
        element.element_id = definition.Tag;
        element.type = definition.T;
        if (definition.Max > 0)
            element.length = definition.Min === definition.Max ? `${definition.Max}` : `${definition.Min}-${definition.Max}`;
        const codes = codesOf(model, t);
        if (codes)
            element.codes = codes.length > MAX_CODES ? [...codes.slice(0, MAX_CODES), `... ${codes.length - MAX_CODES} more`] : codes;
        return element;
    });
}

// X12 syntax notes, such as P0304: the letter is the rule and each pair of digits a position.
const RULES = {
    P: (p) => `${list(p)}: if any is present, all are required`,
    R: (p) => `${list(p)}: at least one is required`,
    E: (p) => `${list(p)}: only one may be present`,
    C: ([first, ...rest]) => `if ${first} is present, ${list(rest)} ${rest.length > 1 ? 'are' : 'is'} required`,
    L: ([first, ...rest]) => `if ${first} is present, at least one of ${list(rest)} is required`,
};

function list(positions) {
    return positions.length > 1 ? `${positions.slice(0, -1).join(', ')} and ${positions.at(-1)}` : positions[0];
}

function describeRules(rules) {
    return (rules || []).map((rule) => {
        const positions = rule.slice(1).match(/\d\d/g) || [];
        const explain = RULES[rule[0]];
        return explain && positions.length ? `${rule}: ${explain(positions)}` : rule;
    });
}

/**
 * The transaction as JSON in the shape build_edi expects, in an interchange: the required loops, segments and
 * elements, with empty values to fill in. A code is filled in where only one is allowed, as in HIPAA's NM1 qualifiers.
 */
export function skeleton(model, query) {
    const message = messageOf(model, query);
    const version = message.Version || query.version;

    function value(t) {
        if (t.T === ELEMENT) {
            const codes = codesOf(model, t);
            return codes?.length === 1 ? codes[0] : '';
        }
        const object = {};
        for (const child of childrenOf(model, t)) {
            if (child.U === 'M')
                object[child.D] = repeated(child);
        }
        return object;
    }

    function repeated(t) {
        return repeats(t) === 1 ? value(t) : [value(t)];
    }

    const transaction = {};
    for (const t of rootTerms(model, message)) {
        if (t.U === 'M')
            transaction[t.D] = repeated(t);
    }
    if (transaction.ST) {
        transaction.ST.TransactionSetIdentifierCode_01 = query.message;
        if (/X/.test(version))
            transaction.ST.ImplementationConventionPreference_03 = version;
    }

    return [envelope(version, transaction)];
}

function envelope(version, transaction) {
    const interchangeVersion = version.slice(0, 5);
    const now = new Date().toISOString();
    return {
        SegmentDelimiter: '~',
        DataElementDelimiter: '*',
        ISA: {
            AuthorizationInformationQualifier_1: '00',
            AuthorizationInformation_2: ' '.repeat(10),
            SecurityInformationQualifier_3: '00',
            SecurityInformation_4: ' '.repeat(10),
            SenderIDQualifier_5: 'ZZ',
            InterchangeSenderID_6: 'SENDER'.padEnd(15),
            ReceiverIDQualifier_7: 'ZZ',
            InterchangeReceiverID_8: 'RECEIVER'.padEnd(15),
            InterchangeDate_9: now.slice(2, 10).replaceAll('-', ''),
            InterchangeTime_10: now.slice(11, 16).replace(':', ''),
            // From 00402, ISA11 is the repetition separator.
            InterchangeControlStandardsIdentifier_11: interchangeVersion >= '00402' ? '^' : 'U',
            InterchangeControlVersionNumber_12: interchangeVersion,
            InterchangeControlNumber_13: '000000001',
            AcknowledgementRequested_14: '0',
            UsageIndicator_15: 'T',
            ComponentElementSeparator_16: ':',
        },
        Groups: [{
            GS: {
                CodeIdentifyingInformationType_1: '',
                SenderIDCode_2: 'SENDER',
                ReceiverIDCode_3: 'RECEIVER',
                Date_4: now.slice(0, 10).replaceAll('-', ''),
                Time_5: now.slice(11, 16).replace(':', ''),
                GroupControlNumber_6: '1',
                TransactionTypeCode_7: 'X',
                VersionAndRelease_8: version,
            },
            Transactions: [transaction],
            GE: { NumberOfIncludedSets_1: '1', GroupControlNumber_2: '1' },
        }],
        IEA: { NumberOfIncludedGroups_1: '1', InterchangeControlNumber_2: '000000001' },
    };
}

/**
 * The transaction's name and page in the ediFabric EDI Spec Library, from its public index, when it's there.
 * Custom models aren't, and an index that can't be read leaves them out: they're only for reference.
 */
export async function libraryEntry(id, version, fetchImpl = fetch) {
    try {
        const index = await fetchIndex(fetchImpl);
        const edition = version.slice(0, 6);
        const hipaa = version.length > 6;
        const folder = hipaa ? `x12/hipaa/${edition}/` : `x12/${edition}/`;
        const versionIndex = index.v.findIndex((v) => v[1] === folder);
        const match = versionIndex < 0 ? null : index.t.find((t) => t[0] === versionIndex && t[1] === id);
        if (!match)
            return {};
        return { name: index.s[match[2]], spec_page: `${SPECS}${folder}${id.toLowerCase()}.html` };
    } catch {
        return {};
    }
}

// The index, read once for each fetch, kept in memory only. One that fails is read again next time.
const indexes = new WeakMap();

function fetchIndex(fetchImpl) {
    if (!indexes.has(fetchImpl)) {
        const promise = Promise.resolve(fetchImpl(`${SPECS}search-index.json`)).then((response) => {
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            return response.json();
        });
        promise.catch(() => indexes.delete(fetchImpl));
        indexes.set(fetchImpl, promise);
    }
    return indexes.get(fetchImpl);
}
