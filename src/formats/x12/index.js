// X12 and HIPAA, through the edifabric-x12 package and edifabric-x12-tools. A new format provides these same members.
import { createRequire } from 'node:module';
import { countTransactions, describeErrors, summarizeInterchanges } from './summary.js';
import { about, libraryEntry, modelQuery, outline, segmentDetail, skeleton } from './spec.js';

const require = createRequire(import.meta.url);

/** The transaction sets in raw X12, as "837 005010X222A1", without parsing it. */
export function transactionsIn(edi) {
    const { segments, elementSeparator } = splitSegments(edi);
    let groupVersion = '';
    const found = new Set();
    for (const segment of segments) {
        const parts = segment.split(elementSeparator);
        if (parts[0] === 'GS')
            groupVersion = parts[8] || '';
        else if (parts[0] === 'ST')
            found.add(`${parts[1]} ${parts[3] || groupVersion}`.trim());
    }
    return [...found];
}

/** The segments of raw X12, in file order. Validation errors refer to them by position, counting ISA as 1. */
export function splitSegments(edi) {
    const text = edi.replace(/^﻿/, '').trimStart();
    const elementSeparator = text[3];
    const segmentTerminator = text[105];
    const segments = text.split(segmentTerminator).map((s) => s.trim()).filter((s) => s.length > 0);
    return { segments, elementSeparator, segmentTerminator };
}

/** One interchange for each transaction set, keeping the envelopes, with the counts set to 1. */
function* splitTransactions(interchanges) {
    for (const interchange of interchanges) {
        for (const group of interchange.Groups || []) {
            for (const transaction of group.Transactions || []) {
                const st = transaction.ST || {};
                yield {
                    type: st.TransactionSetIdentifierCode_01,
                    control_number: st.TransactionSetControlNumber_02,
                    json: {
                        ...interchange,
                        Groups: [{ ...group, Transactions: [transaction], GE: { ...group.GE, NumberOfIncludedSets_1: '1' } }],
                        IEA: { ...interchange.IEA, NumberOfIncludedGroups_1: '1' },
                    },
                };
            }
        }
    }
}

export default {
    id: 'x12',
    name: 'X12',

    // The native library. It's only loaded when the format is used, so other formats' packages can be optional.
    loadBinding: () => require('edifabric-x12'),
    libraryVariable: 'EDIFABRIC_LIBRARY',
    mapVariable: 'EDIFABRIC_MAP',

    detect: (text) => text.startsWith('ISA'),
    detectJson: (json) => Boolean((Array.isArray(json) ? json[0] : json)?.ISA),
    wrongFileMessage: 'An X12 file must start with an ISA segment.',
    invalidJsonHint: 'The JSON must be an X12 interchange, or an array of them, as produced by parse_edi.',
    fileExtension: 'edi',

    describeTransactions(edi) {
        const found = edi ? transactionsIn(edi) : [];
        return found.length ? ` The file has ${found.join(', ')}.` : '';
    },

    summarize: (interchanges) => ({ transaction_count: countTransactions(interchanges), interchanges: summarizeInterchanges(interchanges) }),
    describeErrors,
    splitTransactions,
    countSegments: (edi) => edi.split(/~|\n/).filter((s) => s.trim()).length,

    validateConfig: ({ snip_level, max_errors }) => ({ validate: { snip_level, max_errors } }),

    acknowledgment: {
        types: ['999', '997'],
        defaultType: '999',
        config: ({ ack_type, include_accepted, suppress_ta1 }) => ({
            ack: { gen997: ack_type === '997', gen_for_valid: include_accepted, supress_ta1: suppress_ta1, ak901p: false },
        }),
    },

    // The format parameter when downloading models, and how to describe them.
    modelFormat: 'X12',
    spec: { modelQuery, about, outline, segmentDetail, skeleton, libraryEntry },
};
